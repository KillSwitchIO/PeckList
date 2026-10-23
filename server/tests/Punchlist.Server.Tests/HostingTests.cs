using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Punchlist.Core;

namespace Punchlist.Server.Tests;

/// <summary>Hosts the server against a throwaway web build.</summary>
public sealed class ServerFixture : IDisposable
{
    public string WebRoot { get; } = Directory.CreateTempSubdirectory("punchlist-web-").FullName;

    public ServerFixture()
    {
        File.WriteAllText(Path.Combine(WebRoot, "index.html"), "<!doctype html><title>Punchlist</title>");
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
    private readonly WebApplicationFactory<Program> server;
    private readonly HttpClient client;

    public HostingTests(ServerFixture fixture)
    {
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
    public async Task Info_reports_the_schema_version_and_time_zone()
    {
        var info = await client.GetFromJsonAsync<ServerInfo>("/api/info", TestContext.Current.CancellationToken);
        Assert.Equal(new ServerInfo("punchlist", "0.1.0", WorkspaceSchema.CurrentVersion, TimeZoneInfo.Local.Id, 25), info);
    }

    [Fact]
    public async Task Serves_the_app_and_revalidates_it()
    {
        var response = await client.GetAsync("/", TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("<title>Punchlist</title>", await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken));
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
        Assert.Contains("<title>Punchlist</title>", await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken));
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
