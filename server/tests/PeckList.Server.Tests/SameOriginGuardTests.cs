using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using PeckList.Core.Accounts;
using PeckList.Server.Auth;

namespace PeckList.Server.Tests;

/// <summary>Requests that change something come from this server's own pages, or from no browser (audit S11).</summary>
public sealed class SameOriginGuardTests(ServerFixture fixture) : IClassFixture<ServerFixture>
{
    private const string AdminPassword = "correct horse battery";

    private static CancellationToken Token => TestContext.Current.CancellationToken;

    private WebApplicationFactory<Program> Server() =>
        fixture.Factory(("ADMIN_PASSWORD", AdminPassword), ("DB_PATH", fixture.NewDbPath()));

    private static async Task<HttpResponseMessage> Login(HttpClient client, params (string Name, string Value)[] headers)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, "/auth/login")
        {
            Content = JsonContent.Create(new { username = "admin", password = AdminPassword }),
        };
        foreach (var (name, value) in headers) request.Headers.Add(name, value);
        return await client.SendAsync(request, Token);
    }

    [Theory]
    [InlineData("Sec-Fetch-Site", "cross-site")]
    [InlineData("Sec-Fetch-Site", "same-site")]
    [InlineData("Origin", "https://evil.example")]
    [InlineData("Origin", "null")]
    public async Task A_change_from_another_site_is_refused(string header, string value)
    {
        using var server = Server();
        var refused = await Login(server.CreateClient(), (header, value));
        Assert.Equal(HttpStatusCode.Forbidden, refused.StatusCode);
        Assert.Equal("cross_site", (await refused.Content.ReadFromJsonAsync<AuthError>(Token))!.Error);
    }

    [Theory]
    [InlineData("Sec-Fetch-Site", "same-origin")]
    [InlineData("Sec-Fetch-Site", "none")]
    [InlineData("Origin", "http://localhost")]
    public async Task A_change_from_our_own_pages_goes_through(string header, string value)
    {
        using var server = Server();
        Assert.Equal(HttpStatusCode.OK, (await Login(server.CreateClient(), (header, value))).StatusCode);
    }

    [Fact]
    public async Task A_request_from_no_browser_goes_through_and_reading_is_never_refused()
    {
        using var server = Server();
        var client = server.CreateClient();
        // The CLI, a script with an API key: neither header.
        Assert.Equal(HttpStatusCode.OK, (await Login(client)).StatusCode);
        using var read = new HttpRequestMessage(HttpMethod.Get, "/api/info");
        read.Headers.Add("Sec-Fetch-Site", "cross-site");
        Assert.Equal(HttpStatusCode.OK, (await client.SendAsync(read, Token)).StatusCode);
    }

    [Fact]
    public async Task Opening_a_sign_in_link_only_asks_and_the_button_signs_in_once()
    {
        using var server = Server();
        var user = await server.Services.GetRequiredService<AccountService>()
            .CreateUserAsync("kim-link", "a long enough password", mustChangePassword: false, cancellation: Token);
        var (token, _) = await server.Services.GetRequiredService<LoginLinks>().CreateAsync(user.Id, cancellation: Token);
        var path = $"/auth/link/{token}";
        var tab = server.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });

        // A preview or a prefetch opening it signs nobody in and uses nothing up.
        var page = await tab.GetAsync(path, Token);
        Assert.Equal(HttpStatusCode.OK, page.StatusCode);
        var html = await page.Content.ReadAsStringAsync(Token);
        Assert.Contains("<form method=\"post\"", html);
        Assert.Contains($"action=\"{path}\"", html);
        Assert.Contains("frame-ancestors 'none'", page.Headers.GetValues("Content-Security-Policy").Single());
        Assert.Equal(HttpStatusCode.Unauthorized, (await tab.GetAsync("/auth/me", Token)).StatusCode);

        // Another site cannot press the button.
        using var cross = new HttpRequestMessage(HttpMethod.Post, path);
        cross.Headers.Add("Sec-Fetch-Site", "cross-site");
        Assert.Equal(HttpStatusCode.Forbidden, (await tab.SendAsync(cross, Token)).StatusCode);

        using var press = new HttpRequestMessage(HttpMethod.Post, path);
        press.Headers.Add("Sec-Fetch-Site", "same-origin");
        Assert.Equal(HttpStatusCode.Redirect, (await tab.SendAsync(press, Token)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await tab.GetAsync("/auth/me", Token)).StatusCode);
        Assert.Equal("/login?error=link_expired", (await tab.PostAsync(path, null, Token)).Headers.Location!.ToString());
    }
}
