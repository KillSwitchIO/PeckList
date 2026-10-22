using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Authentication.OpenIdConnect;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Punchlist.Core;
using Punchlist.Core.Accounts;
using Punchlist.Server.Auth;

namespace Punchlist.Server.Tests;

/// <summary>The whole OIDC sign-in through the server, against <see cref="FakeOidcProvider"/>.</summary>
public sealed class OidcTests(ServerFixture fixture) : IClassFixture<ServerFixture>
{
    private const string AdminPassword = "correct horse battery";

    private static CancellationToken Token => TestContext.Current.CancellationToken;

    private readonly FakeOidcProvider provider = new();

    private WebApplicationFactory<Program> Server(params (string Key, string Value)[] extra) =>
        fixture.Factory([
            ("ADMIN_PASSWORD", AdminPassword),
            ("DB_PATH", fixture.NewDbPath()),
            ("OIDC_PROVIDERS", "fake"),
            ("OIDC_FAKE_AUTHORITY", FakeOidcProvider.Authority),
            ("OIDC_FAKE_CLIENT_ID", FakeOidcProvider.ClientId),
            ("OIDC_FAKE_CLIENT_SECRET", "secret"),
            ("OIDC_FAKE_DISPLAY_NAME", "Fake ID"),
            .. extra,
        ]).WithWebHostBuilder(host => host.ConfigureTestServices(services =>
            services.Configure<OpenIdConnectOptions>(OidcSetup.Scheme("fake"), options => options.BackchannelHttpHandler = provider)));

