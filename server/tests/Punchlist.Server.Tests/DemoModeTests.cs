using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Punchlist.Core.Accounts;
using Punchlist.Core.Configuration;
using Punchlist.Core.Storage;
using Punchlist.Server.Auth;

namespace Punchlist.Server.Tests;

/// <summary>A demo server (<c>DEMO_MODE</c>, PL-117) as visitors and the operator meet it.</summary>
public sealed class DemoModeTests(ServerFixture fixture) : IClassFixture<ServerFixture>
{
    private const string AdminPassword = "correct horse battery";
    private const string SamPassword = "try-punchlist-sam";
    private const string Password = "a long enough password";

    private static CancellationToken Token => TestContext.Current.CancellationToken;

    private WebApplicationFactory<Program> Demo(params (string Key, string Value)[] more) =>
        fixture.Factory([
            ("ADMIN_PASSWORD", AdminPassword),
            ("DEMO_MODE", "true"),
            ("DEMO_ACCOUNTS", $"demo-sam:{SamPassword},demo-alex:try-punchlist-alex"),
            .. more,
        ]);

    private WebApplicationFactory<Program> Ordinary(params (string Key, string Value)[] more) =>
        fixture.Factory([("ADMIN_PASSWORD", AdminPassword), .. more]);

    private static Task<HttpResponseMessage> LogIn(HttpClient client, string username, string password) =>
        client.PostAsJsonAsync("/auth/login", new { username, password }, Token);

    private static async Task<string?> ErrorOf(HttpResponseMessage response) =>
        (await response.Content.ReadFromJsonAsync<AuthError>(Token))?.Error;

    [Fact]
    public async Task Tells_the_app_when_it_resets_and_which_accounts_anyone_may_use()
    {
        using var server = Demo(("DEMO_RESET_TIME", "03:30"));
        var info = await server.CreateClient().GetFromJsonAsync<ServerInfo>("/api/info", Token);
        Assert.Equal("03:30", info!.Demo!.ResetTime);
        Assert.Equal([new DemoLogin("demo-sam", SamPassword), new DemoLogin("demo-alex", "try-punchlist-alex")], info.Demo.Accounts);

        using var ordinary = Ordinary();
        Assert.Null((await ordinary.CreateClient().GetFromJsonAsync<ServerInfo>("/api/info", Token))!.Demo);
    }

