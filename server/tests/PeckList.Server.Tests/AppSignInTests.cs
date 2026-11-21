using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Authentication.OpenIdConnect;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Extensions.DependencyInjection;
using PeckList.Server.Auth;

namespace PeckList.Server.Tests;

/// <summary>
/// The Android app's provider sign-in (ADR-0017): a browser tab signs in and confirms, the app
/// redeems the code with its verifier in its own WebView.
/// </summary>
public sealed class AppSignInTests(ServerFixture fixture) : IClassFixture<ServerFixture>
{
    private const string Scheme = "com.example.pecklist";

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

    private static string HandoffUrl(string challenge, string returnUrl = "/today", string scheme = Scheme) =>
        $"/auth/app/handoff?provider=fake&challenge={challenge}&scheme={scheme}&returnUrl={Uri.EscapeDataString(returnUrl)}";

    /// <summary>The browser tab's part: sign in through the provider, confirm, and get the app's link.</summary>
    private async Task<Uri> ConfirmInBrowser(HttpClient tab, string challenge, string scheme = Scheme, Action<string>? onPage = null)
    {
        var start = await tab.GetAsync(HandoffUrl(challenge, scheme: scheme), Token);
        Assert.Equal(HttpStatusCode.Redirect, start.StatusCode);
        var login = await tab.GetAsync(start.Headers.Location!, Token);
        var back = await tab.GetAsync(provider.Authorize(login.Headers.Location!, Kim()), Token);
        Assert.Equal(HandoffUrl(challenge, scheme: scheme), back.Headers.Location!.ToString());

        var page = await tab.GetAsync(back.Headers.Location!, Token);
        Assert.Equal(HttpStatusCode.OK, page.StatusCode);
        var html = await page.Content.ReadAsStringAsync(Token);
        Assert.Contains("kim", html);
        onPage?.Invoke(html);
        Assert.Contains("frame-ancestors 'none'", page.Headers.GetValues("Content-Security-Policy").Single());

        // As Chrome sends it: the page's referrer policy must keep the Origin header (not "null").
        Assert.Equal("same-origin", page.Headers.GetValues("Referrer-Policy").Single());
        var confirm = new HttpRequestMessage(HttpMethod.Post, "/auth/app/handoff")
        {
            Content = Form(("challenge", challenge), ("scheme", scheme), ("returnUrl", "/today")),
        };
        confirm.Headers.Add("Origin", "http://localhost");
        confirm.Headers.Add("Sec-Fetch-Site", "same-origin");
        var confirmed = await tab.SendAsync(confirm, Token);
        Assert.Equal(HttpStatusCode.Redirect, confirmed.StatusCode);
        return confirmed.Headers.Location!;
    }