    private static HttpClient Browser(WebApplicationFactory<Program> server) =>
        server.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });

    private static Dictionary<string, object> Kim(params string[] groups) => new()
    {
        ["sub"] = "kim-subject",
        ["preferred_username"] = "kim",
        ["name"] = "Kim Lee",
        ["email"] = "kim@example.com",
        ["groups"] = groups,
    };

    /// <summary>Start at the app, go through the provider, and come back: where the server sends the browser last.</summary>
    private async Task<string> SignIn(HttpClient browser, Dictionary<string, object> claims, string returnUrl = "/")
    {
        var start = await browser.GetAsync($"/auth/oidc/fake/login?returnUrl={Uri.EscapeDataString(returnUrl)}", Token);
        Assert.Equal(HttpStatusCode.Redirect, start.StatusCode);
        var back = await browser.GetAsync(provider.Authorize(start.Headers.Location!, claims), Token);
        Assert.Equal(HttpStatusCode.Redirect, back.StatusCode);
        return back.Headers.Location!.ToString();
    }

    [Fact]
    public async Task Lists_the_providers_on_the_sign_in_page()
    {
        using var server = Server(("LOCAL_LOGIN", "hidden"));
        var options = await Browser(server).GetFromJsonAsync<SignInOptions>("/auth/providers", Token);
        Assert.Equal([new SignInProvider("fake", "Fake ID")], options!.Providers);
        Assert.False(options.LocalLogin);
        Assert.Equal(HttpStatusCode.NotFound, (await Browser(server).GetAsync("/auth/oidc/nope/login", Token)).StatusCode);
    }

    [Fact]
    public async Task A_first_sign_in_makes_the_account_and_starts_a_session()
    {
        using var server = Server(("OIDC_FAKE_AUTO_CREATE", "true"));
        var browser = Browser(server);
        Assert.Equal("/inbox", await SignIn(browser, Kim(), "/inbox"));

        var me = await browser.GetFromJsonAsync<Me>("/auth/me", Token);
        Assert.Equal(("kim", "user", false), (me!.Username, me.Role, me.MustChangePassword));
        var sync = await browser.PostAsJsonAsync("/api/sync", new { schemaVersion = WorkspaceSchema.CurrentVersion, cursor = (long?)null }, Token);
        Assert.Contains("Kim Lee", await sync.Content.ReadAsStringAsync(Token));

        // Again later: the same account.
        var other = Browser(server);
        await SignIn(other, Kim());
        Assert.Equal(me.Id, (await other.GetFromJsonAsync<Me>("/auth/me", Token))!.Id);
    }

    [Fact]
    public async Task Only_the_required_groups_get_in()
    {
        using var server = Server(("OIDC_FAKE_AUTO_CREATE", "true"), ("OIDC_FAKE_REQUIRED_GROUPS", "punchlist"));
        var browser = Browser(server);
        Assert.Equal("/login?error=oidc_not_allowed", await SignIn(browser, Kim("family")));
        Assert.Equal(HttpStatusCode.Unauthorized, (await browser.GetAsync("/auth/me", Token)).StatusCode);

        Assert.Equal("/", await SignIn(browser, Kim("family", "punchlist")));
        Assert.Equal(HttpStatusCode.OK, (await browser.GetAsync("/auth/me", Token)).StatusCode);
    }

    [Fact]
    public async Task Without_auto_create_an_admin_lets_them_in()
    {
        using var server = Server(("OIDC_FAKE_ROLE_MAP", "pl-admins=admin"));
        var kim = Browser(server);
        Assert.Equal("/login?error=oidc_pending", await SignIn(kim, Kim("pl-admins")));

        var admin = Browser(server);
        (await admin.PostAsJsonAsync("/auth/login", new { username = "admin", password = AdminPassword }, Token)).EnsureSuccessStatusCode();
        var waiting = Assert.Single((await admin.GetFromJsonAsync<PendingSignIn[]>("/api/admin/pending-signins", Token))!);
        Assert.Equal(("kim", "Kim Lee"), (waiting.Username, waiting.DisplayName));
        var approved = await admin.PostAsync($"/api/admin/pending-signins/fake/{Uri.EscapeDataString(waiting.Subject)}/approve", null, Token);
        Assert.Equal(HttpStatusCode.OK, approved.StatusCode);

        Assert.Equal("/", await SignIn(kim, Kim("pl-admins")));
        Assert.Equal("admin", (await kim.GetFromJsonAsync<Me>("/auth/me", Token))!.Role);
        Assert.Empty((await admin.GetFromJsonAsync<PendingSignIn[]>("/api/admin/pending-signins", Token))!);
    }

    [Theory]
    [InlineData("//evil.example.com/")]
    [InlineData("https://evil.example.com/")]
    [InlineData("/\\evil.example.com")]
    public async Task Only_returns_to_this_app(string returnUrl)
    {
        using var server = Server(("OIDC_FAKE_AUTO_CREATE", "true"));
        Assert.Equal("/", await SignIn(Browser(server), Kim(), returnUrl));
    }

    [Fact]
    public async Task With_a_public_url_the_callback_address_is_fixed()
    {
        using var server = Server(("OIDC_FAKE_AUTO_CREATE", "true"), ("PUBLIC_URL", "https://tasks.example.com"));
        var browser = Browser(server);
        var start = await browser.GetAsync("/auth/oidc/fake/login", Token);
        Assert.Contains("redirect_uri=https%3A%2F%2Ftasks.example.com%2Fauth%2Foidc%2Ffake%2Fcallback", start.Headers.Location!.Query);

        // The browser comes back through the proxy; the code exchange names the same address.
        var callback = new Uri(provider.Authorize(start.Headers.Location!, Kim()));
        var back = await browser.GetAsync(callback.PathAndQuery, Token);
        Assert.Equal("/", back.Headers.Location!.ToString());
        Assert.Equal("https://tasks.example.com/auth/oidc/fake/callback", provider.LastTokenRedirectUri);
    }

    [Fact]
    public async Task A_failed_sign_in_lands_on_the_sign_in_page()
    {
        using var server = Server(("OIDC_FAKE_AUTO_CREATE", "true"));
        var browser = Browser(server);
        await browser.GetAsync("/auth/oidc/fake/login", Token);
        var back = await browser.GetAsync("/auth/oidc/fake/callback?error=access_denied&state=nonsense", Token);
        Assert.Equal("/login?error=oidc_failed", back.Headers.Location!.ToString());
    }
}
