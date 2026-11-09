using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using PeckList.Core.Accounts;

namespace PeckList.Server.Tests;

/// <summary>Links people are given come from PUBLIC_URL, or from the request only on a home network (audit S16).</summary>
public sealed class LinkOriginTests(ServerFixture fixture) : IClassFixture<ServerFixture>
{
    private const string AdminPassword = "correct horse battery";

    private static CancellationToken Token => TestContext.Current.CancellationToken;

    [Theory]
    [InlineData("localhost")]
    [InlineData("pecklist.localhost")]
    [InlineData("127.0.0.1")]
    [InlineData("[::1]")]
    [InlineData("10.0.0.5")]
    [InlineData("172.20.0.1")]
    [InlineData("192.168.1.20")]
    [InlineData("169.254.3.4")]
    [InlineData("100.100.1.1")]
    [InlineData("100.64.0.0")]
    [InlineData("100.127.255.255")]
    [InlineData("[fd12:3456::1]")]
    [InlineData("[fd7a:115c:a1e0::1]")]
    [InlineData("[fc00::1]")]
    [InlineData("[fe80::1]")]
    [InlineData("nas")]
    [InlineData("nas.lan")]
    [InlineData("NAS.local")]
    [InlineData("tasks.home.arpa")]
    [InlineData("tasks.internal")]
    [InlineData("nas.tail1234.ts.net")]
    [InlineData("NAS.Tail1234.TS.NET.")]
    [InlineData("nas.netbird.cloud")]
    [InlineData("nas.netbird.selfhosted")]
    public void Home_network_names_and_addresses_may_make_links(string host) => Assert.True(ServerApp.IsHomeNetworkHost(host));

    [Theory]
    [InlineData("")]
    [InlineData("tasks.example.com")]
    [InlineData("example.org.")]
    [InlineData("8.8.8.8")]
    [InlineData("172.32.0.1")]
    [InlineData("100.128.0.1")]
    [InlineData("100.128.0.0")]
    [InlineData("100.63.255.255")]
    [InlineData("100.0.0.1")]
    [InlineData("[2001:db8::1]")]
    [InlineData("[fe00::1]")]
    [InlineData("evil.local.example.com")]
    [InlineData("ts.net")]
    [InlineData("nas.ts.net.example.com")]
    [InlineData("evilts.net")]
    [InlineData("netbird.cloud")]
    [InlineData("nas.mynetbird.cloud")]
    public void Other_names_and_addresses_may_not(string host) => Assert.False(ServerApp.IsHomeNetworkHost(host));

    private async Task<(HttpClient Admin, string UserId)> AdminAndUser(WebApplicationFactory<Program> server, string? host)
    {
        var user = await server.Services.GetRequiredService<AccountService>()
            .CreateUserAsync($"kim{Guid.NewGuid():N}"[..12], "a long enough password", mustChangePassword: false, cancellation: Token);
        var admin = server.CreateClient();
        if (host is not null) admin.DefaultRequestHeaders.Host = host;
        (await admin.PostAsJsonAsync("/auth/login", new { username = "admin", password = AdminPassword }, Token)).EnsureSuccessStatusCode();
        return (admin, user.Id);
    }

    [Fact]
    public async Task On_a_public_name_without_public_url_no_link_is_made()
    {
        using var server = fixture.Factory(("ADMIN_PASSWORD", AdminPassword), ("DB_PATH", fixture.NewDbPath()));
        var (admin, userId) = await AdminAndUser(server, "tasks.example.com");

        var refused = await admin.PostAsync($"/api/admin/users/{userId}/login-link", null, Token);
        Assert.Equal(HttpStatusCode.Conflict, refused.StatusCode);
        Assert.Equal("public_url_required", (await refused.Content.ReadFromJsonAsync<AdminError>(Token))!.Error);
        var invite = await admin.PostAsJsonAsync("/api/admin/invites", new { days = 1, uses = 1 }, Token);
        Assert.Equal(HttpStatusCode.Conflict, invite.StatusCode);
        Assert.Equal("public_url_required", (await invite.Content.ReadFromJsonAsync<AdminError>(Token))!.Error);
        // No invite was made that nobody could use.
        Assert.Empty((await admin.GetFromJsonAsync<InviteList>("/api/admin/invites", Token))!.Invites);

        // The friend code still comes, without a link.
        var code = await admin.GetFromJsonAsync<FriendCode>("/api/friends/code", Token);
        Assert.False(string.IsNullOrEmpty(code!.Code));
        Assert.Null(code.Link);
    }

    [Fact]
    public async Task With_public_url_links_use_it_whatever_the_request_says()
    {
        using var server = fixture.Factory(("ADMIN_PASSWORD", AdminPassword), ("DB_PATH", fixture.NewDbPath()), ("PUBLIC_URL", "http://tasks.example.com"));
        var (admin, userId) = await AdminAndUser(server, "elsewhere.example.net");

        var link = await admin.PostAsync($"/api/admin/users/{userId}/login-link", null, Token);
        Assert.Equal(HttpStatusCode.OK, link.StatusCode);
        Assert.StartsWith("http://tasks.example.com/auth/link/", (await link.Content.ReadFromJsonAsync<LoginLinkView>(Token))!.Url);
        Assert.StartsWith("http://tasks.example.com/f/", (await admin.GetFromJsonAsync<FriendCode>("/api/friends/code", Token))!.Link);
    }

    [Theory]
    [InlineData("nas.lan:8080")]
    [InlineData("nas.tail1234.ts.net")]
    [InlineData("100.101.102.103:8080")]
    public async Task On_a_home_network_name_links_use_the_request(string host)
    {
        using var server = fixture.Factory(("ADMIN_PASSWORD", AdminPassword), ("DB_PATH", fixture.NewDbPath()));
        var (admin, _) = await AdminAndUser(server, host);
        Assert.StartsWith($"http://{host}/f/", (await admin.GetFromJsonAsync<FriendCode>("/api/friends/code", Token))!.Link);
    }
}