    /// <summary>The confirm button on the tab's confirm page: the app's link with its code.</summary>
    private static async Task<Uri> Confirm(HttpClient tab, string challenge)
    {
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

    /// <summary>The app's WebView redeeming a code: a client with the app's new session.</summary>
    private static async Task<HttpClient> Redeem(WebApplicationFactory<Program> server, Uri appLink, string verifier)
    {
        var app = Browser(server);
        var redeemed = await app.PostAsync("/auth/app/redeem", Form(("code", CodeOf(appLink)), ("verifier", verifier)), Token);
        Assert.Equal("/today", redeemed.Headers.Location!.ToString());
        return app;
    }

    private static async Task<bool> SignedInRecently(HttpClient app) =>
        (await app.GetFromJsonAsync<AccountDeletion>("/api/account/delete", Token))!.SignedInRecently;

    /// <summary>
    /// Deleting a provider account in the app needs a sign-in in the last ten minutes, but the tab
    /// the app signs in through is often still signed in from long ago, and the hand-off would copy
    /// that old sign-in. With fresh=1 (shell api 9) the tab's session ends and the provider asks again.
    /// </summary>
    [Fact]
    public async Task A_fresh_sign_in_from_the_app_goes_through_the_provider_again_even_with_a_browser_session()
    {
        var time = new ManualTime(DateTimeOffset.UtcNow);
        using var server = Server().WithWebHostBuilder(host => host.ConfigureTestServices(services => services.AddSingleton<TimeProvider>(time)));
        var tab = Browser(server);
        var first = NewVerifier();
        var app = await Redeem(server, await ConfirmInBrowser(tab, AppSignIn.ChallengeOf(first)), first);
        Assert.True(await SignedInRecently(app));
        time.Now = time.Now.AddMinutes(11);
        Assert.False(await SignedInRecently(app));

        // Signing in again as before: the tab is still signed in, goes straight to confirming, and
        // the app gets that old sign-in once more.
        var again = NewVerifier();
        Assert.Equal(HttpStatusCode.OK, (await tab.GetAsync(HandoffUrl(AppSignIn.ChallengeOf(again)), Token)).StatusCode);
        Assert.False(await SignedInRecently(await Redeem(server, await Confirm(tab, AppSignIn.ChallengeOf(again)), again)));

        // Fresh: the tab is signed out, the provider is asked to sign them in again, and the app's
        // new session is a sign-in from now, which deletes the account.
        var fresh = NewVerifier();
        var handoff = HandoffUrl(AppSignIn.ChallengeOf(fresh));
        // As a Custom Tab opened by the app sends it.
        using var opened = new HttpRequestMessage(HttpMethod.Get, handoff + "&fresh=1");
        opened.Headers.Add("Sec-Fetch-Site", "none");
        var start = await tab.SendAsync(opened, Token);
        Assert.Equal($"/auth/oidc/fake/login?returnUrl={Uri.EscapeDataString(handoff)}&fresh=1", start.Headers.Location!.ToString());
        Assert.Equal(HttpStatusCode.Unauthorized, (await tab.GetAsync("/auth/me", Token)).StatusCode);
        // The tab follows the redirect, which keeps the request's Sec-Fetch-Site.
        using var follow = new HttpRequestMessage(HttpMethod.Get, start.Headers.Location!);
        follow.Headers.Add("Sec-Fetch-Site", "none");
        var login = await tab.SendAsync(follow, Token);
        Assert.Equal("login", QueryHelpers.ParseQuery(login.Headers.Location!.Query)["prompt"].ToString());
        Assert.Equal("0", QueryHelpers.ParseQuery(login.Headers.Location!.Query)["max_age"].ToString());
        var back = await tab.GetAsync(provider.Authorize(login.Headers.Location!, Kim()), Token);
        Assert.Equal(handoff, back.Headers.Location!.ToString());
        Assert.Equal(HttpStatusCode.OK, (await tab.GetAsync(back.Headers.Location!, Token)).StatusCode);
        var signedIn = await Redeem(server, await Confirm(tab, AppSignIn.ChallengeOf(fresh)), fresh);
        Assert.True(await SignedInRecently(signedIn));
        Assert.Equal(HttpStatusCode.OK, (await signedIn.PostAsJsonAsync("/api/account/delete", new { password = (string?)null }, Token)).StatusCode);
    }

    /// <summary>
    /// A provider can sign someone in from a session of its own that is days old. When it says when
    /// it last checked (auth_time), that is what counts as proof, not when PeckList signed them in;
    /// a fresh sign-in asks for max_age=0, and a provider that really asks again says so.
    /// </summary>
    [Fact]
    public async Task A_provider_session_counts_as_recent_by_when_the_provider_last_checked()
    {
        var time = new ManualTime(DateTimeOffset.UtcNow);
        using var server = Server().WithWebHostBuilder(host => host.ConfigureTestServices(services => services.AddSingleton<TimeProvider>(time)));
        var stale = Kim();
        stale["auth_time"] = time.Now.AddDays(-3).ToUnixTimeSeconds();

        // Signed in to PeckList a moment ago, through a provider session three days old.
        var tab = Browser(server);
        var start = await tab.GetAsync("/auth/oidc/fake/login?returnUrl=/today", Token);
        await tab.GetAsync(provider.Authorize(start.Headers.Location!, stale), Token);
        Assert.False(await SignedInRecently(tab));
        Assert.Equal("sign_in_again",
            (await (await tab.PostAsJsonAsync("/api/account/delete", new { password = (string?)null }, Token)).Content.ReadFromJsonAsync<AdminError>(Token))!.Error);

        // Fresh: the provider is asked for max_age=0, checks again and says so; that deletes.
        using var own = new HttpRequestMessage(HttpMethod.Get, "/auth/oidc/fake/login?returnUrl=/today&fresh=1");
        own.Headers.Add("Sec-Fetch-Site", "same-origin");
        var fresh = await tab.SendAsync(own, Token);
        Assert.Equal("0", QueryHelpers.ParseQuery(fresh.Headers.Location!.Query)["max_age"].ToString());
        var now = Kim();
        now["auth_time"] = time.Now.ToUnixTimeSeconds();
        await tab.GetAsync(provider.Authorize(fresh.Headers.Location!, now), Token);
        Assert.True(await SignedInRecently(tab));
        Assert.Equal(HttpStatusCode.OK, (await tab.PostAsJsonAsync("/api/account/delete", new { password = (string?)null }, Token)).StatusCode);
    }

    /// <summary>A link on another site cannot sign anyone out with fresh=1; this server's own pages can.</summary>
    [Fact]
    public async Task Only_this_servers_pages_or_the_person_can_ask_for_a_fresh_sign_in()
    {
        using var server = Server();
        var tab = Browser(server);
        var verifier = NewVerifier();
        await ConfirmInBrowser(tab, AppSignIn.ChallengeOf(verifier));

        using (var elsewhere = new HttpRequestMessage(HttpMethod.Get, HandoffUrl(AppSignIn.ChallengeOf(verifier)) + "&fresh=1"))
        {
            elsewhere.Headers.Add("Sec-Fetch-Site", "cross-site");
            Assert.Equal(HttpStatusCode.OK, (await tab.SendAsync(elsewhere, Token)).StatusCode);
        }
        using (var elsewhere = new HttpRequestMessage(HttpMethod.Get, "/auth/oidc/fake/login?returnUrl=/today&fresh=1"))
        {
            elsewhere.Headers.Add("Sec-Fetch-Site", "cross-site");
            var login = await tab.SendAsync(elsewhere, Token);
            Assert.False(QueryHelpers.ParseQuery(login.Headers.Location!.Query).ContainsKey("prompt"));
        }
        // A browser that does not say where a request came from (a GET never carries Origin) could
        // be following a link elsewhere: the ordinary sign-in, nobody signed out.
        var unsaid = await tab.GetAsync("/auth/oidc/fake/login?returnUrl=/today&fresh=1", Token);
        Assert.False(QueryHelpers.ParseQuery(unsaid.Headers.Location!.Query).ContainsKey("prompt"));
        Assert.Equal(HttpStatusCode.OK, (await tab.GetAsync("/auth/me", Token)).StatusCode);

        // From the web app's own delete page, in a browser: signed out, and the provider asks again.
        using var own = new HttpRequestMessage(HttpMethod.Get, "/auth/oidc/fake/login?returnUrl=/today&fresh=1");
        own.Headers.Add("Sec-Fetch-Site", "same-origin");
        var fresh = await tab.SendAsync(own, Token);
        Assert.Equal("login", QueryHelpers.ParseQuery(fresh.Headers.Location!.Query)["prompt"].ToString());
        Assert.Equal(HttpStatusCode.Unauthorized, (await tab.GetAsync("/auth/me", Token)).StatusCode);
    }

    [Theory]
    [InlineData("/auth/app/handoff")]
    [InlineData("/auth/app/redeem")]
    [InlineData("/auth/app/gate")]
    public async Task A_nul_in_a_sign_in_form_is_a_bad_request_not_a_crash(string path)
    {
        // Security C2 (2026-11-06): the form reader throws on a NUL, which went unhandled (a 500).
        using var server = Server();
        var browser = Browser(server);
        var response = await browser.PostAsync(path, Form(
            ("code", "a\0b"), ("verifier", "v\0"), ("challenge", "c\0"), ("scheme", Scheme + "\0"), ("key", "k\0"), ("returnUrl", "/\0")), Token);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        // Nor is a body that is not a form (Security's re-read).
        Assert.Equal(HttpStatusCode.BadRequest, (await browser.PostAsJsonAsync(path, new { code = "a" }, Token)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await browser.PostAsync(path, null, Token)).StatusCode);
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

    /// <summary>What an Android WebView adds to its requests: its app's package name.</summary>
    private static readonly (string, string) WebView = ("X-Requested-With", "com.pecklist.app");

    private static HttpRequestMessage RedeemRequest(Uri appLink, string verifier, params (string Name, string Value)[] headers)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, "/auth/app/redeem")
        {
            Content = Form(("code", CodeOf(appLink)), ("verifier", verifier)),
        };
        foreach (var (name, value) in headers) request.Headers.Add(name, value);
        return request;
    }

