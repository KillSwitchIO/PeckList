using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using PeckList.Core.Accounts;
using PeckList.Core.Telemetry;

namespace PeckList.Server.Tests;

/// <summary>The apps' counts in the daily report (PL-116): through the server, bucketed, on the lists only, off when asked.</summary>
public sealed class ClientTelemetryTests(ServerFixture fixture) : IClassFixture<ServerFixture>
{
    private const string AdminPassword = "correct horse battery";
    private const string Password = "a long enough password";

    private static CancellationToken Token => TestContext.Current.CancellationToken;

    private sealed class FakeSender : ITelemetrySender
    {
        public List<TelemetryPing> Sent { get; } = [];

        public Task SendAsync(Uri url, TelemetryPing ping, CancellationToken cancellation)
        {
            Sent.Add(ping);
            return Task.CompletedTask;
        }
    }

    private (WebApplicationFactory<Program> Server, FakeSender Sender) Start(params (string, string)[] settings)
    {
        var sender = new FakeSender();
        var server = fixture.Factory([("ADMIN_PASSWORD", AdminPassword), ("DB_PATH", fixture.NewDbPath()), ("TELEMETRY", "on"), .. settings])
            .WithWebHostBuilder(host => host.ConfigureTestServices(services => services.AddSingleton<ITelemetrySender>(sender)));
        return (server, sender);
    }

    private static async Task<HttpClient> LogIn(WebApplicationFactory<Program> server, string username, string password)
    {
        var client = server.CreateClient();
        (await client.PostAsJsonAsync("/auth/login", new { username, password }, Token)).EnsureSuccessStatusCode();
        return client;
    }

    private static async Task<HttpClient> NewUser(WebApplicationFactory<Program> server, string username)
    {
        await server.Services.GetRequiredService<AccountService>().CreateUserAsync(username, Password, mustChangePassword: false, cancellation: Token);
        return await LogIn(server, username, Password);
    }

    private static object Report(string device) => new
    {
        device,
        platform = "pwa",
        browser = "firefox",
        os = "linux",
        screen = "desktop",
        theme = "dark",
        language = "en",
        notify = "on",
        exact = "off",
        battery = "maybe",
        features = new Dictionary<string, int> { ["view.today"] = 3, ["view.calendar"] = 1, ["reminder.late1m"] = 2, ["Groceries for zebrafinch"] = 9 },
        errors = new Dictionary<string, int> { ["deadbeef"] = 2, ["not a fingerprint"] = 4 },
        timings = new Dictionary<string, int[]> { ["sync"] = [120, 200, 250], ["zebra"] = [1] },
    };

    [Fact]
    public async Task A_devices_counts_reach_the_next_report_bucketed_and_on_the_lists_only()
    {
        var (server, sender) = Start();
        using var _ = server;
        var sam = await NewUser(server, "zebrafinch");
        Assert.True((await sam.GetFromJsonAsync<TelemetryStatus>("/api/telemetry", Token))!.Enabled);
        Assert.Equal(HttpStatusCode.NoContent, (await sam.PostAsJsonAsync("/api/telemetry", Report("device-aaaa-1"), Token)).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await sam.PostAsJsonAsync("/api/telemetry", Report("device-bbbb-2"), Token)).StatusCode);

        var admin = await LogIn(server, "admin", AdminPassword);
        var info = await admin.GetFromJsonAsync<TelemetryInfo>("/api/admin/telemetry", Token);
        var clients = info!.Report.Clients!;
        Assert.Equal("1", clients.People);
        Assert.Equal("2-5", clients.Devices["platform:pwa"]);
        Assert.Equal("2-5", clients.Devices["browser:firefox"]);
        Assert.Equal("6-20", clients.Features["view.today"]);
        Assert.Equal(["reminder.late1m", "view.calendar", "view.today"], clients.Features.Keys.Order());
        Assert.Equal(("2-5", "2-5"), (clients.Devices["notify:on"], clients.Devices["exact:off"]));
        Assert.DoesNotContain(clients.Devices.Keys, kind => kind.StartsWith("battery:", StringComparison.Ordinal));
        Assert.Equal(["deadbeef"], clients.Errors.Keys);
        Assert.Equal("100-300ms", clients.Timings["sync"]);
        var text = await (await admin.GetAsync("/api/admin/telemetry", Token)).Content.ReadAsStringAsync(Token);
        Assert.DoesNotContain("zebra", text, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("device-", text);
        Assert.Null(TelemetryBuckets.Problem(info.Report));

        // The report goes; the next day starts empty.
        await server.Services.GetServices<Microsoft.Extensions.Hosting.IHostedService>().OfType<TelemetryService>().Single().RunOnceAsync(Token);
        Assert.NotNull(Assert.Single(sender.Sent).Clients);
        Assert.Null((await admin.GetFromJsonAsync<TelemetryInfo>("/api/admin/telemetry", Token))!.Report.Clients);
    }

    [Fact]
    public async Task A_person_who_stops_sharing_is_left_out_and_a_server_with_reports_off_takes_nothing()
    {
        var (server, _) = Start();
        using (server)
        {
            var sam = await NewUser(server, "sam");
            var off = await sam.PutAsJsonAsync("/api/telemetry/choice", new { shareUsage = false }, Token);
            Assert.False((await off.Content.ReadFromJsonAsync<TelemetryStatus>(Token))!.ShareUsage);
            await sam.PostAsJsonAsync("/api/telemetry", Report("device-aaaa-1"), Token);
            var admin = await LogIn(server, "admin", AdminPassword);
            Assert.Null((await admin.GetFromJsonAsync<TelemetryInfo>("/api/admin/telemetry", Token))!.Report.Clients);
            Assert.Equal(HttpStatusCode.BadRequest,
                (await sam.PutAsJsonAsync("/api/telemetry/choice", new { crashReports = "sometimes" }, Token)).StatusCode);
        }

        var (quiet, _) = Start(("TELEMETRY", "off"));
        using (quiet)
        {
            var kim = await NewUser(quiet, "kim");
            Assert.False((await kim.GetFromJsonAsync<TelemetryStatus>("/api/telemetry", Token))!.Enabled);
            Assert.Equal(HttpStatusCode.NoContent, (await kim.PostAsJsonAsync("/api/telemetry", Report("device-aaaa-1"), Token)).StatusCode);
            var admin = await LogIn(quiet, "admin", AdminPassword);
            Assert.Null((await admin.GetFromJsonAsync<TelemetryInfo>("/api/admin/telemetry", Token))!.Report.Clients);
        }
    }

    [Fact]
    public async Task A_report_without_a_device_id_is_refused()
    {
        var (server, _) = Start();
        using var _ = server;
        var sam = await NewUser(server, "sam");
        Assert.Equal(HttpStatusCode.BadRequest, (await sam.PostAsJsonAsync("/api/telemetry", new { platform = "tab" }, Token)).StatusCode);
    }
}
