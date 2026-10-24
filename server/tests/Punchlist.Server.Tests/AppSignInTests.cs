using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using Microsoft.AspNetCore.Authentication.OpenIdConnect;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Extensions.DependencyInjection;
using Punchlist.Server.Auth;

namespace Punchlist.Server.Tests;

/// <summary>
/// The Android app's provider sign-in (ADR-0017): a browser tab signs in and confirms, the app
/// redeems the code with its verifier in its own WebView.
/// </summary>
public sealed class AppSignInTests(ServerFixture fixture) : IClassFixture<ServerFixture>
{
    private const string Scheme = "com.example.punchlist";

    private static CancellationToken Token => TestContext.Current.CancellationToken;

    private readonly FakeOidcProvider provider = new();

    private WebApplicationFactory<Program> Server() =>
        fixture.Factory([
            ("ADMIN_PASSWORD", "correct horse battery"),
            ("DB_PATH", fixture.NewDbPath()),
            ("OIDC_PROVIDERS", "fake"),
            ("OIDC_FAKE_AUTHORITY", FakeOidcProvider.Authority),
            ("OIDC_FAKE_CLIENT_ID", FakeOidcProvider.ClientId),
            ("OIDC_FAKE_CLIENT_SECRET", "secret"),
            ("OIDC_FAKE_AUTO_CREATE", "true"),
        ]).WithWebHostBuilder(host => host.ConfigureTestServices(services =>
            services.Configure<OpenIdConnectOptions>(OidcSetup.Scheme("fake"), options => options.BackchannelHttpHandler = provider)));

    private static HttpClient Browser(WebApplicationFactory<Program> server) =>
        server.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });

    private static Dictionary<string, object> Kim() => new()
    {
        ["sub"] = "kim-subject",
        ["preferred_username"] = "kim",
        ["name"] = "Kim Lee",
        ["groups"] = Array.Empty<string>(),
    };

    private static string NewVerifier() =>
        Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    private static string HandoffUrl(string challenge, string returnUrl = "/today") =>
        $"/auth/app/handoff?provider=fake&challenge={challenge}&scheme={Scheme}&returnUrl={Uri.EscapeDataString(returnUrl)}";

    /// <summary>The browser tab's part: sign in through the provider, confirm, and get the app's link.</summary>
    private async Task<Uri> ConfirmInBrowser(HttpClient tab, string challenge)
    {
        var start = await tab.GetAsync(HandoffUrl(challenge), Token);
        Assert.Equal(HttpStatusCode.Redirect, start.StatusCode);
        var login = await tab.GetAsync(start.Headers.Location!, Token);
        var back = await tab.GetAsync(provider.Authorize(login.Headers.Location!, Kim()), Token);
        Assert.Equal(HandoffUrl(challenge), back.Headers.Location!.ToString());

        var page = await tab.GetAsync(back.Headers.Location!, Token);
        Assert.Equal(HttpStatusCode.OK, page.StatusCode);
        Assert.Contains("kim", await page.Content.ReadAsStringAsync(Token));
        Assert.Contains("frame-ancestors 'none'", page.Headers.GetValues("Content-Security-Policy").Single());

        // As Chrome sends it: the page's referrer policy must keep the Origin header (not "null").
        Assert.Equal("same-origin", page.Headers.GetValues("Referrer-Policy").Single());
        var confirm = new HttpRequestMessage(HttpMethod.Post, "/auth/app/handoff")
        {
            Content = Form(("challenge", challenge), ("scheme", Scheme), ("returnUrl", "/today")),
        };
        confirm.Headers.Add("Origin", "http://localhost");
        confirm.Headers.Add("Sec-Fetch-Site", "same-origin");
        var confirmed = await tab.SendAsync(confirm, Token);
        Assert.Equal(HttpStatusCode.Redirect, confirmed.StatusCode);
        return confirmed.Headers.Location!;
    }

    private static FormUrlEncodedContent Form(params (string Key, string Value)[] fields) =>
        new(fields.Select(field => new KeyValuePair<string, string>(field.Key, field.Value)));

    private static string CodeOf(Uri appLink) => QueryHelpers.ParseQuery(appLink.Query)["code"].ToString();

    [Fact]
    public async Task The_app_gets_a_session_of_its_own_through_the_browser()
    {
        using var server = Server();
        var verifier = NewVerifier();
        var appLink = await ConfirmInBrowser(Browser(server), AppSignIn.ChallengeOf(verifier));
        Assert.Equal((Scheme, "auth"), (appLink.Scheme, appLink.Host));

        var app = Browser(server);
        var redeemed = await app.PostAsync("/auth/app/redeem", Form(("code", CodeOf(appLink)), ("verifier", verifier)), Token);
        Assert.Equal(HttpStatusCode.Redirect, redeemed.StatusCode);
        Assert.Equal("/today", redeemed.Headers.Location!.ToString());
        var me = await app.GetFromJsonAsync<Me>("/auth/me", Token);
        Assert.Equal(("kim", "fake"), (me!.Username, me.Provider));
    }

    [Fact]
    public async Task A_code_needs_the_verifier_and_works_once()
    {
        using var server = Server();
        var verifier = NewVerifier();
        var code = CodeOf(await ConfirmInBrowser(Browser(server), AppSignIn.ChallengeOf(verifier)));

        var thief = Browser(server);
        var stolen = await thief.PostAsync("/auth/app/redeem", Form(("code", code), ("verifier", NewVerifier())), Token);
        Assert.Equal("/login?error=app_sign_in_failed", stolen.Headers.Location!.ToString());
        Assert.Equal(HttpStatusCode.Unauthorized, (await thief.GetAsync("/auth/me", Token)).StatusCode);

        // The failed try used it up, so the code is worth nothing once seen.
        var app = Browser(server);
        var late = await app.PostAsync("/auth/app/redeem", Form(("code", code), ("verifier", verifier)), Token);
        Assert.Equal("/login?error=app_sign_in_failed", late.Headers.Location!.ToString());
    }

    [Fact]
    public async Task Another_site_cannot_press_the_button()
    {
        using var server = Server();
        var tab = Browser(server);
        var challenge = AppSignIn.ChallengeOf(NewVerifier());
        await ConfirmInBrowser(tab, challenge);

        var forged = new HttpRequestMessage(HttpMethod.Post, "/auth/app/handoff")
        {
            Content = Form(("challenge", challenge), ("scheme", Scheme)),
        };
        forged.Headers.Add("Sec-Fetch-Site", "cross-site");
        forged.Headers.Add("Origin", "https://evil.example");
        Assert.Equal(HttpStatusCode.BadRequest, (await tab.SendAsync(forged, Token)).StatusCode);
    }

    [Theory]
    [InlineData("https")]
    [InlineData("javascript")]
    [InlineData("Com.Example")]
    public async Task Only_app_schemes_are_sent_back_to(string scheme)
    {
        using var server = Server();
        var challenge = AppSignIn.ChallengeOf(NewVerifier());
        var answer = await Browser(server).GetAsync($"/auth/app/handoff?provider=fake&challenge={challenge}&scheme={scheme}", Token);
        Assert.Equal(HttpStatusCode.BadRequest, answer.StatusCode);
    }
}