    /// <summary>
    /// To a server over plain http the app's WebView posts the redeem with no Sec-Fetch-Site (sent
    /// only to secure origins) and Origin: null (a navigation no page started), and the same-origin
    /// guard (audit S11) refused it: the app came back from the browser to a cross_site page
    /// (Appium, 2026-11-21). That path alone takes Origin: null now, with the X-Requested-With the
    /// WebView adds (a page's form cannot), and the code and its verifier still decide.
    /// </summary>
    [Fact]
    public async Task The_redeem_over_plain_http_comes_with_origin_null_and_still_needs_its_code_and_verifier()
    {
        using var server = Server();
        var verifier = NewVerifier();
        var appLink = await ConfirmInBrowser(Browser(server), AppSignIn.ChallengeOf(verifier));
        var app = Browser(server);
        using (var redeem = RedeemRequest(appLink, verifier, ("Origin", "null"), WebView))
        {
            var redeemed = await app.SendAsync(redeem, Token);
            Assert.Equal(HttpStatusCode.Redirect, redeemed.StatusCode);
            Assert.Equal("/today", redeemed.Headers.Location!.ToString());
        }
        Assert.Equal("kim", (await app.GetFromJsonAsync<Me>("/auth/me", Token))!.Username);

        // Without the right verifier, or with a code already used, nobody is signed in.
        var other = NewVerifier();
        var otherLink = await ConfirmInBrowser(Browser(server), AppSignIn.ChallengeOf(other));
        var stranger = Browser(server);
        foreach (var (link, proof) in new[] { (otherLink, NewVerifier()), (otherLink, other), (appLink, verifier) })
        {
            using var attempt = RedeemRequest(link, proof, ("Origin", "null"), WebView);
            var refused = await stranger.SendAsync(attempt, Token);
            Assert.Equal("/login?error=app_sign_in_failed", refused.Headers.Location!.ToString());
        }
        Assert.Equal(HttpStatusCode.Unauthorized, (await stranger.GetAsync("/auth/me", Token)).StatusCode);
    }

