using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using PeckList.Core.Accounts;
using PeckList.Core.Telemetry;

namespace PeckList.Server.Tests;

/// <summary>Crash reports (PL-116): only when the person says so, scrubbed, through the server, kept when the collector is away.</summary>
public sealed class CrashReportTests(ServerFixture fixture) : IClassFixture<ServerFixture>
{
    private const string AdminPassword = "correct horse battery";
    private const string Password = "a long enough password";

    private static CancellationToken Token => TestContext.Current.CancellationToken;

    private sealed class FakeCollector : ICrashSender
    {
        public List<(Uri Url, CrashReport Report)> Sent { get; } = [];
        public bool Down { get; set; }

        public Task SendAsync(Uri url, CrashReport report, CancellationToken cancellation)
        {
            if (Down) throw new HttpRequestException("connection refused");
            Sent.Add((url, report));
            return Task.CompletedTask;
        }
    }

    private (WebApplicationFactory<Program> Server, FakeCollector Collector) Start(params (string, string)[] settings)
    {
        var collector = new FakeCollector();
        var server = fixture.Factory([("ADMIN_PASSWORD", AdminPassword), ("DB_PATH", fixture.NewDbPath()), ("TELEMETRY", "on"), .. settings])
            .WithWebHostBuilder(host => host.ConfigureTestServices(services => services.AddSingleton<ICrashSender>(collector)));
        return (server, collector);
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

    private static object Crash() => new
    {
        source = "web",
        version = "0.8.0",
        kind = "TypeError",
        fingerprint = "a1b2c3d4",
        stack = "TypeError: cannot read title of undefined (sam@example.com)\n    at render (https://tasks.zebra-example.test/assets/index-abc.js?v=2:10:5)",
        device = new[] { "browser:firefox", "os:linux", "my-secret:thing" },
    };

    [Fact]
    public async Task An_apps_report_goes_through_the_server_with_no_address_email_or_unknown_device_kind()
    {
        var (server, collector) = Start(("TELEMETRY_URL", "https://collector.example/api/public/v1/ping"));
        using var owned = server;
        var sam = await NewUser(server, "sam");
        Assert.True((await sam.GetFromJsonAsync<TelemetryStatus>("/api/telemetry", Token))!.CrashReportsEnabled);
        Assert.Equal(HttpStatusCode.NoContent, (await sam.PostAsJsonAsync("/api/crash-reports", Crash(), Token)).StatusCode);

        var (url, report) = Assert.Single(collector.Sent);
        Assert.Equal("https://collector.example/api/public/v1/crash", url.ToString());
        Assert.Equal(("web", "0.8.0", "release", "TypeError", "a1b2c3d4"), (report.Source, report.Version, report.Channel, report.Kind, report.Fingerprint));
        Assert.True(Guid.TryParse(report.InstallId, out _));
        Assert.Equal(["browser:firefox", "os:linux"], report.Device);
        var text = JsonSerializer.Serialize(report);
        Assert.DoesNotContain("zebra", text);
        Assert.DoesNotContain("sam@example.com", text);
        Assert.Contains("/assets/index-abc.js:10:5", report.Stack);
        Assert.Null(CrashReports.Problem(report));
    }

    [Fact]
    public async Task Never_sends_nothing_and_turns_usage_sharing_off_and_crash_reports_off_offers_none()
    {
        var (server, collector) = Start();
        using (server)
        {
            var sam = await NewUser(server, "sam");
            var chosen = await (await sam.PutAsJsonAsync("/api/telemetry/choice", new { crashReports = "never" }, Token))
                .Content.ReadFromJsonAsync<TelemetryStatus>(Token);
            Assert.Equal(("never", false), (chosen!.CrashReports, chosen.ShareUsage));
            Assert.Equal(HttpStatusCode.NoContent, (await sam.PostAsJsonAsync("/api/crash-reports", Crash(), Token)).StatusCode);
            Assert.Empty(collector.Sent);
        }
        var (off, _) = Start(("CRASH_REPORTS", "false"));
        using (off)
        {
            var kim = await NewUser(off, "kim");
            Assert.False((await kim.GetFromJsonAsync<TelemetryStatus>("/api/telemetry", Token))!.CrashReportsEnabled);
            Assert.Equal(HttpStatusCode.NotFound, (await kim.PostAsJsonAsync("/api/crash-reports", Crash(), Token)).StatusCode);
        }
    }

    [Fact]
    public async Task A_report_waits_while_the_collector_is_away_and_goes_at_the_next_look()
    {
        var (server, collector) = Start();
        using var owned = server;
        var sam = await NewUser(server, "sam");
        collector.Down = true;
        Assert.Equal(HttpStatusCode.NoContent, (await sam.PostAsJsonAsync("/api/crash-reports", Crash(), Token)).StatusCode);
        Assert.Empty(collector.Sent);
        collector.Down = false;
        var service = server.Services.GetServices<Microsoft.Extensions.Hosting.IHostedService>().OfType<TelemetryService>().Single();
        await service.RunOnceAsync(Token);
        Assert.Single(collector.Sent);
        await service.RunOnceAsync(Token);
        Assert.Single(collector.Sent);
    }

    [Fact]
    public async Task The_servers_own_crashes_are_kept_for_the_admin_who_sends_or_forgets_each()
    {
        var (server, collector) = Start();
        using var owned = server;
        var crashes = server.Services.GetRequiredService<CrashReporting>();
        for (var index = 0; index < 2; index++)
        {
            try
            {
                throw new InvalidOperationException("broke while reading https://tasks.zebra-example.test/?token=abc");
            }
            catch (InvalidOperationException error)
            {
                await crashes.RecordServerCrashAsync(error, Token);
            }
        }
        var admin = await LogIn(server, "admin", AdminPassword);
        var listed = await admin.GetFromJsonAsync<JsonObject>("/api/admin/crash-reports", Token);
        var crash = Assert.Single(listed!["crashes"]!.AsArray())!;
        Assert.Equal(2, (int)crash["count"]!);
        Assert.Equal("InvalidOperationException", (string?)crash["report"]!["kind"]);
        Assert.DoesNotContain("zebra", crash.ToJsonString());
        Assert.DoesNotContain("token=abc", crash.ToJsonString());

        var print = (string)crash["fingerprint"]!;
        Assert.Equal(HttpStatusCode.NoContent, (await admin.PostAsync($"/api/admin/crash-reports/{print}/send", null, Token)).StatusCode);
        Assert.Equal("server", Assert.Single(collector.Sent).Report.Source);
        Assert.Empty((await admin.GetFromJsonAsync<JsonObject>("/api/admin/crash-reports", Token))!["crashes"]!.AsArray());
    }
}