    [Fact]
    public async Task Anyone_can_sign_up_whatever_REGISTRATION_says()
    {
        using var server = Demo(("REGISTRATION", "closed"));
        var client = server.CreateClient();
        Assert.Equal("open", (await client.GetFromJsonAsync<SignInOptions>("/auth/providers", Token))!.Registration);
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsJsonAsync("/auth/signup", new { username = "visitor", password = Password }, Token)).StatusCode);
    }

    [Fact]
    public async Task Runs_with_the_forced_settings()
    {
        using var server = Demo(("ACCOUNT_DELETE_GRACE_DAYS", "30"), ("ATTACHMENT_MAX_MB", "100"), ("TELEMETRY", "on"), ("UPDATE_CHECK", "on"));
        server.CreateClient();
        var live = server.Services.GetRequiredService<LiveSettings>().Current;
        Assert.Equal(0, live.AccountDeleteGraceDays);
        Assert.Equal(ServerSettings.DemoAttachmentMaxMb, live.AttachmentMaxMb);
        Assert.False(live.Telemetry);
        Assert.False(live.UpdateCheck);
        Assert.Equal(ServerSettings.DemoAttachmentMaxMb, (await server.CreateClient().GetFromJsonAsync<ServerInfo>("/api/info", Token))!.AttachmentMaxMb);
    }

    [Fact]
    public async Task Makes_no_outbound_calls()
    {
        using var server = Demo();
        server.CreateClient();
        var http = server.Services.GetRequiredService<IHttpClientFactory>();
        foreach (var name in new[] { "telemetry", "updates", "push", "photos", "anything-later" })
        {
            var refused = await Assert.ThrowsAsync<HttpRequestException>(() => http.CreateClient(name).GetAsync("https://example.com/", Token));
            Assert.Contains("DEMO_MODE", refused.Message);
        }
    }

    [Fact]
    public async Task Tells_search_engines_to_stay_away_in_headers_and_the_page()
    {
        using var server = Demo();
        var client = server.CreateClient();
        foreach (var path in new[] { "/", "/index.html", "/today" })
        {
            var page = await client.GetAsync(path, Token);
            Assert.Equal(HttpStatusCode.OK, page.StatusCode);
            Assert.Equal("noindex, nofollow", page.Headers.GetValues("X-Robots-Tag").Single());
            var html = await page.Content.ReadAsStringAsync(Token);
            Assert.Contains("<meta name=\"robots\" content=\"noindex, nofollow\">", html);
            Assert.Contains("<title>Punchlist</title>", html);
        }
        Assert.Equal("noindex, nofollow", (await client.GetAsync("/api/info", Token)).Headers.GetValues("X-Robots-Tag").Single());

        using var ordinary = Ordinary();
        var plain = await ordinary.CreateClient().GetAsync("/", Token);
        Assert.False(plain.Headers.Contains("X-Robots-Tag"));
        Assert.DoesNotContain("robots", await plain.Content.ReadAsStringAsync(Token));
    }

    [Fact]
    public void Puts_the_robots_tag_in_the_head()
    {
        Assert.Equal(
            "<!doctype html><html><head lang=\"en\"><meta name=\"robots\" content=\"noindex, nofollow\"><title>P</title></head></html>",
            Punchlist.Server.Demo.WithRobotsMeta("<!doctype html><html><head lang=\"en\"><title>P</title></head></html>"));
    }

    [Fact]
    public async Task The_demo_accounts_sign_in_with_the_shown_password_and_keep_it()
    {
        using var server = Demo();
        var sam = server.CreateClient();
        Assert.Equal(HttpStatusCode.OK, (await LogIn(sam, "demo-sam", SamPassword)).StatusCode);
        var me = await sam.GetFromJsonAsync<Me>("/auth/me", Token);
        Assert.Equal("user", me!.Role);
        Assert.False(me.MustChangePassword);

        var change = await sam.PostAsJsonAsync("/auth/password", new { current = SamPassword, next = "a password only I know" }, Token);
        Assert.Equal(HttpStatusCode.BadRequest, change.StatusCode);
        Assert.Equal("demo_account", await ErrorOf(change));
        Assert.Equal(HttpStatusCode.OK, (await LogIn(server.CreateClient(), "demo-sam", SamPassword)).StatusCode);
    }

    [Fact]
    public async Task Wrong_guesses_lock_nobody_out_of_a_demo_account()
    {
        using var server = Demo();
        var stranger = server.CreateClient();
        for (var i = 0; i < AccountService.MaxFailedLogins + 2; i++)
        {
            Assert.Equal(HttpStatusCode.Unauthorized, (await LogIn(stranger, "demo-sam", "not the password")).StatusCode);
        }
        Assert.Equal(HttpStatusCode.OK, (await LogIn(server.CreateClient(), "demo-sam", SamPassword)).StatusCode);
    }

    [Fact]
    public async Task A_start_puts_the_demo_accounts_back_as_DEMO_ACCOUNTS_has_them()
    {
        var db = fixture.NewDbPath();
        using (var first = Demo(("DB_PATH", db)))
        {
            first.CreateClient();
            var accounts = first.Services.GetRequiredService<AccountService>();
            var store = first.Services.GetRequiredService<IAccountStore>();
            var sam = (await store.FindByUsernameAsync("demo-sam", Token))!;
            // Someone with the admin's password made Sam an admin and changed the password.
            await accounts.SetRoleAsync(sam.Id, Role.Admin, Token);
            await accounts.SetPasswordAsync(sam.Id, "somebody else's password", Token);
            await accounts.SetDisabledAsync(sam.Id, true, Token);
        }
        using var next = Demo(("DB_PATH", db));
        var client = next.CreateClient();
        Assert.Equal(HttpStatusCode.OK, (await LogIn(client, "demo-sam", SamPassword)).StatusCode);
        var me = await client.GetFromJsonAsync<Me>("/auth/me", Token);
        Assert.Equal("user", me!.Role);
        Assert.False(me.MustChangePassword);
    }

    [Fact]
    public async Task Limits_the_accounts_one_address_makes_in_an_hour_on_any_server()
    {
        using var server = Ordinary(("REGISTRATION", "open"), ("SIGNUP_RATE_LIMIT", "2"));
        var client = server.CreateClient();
        Task<HttpResponseMessage> SignUp(string name) =>
            client.PostAsJsonAsync("/auth/signup", new { username = name, password = Password }, Token);
        // Refused tries make no account and count for nothing.
        Assert.Equal(HttpStatusCode.Conflict, (await SignUp("admin")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await SignUp("ana")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await SignUp("bo")).StatusCode);
        var third = await SignUp("cy");
        Assert.Equal(HttpStatusCode.TooManyRequests, third.StatusCode);
        Assert.Equal("signup_limited", await ErrorOf(third));
        Assert.Null(await server.Services.GetRequiredService<IAccountStore>().FindByUsernameAsync("cy", Token));
    }

    [Fact]
    public void The_hour_passes_and_the_address_may_sign_up_again()
    {
        var time = new StepClock();
        var live = new LiveSettings(new ServerSettings { SignUpRateLimit = 1 });
        var throttle = new SignUpThrottle(live, time);
        throttle.Record("203.0.113.9");
        Assert.False(throttle.Allows("203.0.113.9"));
        Assert.True(throttle.Allows("198.51.100.4"));
        time.Now += SignUpThrottle.Window;
        Assert.True(throttle.Allows("203.0.113.9"));

        live.Apply(new ServerSettings { SignUpRateLimit = 0 });
        throttle.Record("203.0.113.9");
        throttle.Record("203.0.113.9");
        Assert.True(throttle.Allows("203.0.113.9"));
    }

    [Fact]
    public async Task The_seed_import_moves_its_dates_to_today()
    {
        var folder = Directory.CreateTempSubdirectory("punchlist-seed-").FullName;
        try
        {
            var exported = DateTimeOffset.UtcNow.Date.AddDays(-10);
            var seed = new JsonObject
            {
                ["format"] = "punchlist-server-backup",
                ["formatVersion"] = 1,
                ["schemaVersion"] = Core.WorkspaceSchema.CurrentVersion,
                ["exportedAt"] = exported.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", System.Globalization.CultureInfo.InvariantCulture),
                ["accounts"] = new JsonArray(new JsonObject
                {
                    ["id"] = "01K0000000000000000000000S", ["username"] = "demo-sam", ["passwordHash"] = null, ["role"] = "user",
                    ["mustChangePassword"] = false, ["failedLogins"] = 0, ["lockedUntil"] = null, ["securityStamp"] = "01K0000000000000000000000X",
                    ["disabled"] = false, ["createdAt"] = "2026-01-01T00:00:00.000Z", ["friendCode"] = null,
                }),
                ["entities"] = new JsonArray(new JsonObject
                {
                    ["collection"] = "tasks", ["ownerId"] = "01K0000000000000000000000S", ["seq"] = 1,
                    ["entity"] = new JsonObject
                    {
                        ["id"] = "01K0000000000000000000000T", ["title"] = "Water the plants",
                        ["schedule"] = new JsonObject { ["start"] = exported.ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture), ["allDay"] = true },
                    },
                }),
                ["visibility"] = new JsonArray(),
                ["secrets"] = new JsonArray(),
            };
            var file = Path.Combine(folder, "seed.json");
            await File.WriteAllTextAsync(file, seed.ToJsonString(), Token);
            var settings = new ServerSettings { DbPath = Path.Combine(folder, "demo.db"), SnapshotDir = Path.Combine(folder, "snapshots") };
            var output = new StringWriter();
            using var stdout = new MemoryStream();
            Assert.Equal(0, await Cli.RunAsync(["import", file, "--shift-dates"], output, new StringWriter(), stdout, settings));
            Assert.Contains("Imported 1 accounts and 1 entities", output.ToString());

            using var server = fixture.Factory(("DB_PATH", settings.DbPath), ("ADMIN_PASSWORD", AdminPassword));
            server.CreateClient();
            var task = await server.Services.GetRequiredService<IEntityStore>().GetAsync("01K0000000000000000000000T", Token);
            Assert.Equal(DateTimeOffset.UtcNow.ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture), (string?)task!.Doc["schedule"]!["start"]);
        }
        finally
        {
            Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
            Directory.Delete(folder, recursive: true);
        }
    }

    private sealed class StepClock : TimeProvider
    {
        public DateTimeOffset Now { get; set; } = new(2026, 10, 30, 4, 0, 0, TimeSpan.Zero);

        public override DateTimeOffset GetUtcNow() => Now;
    }
}
