using System.Net.Http.Json;
using System.Security.Claims;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using PeckList.Core;
using PeckList.Core.Accounts;
using PeckList.Core.Push;
using PeckList.Server.Auth;
using PeckList.Server.Push;

namespace PeckList.Server.Tests;

/// <summary>
/// The zone the server works in for a person (Device Time Zone Design): their pick, else TZ when the
/// operator set it, else the zone their apps report, else the server's own.
/// </summary>
public sealed class DeviceZoneTests(ServerFixture fixture) : IClassFixture<ServerFixture>
{
    private sealed class FakePush : IPushSender
    {
        public List<(string UserId, PushPayload Payload)> Sent { get; } = [];

        public Task SendAsync(string userId, PushPayload payload, CancellationToken cancellation = default)
        {
            lock (Sent) Sent.Add((userId, payload));
            return Task.CompletedTask;
        }
    }

    private readonly FakePush push = new();

    private static CancellationToken Token => TestContext.Current.CancellationToken;

    /// <summary>A server where nobody set TZ (whatever the machine running the tests has), unless <paramref name="tz"/> says.</summary>
    private WebApplicationFactory<Program> Server(string tz = "") =>
        fixture.Factory(("ADMIN_PASSWORD", "correct horse battery"), ("TZ", tz))
            .WithWebHostBuilder(host => host.ConfigureTestServices(services => services.AddSingleton<IPushSender>(push)));

    private static async Task<(HttpClient Client, string Id)> SignIn(WebApplicationFactory<Program> server, string username)
    {
        var accounts = server.Services.GetRequiredService<AccountService>();
        const string password = "a long enough password";
        var account = await accounts.CreateUserAsync(username, password, mustChangePassword: false, cancellation: Token);
        var client = server.CreateClient();
        (await client.PostAsJsonAsync("/auth/login", new { username, password }, Token)).EnsureSuccessStatusCode();
        return (client, account.Id);
    }

    private static JsonObject Entity(string id, string by, JsonObject fields)
    {
        const string stamp = "2026-10-24T10:00:00.000Z-0000-dev1";
        fields["id"] = id;
        fields["createdBy"] = by;
        fields["deletedAt"] ??= null;
        var clocks = new JsonObject();
        foreach (var (field, _) in fields) if (field != "id") clocks[field] = stamp;
        fields["_hlc"] = clocks;
        return fields;
    }

    /// <summary>A sync that says the device's zone, with any changes.</summary>
    private static async Task SyncAsync(HttpClient client, string? zone, params (string Collection, JsonObject Entity)[] changes) =>
        (await client.PostAsJsonAsync("/api/sync", new
        {
            schemaVersion = WorkspaceSchema.CurrentVersion,
            cursor = (long?)null,
            changes = changes.Select(each => new { collection = each.Collection, entity = each.Entity }).ToArray(),
            zone,
        }, Token)).EnsureSuccessStatusCode();

    /// <summary>A task of Ben's with one reminder at 09:00 on 26 October, wherever he is.</summary>
    private static (string, JsonObject)[] NineOClock(string benId) =>
    [
        ("lists", Entity("ZL1", benId, new JsonObject { ["name"] = "Home", ["visibility"] = "private" })),
        ("tasks", Entity("ZT1", benId, new JsonObject
        {
            ["listId"] = "ZL1",
            ["title"] = "Call home",
            ["parentId"] = null,
            ["status"] = "open",
            ["assignees"] = new JsonObject(),
            ["reminders"] = new JsonArray(new JsonObject { ["at"] = "2026-10-26T09:00" }),
        })),
    ];

    private static readonly TimeZoneInfo Tokyo = TimeZoneInfo.FindSystemTimeZoneById("Asia/Tokyo");

    [Fact]
    public void A_pick_comes_first_then_a_chosen_tz_then_the_device_then_the_server()
    {
        var picked = new JsonObject { ["timeZone"] = "Europe/Paris" };
        Assert.Equal("Europe/Paris", ReminderSender.ZoneOf(picked, "Asia/Tokyo", serverZoneChosen: true).Id);
        Assert.Equal(TimeZoneInfo.Local.Id, ReminderSender.ZoneOf(null, "Asia/Tokyo", serverZoneChosen: true).Id);
        Assert.Equal("Asia/Tokyo", ReminderSender.ZoneOf(null, "Asia/Tokyo", serverZoneChosen: false).Id);
        Assert.Equal(TimeZoneInfo.Local.Id, ReminderSender.ZoneOf(null, null, serverZoneChosen: false).Id);
        // A name the server does not know falls to the next.
        Assert.Equal("Asia/Tokyo", ReminderSender.ZoneOf(new JsonObject { ["timeZone"] = "Mars/Olympus" }, "Asia/Tokyo", false).Id);
        Assert.Equal(TimeZoneInfo.Local.Id, ReminderSender.ZoneOf(null, "GMT+09:00", false).Id);
    }