    /// <summary>
    /// Only Origin: null with no Sec-Fetch-Site and a WebView's X-Requested-With gets through, and
    /// only on the redeem. Another site's form (Origin: null under no-referrer) has no such header.
    /// </summary>
    [Theory]
    [InlineData("/auth/app/redeem", "Origin", "https://evil.example", "com.pecklist.app")]
    [InlineData("/auth/app/redeem", "Sec-Fetch-Site", "cross-site", "com.pecklist.app")]
    [InlineData("/auth/app/redeem", "Origin", "null", "")]
    [InlineData("/auth/app/redeem", "Origin", "null", "XMLHttpRequest")]
    [InlineData("/auth/app/handoff", "Origin", "null", "com.pecklist.app")]
    [InlineData("/auth/app/link-start", "Origin", "null", "com.pecklist.app")]
    [InlineData("/auth/login", "Origin", "null", "com.pecklist.app")]
    public async Task Any_other_cross_site_change_is_still_refused(string path, string header, string value, string requestedWith)
    {
        using var server = Server();
        using var request = new HttpRequestMessage(HttpMethod.Post, path) { Content = Form(("code", "x"), ("verifier", "y")) };
        request.Headers.Add(header, value);
        if (requestedWith.Length > 0) request.Headers.Add("X-Requested-With", requestedWith);
        var refused = await Browser(server).SendAsync(request, Token);
        Assert.Equal(HttpStatusCode.Forbidden, refused.StatusCode);
        Assert.Equal("cross_site", (await refused.Content.ReadFromJsonAsync<AuthError>(Token))!.Error);
    }

