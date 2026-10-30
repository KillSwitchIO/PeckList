using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Punchlist.Core.Telemetry;

namespace Punchlist.Server.Tests;

/// <summary>The daily usage report (PL-116): buckets only, once a day, off when asked.</summary>
public sealed class TelemetryTests(ServerFixture fixture) : IClassFixture<ServerFixture>
{
    private const string AdminPassword = "correct horse battery";

    private static CancellationToken Token => TestContext.Current.CancellationToken;

    private sealed class FakeSender : ITelemetrySender
    {
        public List<(Uri Url, TelemetryPing Ping)> Sent { get; } = [];

        public Task SendAsync(Uri url, TelemetryPing ping, CancellationToken cancellation)
        {
            Sent.Add((url, ping));
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

    private static async Task<HttpClient> LogIn(WebApplicationFactory<Program> server)
    {
        var client = server.CreateClient();
        (await client.PostAsJsonAsync("/auth/login", new { username = "admin", password = AdminPassword }, Token)).EnsureSuccessStatusCode();
        return client;
    }

    private static TelemetryService Service(WebApplicationFactory<Program> server) =>
        server.Services.GetServices<Microsoft.Extensions.Hosting.IHostedService>().OfType<TelemetryService>().Single();

    [Fact]
    public async Task The_report_holds_buckets_and_switches_and_nothing_that_names_anyone()
    {
        var (server, _) = Start(("PUBLIC_URL", "https://tasks.zebra-example.test"));
        using var _server = server;
        var admin = await LogIn(server);
        Assert.Equal(HttpStatusCode.Created, (await admin.PostAsJsonAsync("/api/admin/users", new { username = "zebrafinch" }, Token)).StatusCode);

        var response = await admin.GetAsync("/api/admin/telemetry", Token);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var text = await response.Content.ReadAsStringAsync(Token);
        Assert.DoesNotContain("zebra", text, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("admin\"", text);

        var info = JsonSerializer.Deserialize<TelemetryInfo>(text, JsonSerializerOptions.Web)!;
        Assert.True(info.Enabled);
        Assert.Equal(ServerSettingsDefaults.Url, info.Url);
        Assert.Null(TelemetryBuckets.Problem(info.Report));
        Assert.Equal("2-5", info.Report.Scale.Users);
        Assert.Equal("sqlite", info.Report.Runtime.Database);
        Assert.True(info.Report.Setup.LocalLogin);

        // The same install id until an admin asks for a new one.
        var again = (await admin.GetFromJsonAsync<TelemetryInfo>("/api/admin/telemetry", Token))!;
        Assert.Equal(info.Report.InstallId, again.Report.InstallId);
        Assert.Equal(HttpStatusCode.NoContent, (await admin.PostAsync("/api/admin/telemetry/new-id", null, Token)).StatusCode);
        var renewed = (await admin.GetFromJsonAsync<TelemetryInfo>("/api/admin/telemetry", Token))!;
        Assert.NotEqual(info.Report.InstallId, renewed.Report.InstallId);
    }

    [Fact]
    public async Task A_report_goes_once_a_day_however_often_the_service_looks()
    {
        var (server, sender) = Start(("TELEMETRY_URL", "https://collector.example.test/v1/ping"));
        using var _server = server;
        var service = Service(server);

        await service.RunOnceAsync(Token);
        await service.RunOnceAsync(Token);
        var sent = Assert.Single(sender.Sent);
        Assert.Equal("https://collector.example.test/v1/ping", sent.Url.ToString());

        // A day later the next one goes.
        await server.Services.GetRequiredService<TelemetryReport>().MarkSentAsync(DateTimeOffset.UtcNow.AddHours(-25), Token);
        await service.RunOnceAsync(Token);
        Assert.Equal(2, sender.Sent.Count);
    }

    [Theory]
    [InlineData("TELEMETRY", "off")]
    [InlineData("DO_NOT_TRACK", "1")]
    public async Task Turned_off_nothing_goes(string key, string value)
    {
        var (server, sender) = Start((key, value));
        using var _server = server;
        await Service(server).RunOnceAsync(Token);
        Assert.Empty(sender.Sent);
        var admin = await LogIn(server);
        Assert.False((await admin.GetFromJsonAsync<TelemetryInfo>("/api/admin/telemetry", Token))!.Enabled);
    }

    [Fact]
    public async Task Only_admins_who_manage_settings_see_or_change_it()
    {
        var (server, _) = Start();
        using var _server = server;
        Assert.Equal(HttpStatusCode.Unauthorized, (await server.CreateClient().GetAsync("/api/admin/telemetry", Token)).StatusCode);
    }

    private static class ServerSettingsDefaults
    {
        public static readonly string Url = Core.Configuration.ServerSettings.DefaultTelemetryUrl.ToString();
    }
}