    [Fact]
    public async Task Sync_and_the_app_check_keep_the_devices_zone_and_only_a_zone_the_server_knows()
    {
        using var server = Server();
        var store = server.Services.GetRequiredService<IPushStore>();
        var (ben, benId) = await SignIn(server, "ben-z1");

        await SyncAsync(ben, "Asia/Tokyo");
        Assert.Equal("Asia/Tokyo", await store.DeviceZoneAsync(benId, Token));
        // A sync that says nothing, a custom offset an Android phone can report, and a long string keep what was there.
        await SyncAsync(ben, null);
        await SyncAsync(ben, "GMT+09:00");
        await SyncAsync(ben, new string('A', 100));
        Assert.Equal("Asia/Tokyo", await store.DeviceZoneAsync(benId, Token));

        (await ben.GetAsync("/api/app/check?zone=Europe/Paris", Token)).EnsureSuccessStatusCode();
        Assert.Equal("Europe/Paris", await store.DeviceZoneAsync(benId, Token));
        Assert.Equal("Europe/Paris", (await store.DeviceZonesAsync(Token))[benId]);
    }

    [Fact]
    public async Task Only_the_person_themselves_reports_a_zone_not_an_api_key_or_an_admin_viewing_as_them()
    {
        using var server = Server();
        var store = server.Services.GetRequiredService<IPushStore>();
        var (_, benId) = await SignIn(server, "ben-z2");
        Claim[] ben = [new(ClaimTypes.NameIdentifier, benId)];

        await DeviceZones.ReportAsync(store, new ClaimsPrincipal(new ClaimsIdentity(ben, ApiKeyAuth.Scheme)), "Asia/Tokyo", Token);
        await DeviceZones.ReportAsync(store, new ClaimsPrincipal(new ClaimsIdentity(
            [.. ben, new Claim(ImpersonationSetup.ByNameClaim, "admin")], "Cookies")), "Asia/Tokyo", Token);
        Assert.Null(await store.DeviceZoneAsync(benId, Token));

        await DeviceZones.ReportAsync(store, new ClaimsPrincipal(new ClaimsIdentity(ben, "Cookies")), "Asia/Tokyo", Token);
        Assert.Equal("Asia/Tokyo", await store.DeviceZoneAsync(benId, Token));
    }

    [Fact]
    public async Task With_no_pick_reminders_follow_the_devices_zone_and_a_chosen_tz_wins_over_it()
    {
        foreach (var (tz, expected) in new[] { ("", Tokyo), ("Etc/UTC", TimeZoneInfo.Local) })
        {
            push.Sent.Clear();
            using var server = Server(tz);
            var (ben, benId) = await SignIn(server, $"ben-z3{tz.Length}");
            await SyncAsync(ben, "Asia/Tokyo", NineOClock(benId));

            var due = new DateTimeOffset(TimeZoneInfo.ConvertTimeToUtc(new DateTime(2026, 10, 26, 9, 0, 0), expected), TimeSpan.Zero);
            var sender = server.Services.GetRequiredService<ReminderSender>();
            await sender.SendDueAsync(due.AddMinutes(-1), due.AddMinutes(1), Token);
            Assert.Equal($"ZT1@{due.ToUnixTimeMilliseconds()}", Assert.Single(push.Sent).Payload.Tag);

            // The Android app is handed the same time.
            var ahead = ReminderSender.UpcomingFor(server.Services.GetRequiredService<Core.Sharing.SharingState>().Index,
                benId, due.AddDays(-1), due.AddDays(1), await server.Services.GetRequiredService<IPushStore>().DeviceZoneAsync(benId, Token), tz.Length > 0);
            Assert.Equal(due, Assert.Single(ahead).At);
        }
    }

