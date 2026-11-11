using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using PeckList.Core;
using PeckList.Core.Telemetry;

namespace PeckList.Server.Tests;

/// <summary>Hosts the server against a throwaway web build.</summary>
public sealed class ServerFixture : IDisposable
{
    public string WebRoot { get; } = Directory.CreateTempSubdirectory("pecklist-web-").FullName;

    public ServerFixture()
    {
        File.WriteAllText(Path.Combine(WebRoot, "index.html"), "<!doctype html><title>PeckList</title>");
        Directory.CreateDirectory(Path.Combine(WebRoot, "assets"));
        File.WriteAllText(Path.Combine(WebRoot, "assets", "index-abc123.js"), "console.log('hi')");
        File.WriteAllText(Path.Combine(WebRoot, "sw.js"), "// service worker");
    }

    public WebApplicationFactory<Program> Factory(params (string Key, string Value)[] settings) =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(host =>
        {
            host.UseSetting("WEB_ROOT", WebRoot);
            host.UseSetting("DB_PATH", NewDbPath());
            // Servers in one test run share a folder; files are tested on their own.
            host.UseSetting("LOG_FILES", "off");
            // No test server asks GitLab for releases; the update tests turn it on with a fake feed.
            host.UseSetting("UPDATE_CHECK", "off");
            // Nor sends usage reports; the telemetry tests turn it on with a fake sender.
            host.UseSetting("TELEMETRY", "off");
            // Whatever the machine running the tests has set.
            host.UseSetting("TZ", "");
            foreach (var (key, value) in settings) host.UseSetting(key, value);
            // And a test that turns them on never reaches the project's collector: these senders
            // drop everything unless the test puts in its own (registered later, so it wins).
            host.ConfigureTestServices(services =>
            {
                services.AddSingleton<ITelemetrySender, NoSender>();
                services.AddSingleton<ICrashSender, NoSender>();
                // Tests of other things push short entities (an id, a title, clocks); the schema
                // checks (audit S4) have their own tests, which put the real validator back.
                services.AddSingleton<PeckList.Core.Sync.IEntityValidator, AnyEntity>();
                // A busy CI runner can take longer than the server's 10 s to load even an empty
                // sharing index, and a test's first request then got "503 starting". Tests wait
                // for it; StartupTests puts in a short wait of its own to see the 503.
                services.AddSingleton(new StartupWait(TimeSpan.FromMinutes(2)));
                // Test servers start by the hundred and few read a line, so none gets a quick add
                // engine ready at startup; one is made when a test first reads (QuickAddTests covers
                // the startup one).
                services.Remove(services.Single(each => each.ImplementationType == typeof(Api.QuickAddPrewarm)));
                // Quick add's wall-clock backstop is 5 s; a loaded CI runner reading an ordinary line
                // can come near it, so test servers get 30 s (the statement limit is unchanged, and
                // QuickAddTests covers the limits themselves).
                services.AddSingleton<PeckList.Core.Api.IQuickAddReader>(provider =>
                    new Api.JsQuickAdd(new Api.JsQuickAddLimits { Time = TimeSpan.FromSeconds(30) }));
            });
        });

    private sealed class AnyEntity : PeckList.Core.Sync.IEntityValidator
    {
        public string? Problem(string collection, System.Text.Json.Nodes.JsonObject entity) => null;
    }

    private sealed class NoSender : ITelemetrySender, ICrashSender
    {
        public Task SendAsync(Uri url, TelemetryPing ping, CancellationToken cancellation) => Task.CompletedTask;

        public Task SendAsync(Uri url, CrashReport report, CancellationToken cancellation) => Task.CompletedTask;
    }

    /// <summary>A fresh SQLite file for one server.</summary>
    public string NewDbPath() => Path.Combine(WebRoot, "data", $"{Guid.NewGuid():N}.db");

    public void Dispose()
    {
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        // A server a test left running may still be writing for a moment.
        for (var attempt = 1; ; attempt++)
        {
            try
            {
                Directory.Delete(WebRoot, recursive: true);
                return;
            }
            catch (IOException) when (attempt < 5)
            {
                Thread.Sleep(200);
            }
        }
    }
}

public sealed class HostingTests : IClassFixture<ServerFixture>, IDisposable
{
    private readonly ServerFixture fixture;
    private readonly WebApplicationFactory<Program> server;
    private readonly HttpClient client;

    public HostingTests(ServerFixture fixture)
    {
        this.fixture = fixture;
        server = fixture.Factory();
        client = server.CreateClient();
    }

    public void Dispose() => server.Dispose();

