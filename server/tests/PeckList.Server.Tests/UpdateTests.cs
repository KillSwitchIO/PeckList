using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;

namespace PeckList.Server.Tests;

/// <summary>The update notice (R-FB-148): the server reads the newest release, the app asks the server.</summary>
public sealed class UpdateTests(ServerFixture fixture) : IClassFixture<ServerFixture>
{
    private const string AdminPassword = "correct horse battery";

    private static CancellationToken Token => TestContext.Current.CancellationToken;

    private sealed class FakeFeed : IReleaseFeed
    {
        public Task<ReleaseInfo?> LatestAsync(CancellationToken cancellation) =>
            Task.FromResult<ReleaseInfo?>(new ReleaseInfo("99.0.0", "https://example.test/releases/v99.0.0", null));
    }

    private WebApplicationFactory<Program> Server(string check) =>
        fixture.Factory(("ADMIN_PASSWORD", AdminPassword), ("DB_PATH", fixture.NewDbPath()), ("UPDATE_CHECK", check))
            .WithWebHostBuilder(host => host.ConfigureTestServices(services =>
                services.AddSingleton<IReleaseFeed, FakeFeed>()));

    private static async Task<HttpClient> LogIn(WebApplicationFactory<Program> server)
    {
        var client = server.CreateClient();
        (await client.PostAsJsonAsync("/auth/login", new { username = "admin", password = AdminPassword }, Token)).EnsureSuccessStatusCode();
        return client;
    }

    [Theory]
    [InlineData("v0.2.7+20261028", "0.2.7")]
    [InlineData("0.3.0-edge.1a2b3c", "0.3.0")]
    [InlineData("release-notes", null)]
    [InlineData(null, null)]
    public void Tags_read_as_plain_versions(string? tag, string? plain) => Assert.Equal(plain, UpdateStatus.Plain(tag));

    [Fact]
    public void Newer_compares_versions_not_text()
    {
        Assert.True(UpdateStatus.IsNewer("v0.10.0+1", "0.9.3"));
        Assert.False(UpdateStatus.IsNewer("0.2.7", "0.2.7-edge.d89f0541"));
        Assert.False(UpdateStatus.IsNewer(null, "0.2.7"));
    }

    [Fact]
    public void A_GitLab_release_gives_its_version_and_page()
    {
        using var json = JsonDocument.Parse("""
            {"tag_name":"v0.2.7+20261028","released_at":"2026-10-28T17:00:00Z",
             "_links":{"self":"https://gitlab.com/killswitch10/pecklist/-/releases/v0.2.7%2B20261028"}}
            """);
        var release = GitLabReleaseFeed.Parse(json.RootElement)!;
        Assert.Equal("0.2.7", release.Version);
        Assert.Equal("https://gitlab.com/killswitch10/pecklist/-/releases/v0.2.7%2B20261028", release.Url);
        Assert.NotNull(release.PublishedAt);
    }

    [Fact]
    public async Task Signed_in_people_get_the_newest_release_the_server_found()
    {
        using var server = Server("on");
        Assert.Equal(HttpStatusCode.Unauthorized, (await server.CreateClient().GetAsync("/api/updates", Token)).StatusCode);
        var admin = await LogIn(server);
        // The check runs a minute after start; run one now.
        var feed = server.Services.GetRequiredService<IReleaseFeed>();
        server.Services.GetRequiredService<UpdateStatus>().Record(await feed.LatestAsync(Token), DateTimeOffset.UtcNow);

        var info = await admin.GetFromJsonAsync<UpdateInfo>("/api/updates", Token);
        Assert.True(info!.Enabled);
        Assert.Equal(ServerApp.Version, info.Current);
        Assert.Equal("99.0.0", info.Latest);
        Assert.Equal("https://example.test/releases/v99.0.0", info.ReleaseUrl);
    }

    [Fact]
    public async Task Turned_off_it_says_so_and_names_no_release()
    {
        using var server = Server("off");
        var admin = await LogIn(server);
        server.Services.GetRequiredService<UpdateStatus>()
            .Record(new ReleaseInfo("99.0.0", "https://example.test", null), DateTimeOffset.UtcNow);
        var info = await admin.GetFromJsonAsync<UpdateInfo>("/api/updates", Token);
        Assert.False(info!.Enabled);
        Assert.Null(info.Latest);
    }
}