    [Fact]
    public async Task Flying_east_a_reminder_the_new_zone_has_already_passed_goes_out_at_once()
    {
        using var server = Server();
        var (ben, benId) = await SignIn(server, "ben-z4");
        await SyncAsync(ben, "America/Chicago", NineOClock(benId));
        var sender = server.Services.GetRequiredService<ReminderSender>();

        // 09:00 in Chicago is 14:00 UTC; 09:00 in Tokyo is 00:00 UTC, already past at 05:00 UTC.
        var landed = new DateTimeOffset(2026, 10, 26, 5, 0, 0, TimeSpan.Zero);
        await sender.SendDueAsync(landed.AddSeconds(-30), landed, Token);
        Assert.Empty(push.Sent);
        await SyncAsync(ben, "Asia/Tokyo");
        await sender.SendDueAsync(landed, landed.AddSeconds(30), Token);
        var tokyoNine = new DateTimeOffset(2026, 10, 26, 0, 0, 0, TimeSpan.Zero);
        Assert.Equal($"ZT1@{tokyoNine.ToUnixTimeMilliseconds()}", Assert.Single(push.Sent).Payload.Tag);

        // Once, and not again at Chicago's 09:00.
        await sender.SendDueAsync(landed.AddSeconds(30), landed.AddMinutes(1), Token);
        await sender.SendDueAsync(new DateTimeOffset(2026, 10, 26, 13, 59, 0, TimeSpan.Zero), new DateTimeOffset(2026, 10, 26, 14, 1, 0, TimeSpan.Zero), Token);
        Assert.Single(push.Sent);
    }

    [Fact]
    public async Task Flying_east_a_reminder_whose_old_time_falls_in_the_run_that_sees_the_move_still_goes()
    {
        using var server = Server();
        var (ben, benId) = await SignIn(server, "ben-z6");
        await SyncAsync(ben, "America/Chicago", NineOClock(benId));
        var sender = server.Services.GetRequiredService<ReminderSender>();

        // 09:00 in Chicago is 14:00 UTC, inside the run that first sees Tokyo; Tokyo's 09:00 has long passed.
        var chicagoNine = new DateTimeOffset(2026, 10, 26, 14, 0, 0, TimeSpan.Zero);
        await sender.SendDueAsync(chicagoNine.AddMinutes(-2), chicagoNine.AddSeconds(-30), Token);
        Assert.Empty(push.Sent);
        await SyncAsync(ben, "Asia/Tokyo");
        await sender.SendDueAsync(chicagoNine.AddSeconds(-30), chicagoNine.AddSeconds(30), Token);
        var tokyoNine = new DateTimeOffset(2026, 10, 26, 0, 0, 0, TimeSpan.Zero);
        Assert.Equal($"ZT1@{tokyoNine.ToUnixTimeMilliseconds()}", Assert.Single(push.Sent).Payload.Tag);

        await sender.SendDueAsync(chicagoNine.AddSeconds(30), chicagoNine.AddMinutes(1), Token);
        Assert.Single(push.Sent);
    }

    [Fact]
    public async Task Flying_west_a_reminder_that_already_went_comes_again_at_the_new_zones_time()
    {
        using var server = Server();
        var (ben, benId) = await SignIn(server, "ben-z5");
        await SyncAsync(ben, "Asia/Tokyo", NineOClock(benId));
        var sender = server.Services.GetRequiredService<ReminderSender>();

        var tokyoNine = new DateTimeOffset(2026, 10, 26, 0, 0, 0, TimeSpan.Zero);
        await sender.SendDueAsync(tokyoNine.AddMinutes(-1), tokyoNine.AddMinutes(1), Token);
        Assert.Single(push.Sent);

        // The task is still open: accepted as it is, and a pick settles it (Device Time Zone Design).
        await SyncAsync(ben, "America/Chicago");
        var chicagoNine = new DateTimeOffset(2026, 10, 26, 14, 0, 0, TimeSpan.Zero);
        await sender.SendDueAsync(tokyoNine.AddMinutes(1), tokyoNine.AddMinutes(2), Token);
        await sender.SendDueAsync(chicagoNine.AddMinutes(-1), chicagoNine.AddMinutes(1), Token);
        Assert.Equal(2, push.Sent.Count);
        Assert.Equal($"ZT1@{chicagoNine.ToUnixTimeMilliseconds()}", push.Sent[1].Payload.Tag);
    }
}