    [Fact]
    public async Task Healthz_answers()
    {
        var response = await client.GetAsync("/healthz", TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("Healthy", await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken));
    }

    [Fact]
    public async Task Info_reports_the_schema_version_and_app_sign_in_and_no_time_zone_nobody_set()
    {
        var info = await client.GetFromJsonAsync<ServerInfo>("/api/info", TestContext.Current.CancellationToken);
        // The version is the build's own (Directory.Build.props, or the release build's), never a fixed one.
        // AppSignIn: the Android app opens providers in a browser tab only on a server that says so.
        Assert.Equal(new ServerInfo("pecklist", ServerApp.Version, WorkspaceSchema.CurrentVersion, null, 25, AppSignIn: true), info);
        Assert.Matches(@"^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$", info!.Version);
    }

    [Fact]
    public async Task Info_reports_the_time_zone_when_the_operator_set_tz()
    {
        using var server = fixture.Factory(("TZ", "Europe/Berlin"));
        var info = await server.CreateClient().GetFromJsonAsync<ServerInfo>("/api/info", TestContext.Current.CancellationToken);
        Assert.Equal(TimeZoneInfo.Local.Id, info!.TimeZone);
    }

    [Fact]
    public async Task Without_umami_the_page_and_its_policy_stay_as_built()
    {
        var page = await client.GetAsync("/", TestContext.Current.CancellationToken);
        Assert.DoesNotContain("data-website-id", await page.Content.ReadAsStringAsync(TestContext.Current.CancellationToken));
        Assert.Equal(ResponseHardening.ContentSecurityPolicy, page.Headers.GetValues("Content-Security-Policy").Single());
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task With_umami_the_page_loads_its_scripts_and_may_report_to_it(bool recorder)
    {
        await using var factory = fixture.Factory(("UMAMI_URL", "https://stats.example.test"),
            ("UMAMI_WEBSITE_ID", "2af69a04-8c9a-4cac-9a19-390ad57c4840"), ("UMAMI_RECORDER", recorder ? "true" : "false"));
        using var umamiClient = factory.CreateClient();
        foreach (var path in new[] { "/", "/index.html", "/lists/inbox" })
        {
            var response = await umamiClient.GetAsync(path, TestContext.Current.CancellationToken);
            var html = await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken);
            Assert.Contains("<script defer src=\"https://stats.example.test/script.js\" data-website-id=\"2af69a04-8c9a-4cac-9a19-390ad57c4840\"></script>", html);
            Assert.Equal(recorder, html.Contains("https://stats.example.test/recorder.js"));
            var policy = response.Headers.GetValues("Content-Security-Policy").Single();
            Assert.Contains("script-src 'self' https://stats.example.test;", policy);
            Assert.Contains("connect-src 'self' https://stats.example.test;", policy);
            Assert.Equal(recorder, policy.Contains("worker-src 'self' blob:;"));
        }
    }

    [Fact]
    public async Task Serves_the_app_and_revalidates_it()
    {
        var response = await client.GetAsync("/", TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("<title>PeckList</title>", await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken));
        Assert.Equal("no-cache", response.Headers.CacheControl?.ToString());

        var worker = await client.GetAsync("/sw.js", TestContext.Current.CancellationToken);
        Assert.Equal("no-cache", worker.Headers.CacheControl?.ToString());
    }

    [Fact]
    public async Task Hashed_assets_cache_for_a_year()
    {
        var response = await client.GetAsync("/assets/index-abc123.js", TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("public, max-age=31536000, immutable", response.Headers.CacheControl?.ToString());
    }

    [Theory]
    [InlineData("/today")]
    [InlineData("/lists/01JB000000000000000000LIST")]
    public async Task Client_routes_fall_back_to_the_app(string path)
    {
        var response = await client.GetAsync(path, TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("<title>PeckList</title>", await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken));
    }

    [Theory]
    [InlineData("/api/nope")]
    [InlineData("/auth/nope")]
    [InlineData("/assets/missing.js")]
    public async Task Server_paths_and_missing_assets_do_not_fall_back(string path)
    {
        var response = await client.GetAsync(path, TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }
}

public static class TestClients
{
    /// <summary>
    /// A client on https://localhost, as a browser on a server whose <c>PUBLIC_URL</c> is https:
    /// there the session cookie is always Secure (audit S8), and a plain-http client would drop it.
    /// </summary>
    public static HttpClient Browser(this WebApplicationFactory<Program> server, bool allowAutoRedirect = true) =>
        server.CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = new Uri("https://localhost"), AllowAutoRedirect = allowAutoRedirect });
}