    /// <summary>
    /// The Android app's id is its URL scheme. It moved from com.killswitch10.pecklist to
    /// com.pecklist.app (a new app beside the old one), and both stay in use until people move over.
    /// </summary>
    [Theory]
    [InlineData("com.pecklist.app")]
    [InlineData("com.killswitch10.pecklist")]
    public async Task Both_android_app_ids_get_their_sign_in_back(string scheme)
    {
        using var server = Server();
        var verifier = NewVerifier();
        // Both are simply PeckList to the person confirming: the ID shows only in the hidden field.
        var appLink = await ConfirmInBrowser(Browser(server), AppSignIn.ChallengeOf(verifier), scheme, html =>
        {
            Assert.Contains("Open PeckList on this device?", html);
            Assert.DoesNotContain(scheme, html.Replace($"value=\"{scheme}\"", ""));
        });
        Assert.Equal((scheme, "auth"), (appLink.Scheme, appLink.Host));

        var app = Browser(server);
        var redeemed = await app.PostAsync("/auth/app/redeem", Form(("code", CodeOf(appLink)), ("verifier", verifier)), Token);
        Assert.Equal("/today", redeemed.Headers.Location!.ToString());
    }

    /// <summary>
    /// Any reverse-domain scheme may start a hand-off (forks, one's own builds), so another app can
    /// open it too: the confirm page names that app and says it is not PeckList (Security, PL-070).
    /// </summary>
    [Fact]
    public async Task Another_app_is_named_on_the_confirm_page()
    {
        using var server = Server();
        var verifier = NewVerifier();
        await ConfirmInBrowser(Browser(server), AppSignIn.ChallengeOf(verifier), "com.example.notes", html =>
        {
            Assert.Contains("Sign in to another app?", html);
            Assert.Contains("<strong>com.example.notes</strong>", html);
            Assert.Contains("It is not the PeckList app", html);
            Assert.DoesNotContain("Open PeckList on this device?", html);
        });
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
        // Refused before it reaches the button's own check (audit S11).
        Assert.Equal(HttpStatusCode.Forbidden, (await tab.SendAsync(forged, Token)).StatusCode);
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

    [Fact]
    public async Task A_provider_this_server_does_not_have_gets_no_confirm_page()
    {
        using var server = Server();
        var tab = Browser(server);
        var challenge = AppSignIn.ChallengeOf(NewVerifier());
        await ConfirmInBrowser(tab, challenge);

        string Page(string query) => $"/auth/app/handoff?{query}challenge={challenge}&scheme={Scheme}";
        Assert.Equal(HttpStatusCode.NotFound, (await tab.GetAsync(Page("provider=nope&"), Token)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await tab.GetAsync(Page("provider=fake&"), Token)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await tab.GetAsync(Page("provider=passkey&"), Token)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await tab.GetAsync(Page(""), Token)).StatusCode);
    }

    private async Task<HttpClient> SignedInAdmin(WebApplicationFactory<Program> server)
    {
        var admin = Browser(server);
        (await admin.PostAsJsonAsync("/auth/login", new { username = "admin", password = "correct horse battery" }, Token))
            .EnsureSuccessStatusCode();
        return admin;
    }

    [Fact]
    public async Task The_app_links_a_provider_account_through_a_tab_without_a_session()
    {
        using var server = Server();
        var app = await SignedInAdmin(server);
        var start = await app.PostAsJsonAsync("/auth/app/link-start", new { provider = "fake", scheme = Scheme }, Token);
        start.EnsureSuccessStatusCode();
        var url = (await start.Content.ReadFromJsonAsync<AppSignIn.LinkStartResult>(Token))!.Url;

        var tab = Browser(server);
        var challenge = await tab.GetAsync(url, Token);
        Assert.Equal(HttpStatusCode.Redirect, challenge.StatusCode);
        var back = await tab.GetAsync(provider.Authorize(challenge.Headers.Location!, Kim()), Token);
        var appLink = back.Headers.Location!;
        Assert.Equal((Scheme, "link", "?result=linked"), (appLink.Scheme, appLink.Host, appLink.Query));
        // The tab got no session of its own.
        Assert.Equal(HttpStatusCode.Unauthorized, (await tab.GetAsync("/auth/me", Token)).StatusCode);

        var methods = await app.GetFromJsonAsync<SignInMethods>("/api/account/sign-in", Token);
        Assert.Equal("fake", Assert.Single(methods!.Identities).Provider);

        // The code was used up.
        Assert.Equal(HttpStatusCode.BadRequest, (await Browser(server).GetAsync(url, Token)).StatusCode);
    }

    [Fact]
    public async Task Only_a_signed_in_app_can_start_a_link()
    {
        using var server = Server();
        var nobody = await Browser(server).PostAsJsonAsync("/auth/app/link-start", new { provider = "fake", scheme = Scheme }, Token);
        Assert.Equal(HttpStatusCode.Unauthorized, nobody.StatusCode);
        var app = await SignedInAdmin(server);
        Assert.Equal(HttpStatusCode.BadRequest,
            (await app.PostAsJsonAsync("/auth/app/link-start", new { provider = "fake", scheme = "https" }, Token)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound,
            (await app.PostAsJsonAsync("/auth/app/link-start", new { provider = "nope", scheme = Scheme }, Token)).StatusCode);
    }

    [Fact]
    public async Task The_app_gets_past_a_gate_with_its_cookies_sealed_to_the_app_key()
    {
        using var server = Server();
        var tab = Browser(server);
        using var appKey = RSA.Create(2048);
        var key = Convert.ToBase64String(appKey.ExportSubjectPublicKeyInfo()).TrimEnd('=').Replace('+', '-').Replace('/', '_');

        // A bad key or scheme: no page.
        Assert.Equal(HttpStatusCode.BadRequest, (await tab.GetAsync($"/auth/app/gate?key=nope&scheme={Scheme}", Token)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await tab.GetAsync($"/auth/app/gate?key={key}&scheme=https", Token)).StatusCode);
        var page = await tab.GetAsync($"/auth/app/gate?key={key}&scheme={Scheme}", Token);
        Assert.Equal(HttpStatusCode.OK, page.StatusCode);
        Assert.Contains("Let the PeckList app in?", await page.Content.ReadAsStringAsync(Token));

        HttpRequestMessage Confirm(string site)
        {
            var post = new HttpRequestMessage(HttpMethod.Post, "/auth/app/gate") { Content = Form(("key", key), ("scheme", Scheme)) };
            // The gate's cookie, and ours, as the browser sends them past the gate.
            post.Headers.Add("Cookie", "p_session_token=gate-secret; punchlist_session=ours; .AspNetCore.Correlation.x=flow");
            post.Headers.Add("Sec-Fetch-Site", site);
            post.Headers.Add("Origin", site == "same-origin" ? "http://localhost" : "https://evil.example");
            return post;
        }

        // Only from our own page.
        Assert.Equal(HttpStatusCode.Forbidden, (await tab.SendAsync(Confirm("cross-site"), Token)).StatusCode);

        var back = await tab.SendAsync(Confirm("same-origin"), Token);
        Assert.Equal(HttpStatusCode.Redirect, back.StatusCode);
        var link = back.Headers.Location!;
        Assert.Equal((Scheme, "gate"), (link.Scheme, link.Host));
        var sealedData = Convert.FromBase64String(PadBase64(QueryHelpers.ParseQuery(link.Query)["data"].ToString()));

        // As the app opens it (Gate.open): only the gate's cookie, none of ours.
        var aesKey = appKey.Decrypt(sealedData[..256], RSAEncryptionPadding.OaepSHA256);
        var nonce = sealedData[256..268];
        var ciphertext = sealedData[268..^16];
        var plain = new byte[ciphertext.Length];
        using (var aes = new AesGcm(aesKey, 16)) aes.Decrypt(nonce, ciphertext, sealedData[^16..], plain);
        var cookies = JsonNode.Parse(plain)!.AsArray().Select(each => ((string)each!["Name"]!, (string)each["Value"]!)).ToList();
        Assert.Equal([("p_session_token", "gate-secret")], cookies);
    }

    private static string PadBase64(string url)
    {
        var text = url.Replace('-', '+').Replace('_', '/');
        return text.PadRight(text.Length + (4 - text.Length % 4) % 4, '=');
    }
}
