using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using PeckList.Core;

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
            foreach (var (key, value) in settings) host.UseSetting(key, value);
        });

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
    public async Task Info_reports_the_schema_version_time_zone_and_app_sign_in()
    {
        var info = await client.GetFromJsonAsync<ServerInfo>("/api/info", TestContext.Current.CancellationToken);
        // The version is the build's own (Directory.Build.props, or the release build's), never a fixed one.
        // AppSignIn: the Android app opens providers in a browser tab only on a server that says so.
        Assert.Equal(new ServerInfo("pecklist", ServerApp.Version, WorkspaceSchema.CurrentVersion, TimeZoneInfo.Local.Id, 25, AppSignIn: true), info);
        Assert.Matches(@"^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$", info!.Version);
    }

    // Punchlist 0.5.0 apps compare the name exactly (PL-127); browsers and current apps get the new one.
    [Theory]
    [InlineData("Dalvik/2.1.0 (Linux; U; Android 14; Pixel 8 Build/AP2A)", null, "punchlist")]
    [InlineData("Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36", null, "punchlist")]
    [InlineData("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36", "X-Punchlist-Device", "punchlist")]
    [InlineData("Dalvik/2.1.0 (Linux; U; Android 14; Pixel 8 Build/AP2A)", "X-PeckList-Device", "pecklist")]
    [InlineData("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36", null, "pecklist")]
    [InlineData(null, null, "pecklist")]
    public async Task Info_gives_apps_from_before_the_rename_the_old_name(string? agent, string? header, string expected)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/info");
        if (agent is not null) request.Headers.TryAddWithoutValidation("User-Agent", agent);
        if (header is not null) request.Headers.Add(header, "device-1");
        var response = await client.SendAsync(request, TestContext.Current.CancellationToken);
        var info = await response.Content.ReadFromJsonAsync<ServerInfo>(TestContext.Current.CancellationToken);
        Assert.Equal(expected, info!.Name);
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
