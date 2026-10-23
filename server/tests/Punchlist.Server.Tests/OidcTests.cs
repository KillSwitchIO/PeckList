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
    private async Task<string> SignIn(HttpClient browser, Dictionary<string, object> claims, string returnUrl = "/", string? invite = null)
    {
        var start = await browser.GetAsync(
            $"/auth/oidc/fake/login?returnUrl={Uri.EscapeDataString(returnUrl)}{(invite is null ? "" : $"&invite={Uri.EscapeDataString(invite)}")}", Token);
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

    [Fact]
    public async Task Signing_out_ends_the_provider_session_too_when_asked()
    {
        using var server = Server(("OIDC_FAKE_AUTO_CREATE", "true"), ("OIDC_FAKE_SIGN_OUT", "true"));
        var kim = Browser(server);
        Assert.Equal("/", await SignIn(kim, Kim()));
        var answer = await kim.PostAsync("/auth/logout", null, Token);
        Assert.Equal(HttpStatusCode.OK, answer.StatusCode);
        var next = new Uri((await answer.Content.ReadFromJsonAsync<SignOutResult>(Token))!.Redirect);
        Assert.Equal($"{FakeOidcProvider.Authority}/logout", next.GetLeftPart(UriPartial.Path));
        var query = Microsoft.AspNetCore.WebUtilities.QueryHelpers.ParseQuery(next.Query);
        Assert.Equal(FakeOidcProvider.ClientId, query["client_id"].ToString());
        Assert.Equal("http://localhost/login", query["post_logout_redirect_uri"].ToString());
        Assert.Equal(3, query["id_token_hint"].ToString().Split('.').Length);
        Assert.Equal(HttpStatusCode.Unauthorized, (await kim.GetAsync("/auth/me", Token)).StatusCode);
    }

    [Fact]
    public async Task Signing_out_leaves_the_provider_alone_by_default_and_for_passwords()
    {
        using var server = Server(("OIDC_FAKE_AUTO_CREATE", "true"));
        var kim = Browser(server);
        await SignIn(kim, Kim());
        Assert.Equal(HttpStatusCode.NoContent, (await kim.PostAsync("/auth/logout", null, Token)).StatusCode);

        using var asking = Server(("OIDC_FAKE_SIGN_OUT", "true"));
        var admin = Browser(asking);
        (await admin.PostAsJsonAsync("/auth/login", new { username = "admin", password = AdminPassword }, Token)).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.NoContent, (await admin.PostAsync("/auth/logout", null, Token)).StatusCode);
    }

    [Fact]
    public async Task Without_auto_create_an_invite_link_lets_them_in_once()
    {
        using var server = Server();
        var admin = Browser(server);
        (await admin.PostAsJsonAsync("/auth/login", new { username = "admin", password = AdminPassword }, Token)).EnsureSuccessStatusCode();
        var invite = (await (await admin.PostAsJsonAsync("/api/admin/invites", new { note = "Kim" }, Token))
            .Content.ReadFromJsonAsync<NewInvite>(Token))!;
        var token = invite.Url[(invite.Url.LastIndexOf('/') + 1)..];

        var kim = Browser(server);
        Assert.Equal("/", await SignIn(kim, Kim(), invite: token));
        Assert.Equal("kim", (await kim.GetFromJsonAsync<Me>("/auth/me", Token))!.Username);
        Assert.Equal(["kim"], (await admin.GetFromJsonAsync<AdminUser[]>("/api/admin/users", Token))!
            .Where(user => user.Providers.Contains("fake")).Select(user => user.Username));
        Assert.Empty((await admin.GetFromJsonAsync<PendingSignIn[]>("/api/admin/pending-signins", Token))!);

        // The invite is spent: the next newcomer waits for an admin as usual.
        var lee = new Dictionary<string, object>(Kim()) { ["sub"] = "lee-subject", ["preferred_username"] = "lee" };
        Assert.Equal("/login?error=oidc_pending", await SignIn(Browser(server), lee, invite: token));
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

    private static async Task<(HttpClient Browser, string Id)> PasswordUser(WebApplicationFactory<Program> server, string username)
    {
        const string password = "a long enough password";
        var account = await server.Services.GetRequiredService<AccountService>()
            .CreateUserAsync(username, password, mustChangePassword: false, cancellation: Token);
        var browser = Browser(server);
        (await browser.PostAsJsonAsync("/auth/login", new { username, password }, Token)).EnsureSuccessStatusCode();
        return (browser, account.Id);
    }

    [Fact]
    public async Task A_signed_in_user_links_a_provider_and_then_signs_in_with_it()
    {
        using var server = Server();
        var (ben, benId) = await PasswordUser(server, "ben");
        var before = await ben.GetFromJsonAsync<SignInMethods>("/api/account/sign-in", Token);
        Assert.True(before!.Password);
        Assert.Equal(["fake"], before.CanLink.Select(option => option.Name));

        var start = await ben.GetAsync(before.CanLink[0].Url, Token);
        var back = await ben.GetAsync(provider.Authorize(start.Headers.Location!, Kim()), Token);
        Assert.Equal("/settings?link=linked", back.Headers.Location!.ToString());
        var after = await ben.GetFromJsonAsync<SignInMethods>("/api/account/sign-in", Token);
        Assert.Equal(("fake", "Fake ID", "kim@example.com"), (after!.Identities[0].Provider, after.Identities[0].DisplayName, after.Identities[0].Email));
        Assert.Empty(after.CanLink);

        // Auto-create is off, yet the linked provider account signs straight in to ben.
        var phone = Browser(server);
        Assert.Equal("/", await SignIn(phone, Kim()));
        Assert.Equal(benId, (await phone.GetFromJsonAsync<Me>("/auth/me", Token))!.Id);

        // Ben has a password, so unlinking is fine.
        Assert.Equal(HttpStatusCode.NoContent, (await ben.DeleteAsync("/api/account/identities/fake/kim-subject", Token)).StatusCode);
    }

    [Fact]
    public async Task A_link_finishes_only_for_the_person_who_started_it()
    {
        using var server = Server();
        var (ben, _) = await PasswordUser(server, "ben");
        var start = await ben.GetAsync("/auth/oidc/fake/link", Token);
        // Someone else signs in on this browser before the provider answers.
        const string password = "a long enough password";
        await server.Services.GetRequiredService<AccountService>().CreateUserAsync("sam", password, mustChangePassword: false, cancellation: Token);
        (await ben.PostAsJsonAsync("/auth/login", new { username = "sam", password }, Token)).EnsureSuccessStatusCode();
        var back = await ben.GetAsync(provider.Authorize(start.Headers.Location!, Kim()), Token);
        Assert.Equal("/settings?link=failed", back.Headers.Location!.ToString());
        Assert.Empty((await ben.GetFromJsonAsync<SignInMethods>("/api/account/sign-in", Token))!.Identities);
    }

    [Fact]
    public async Task Linking_needs_a_session_and_a_provider_account_nobody_else_has()
    {
        using var server = Server(("OIDC_FAKE_AUTO_CREATE", "true"));
        Assert.Equal(HttpStatusCode.Unauthorized, (await Browser(server).GetAsync("/auth/oidc/fake/link", Token)).StatusCode);
        await SignIn(Browser(server), Kim());

        var (ben, _) = await PasswordUser(server, "ben");
        var start = await ben.GetAsync("/auth/oidc/fake/link", Token);
        var back = await ben.GetAsync(provider.Authorize(start.Headers.Location!, Kim()), Token);
        Assert.Equal("/settings?link=taken", back.Headers.Location!.ToString());
    }

    [Fact]
    public async Task Someone_left_with_no_way_in_gets_a_one_time_link()
    {
        using var server = Server(("OIDC_FAKE_AUTO_CREATE", "true"));
        var kim = Browser(server);
        await SignIn(kim, Kim());
        var kimId = (await kim.GetFromJsonAsync<Me>("/auth/me", Token))!.Id;
        Assert.Equal(HttpStatusCode.Conflict, (await kim.DeleteAsync("/api/account/identities/fake/kim-subject", Token)).StatusCode);

        var admin = Browser(server);
        (await admin.PostAsJsonAsync("/auth/login", new { username = "admin", password = AdminPassword }, Token)).EnsureSuccessStatusCode();
        var unbound = await (await admin.PostAsync("/api/admin/providers/fake/unbind-all", null, Token)).Content.ReadFromJsonAsync<UnbindResult>(Token);
        Assert.Equal(1, unbound!.Unbound);
        Assert.Equal(["kim"], unbound.Stranded);

        var link = await (await admin.PostAsync($"/api/admin/users/{kimId}/login-link", null, Token)).Content.ReadFromJsonAsync<LoginLinkView>(Token);
        var path = new Uri(link!.Url).PathAndQuery;
        var phone = Browser(server);
        Assert.Equal("/settings", (await phone.GetAsync(path, Token)).Headers.Location!.ToString());
        Assert.Equal(kimId, (await phone.GetFromJsonAsync<Me>("/auth/me", Token))!.Id);
        Assert.Equal("/login?error=link_expired", (await Browser(server).GetAsync(path, Token)).Headers.Location!.ToString());
    }

    [Fact]
    public async Task Admins_open_and_close_a_migration_window()
    {
        using var server = Server();
        var admin = Browser(server);
        (await admin.PostAsJsonAsync("/auth/login", new { username = "admin", password = AdminPassword }, Token)).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync("/api/admin/providers/fake/migration-window", new { hours = 2 }, Token)).StatusCode);
        var providers = await admin.GetFromJsonAsync<AdminProvider[]>("/api/admin/providers", Token);
        Assert.NotNull(Assert.Single(providers!).MigrationWindowUntil);

        // Ben's password account, and the new provider says "ben": they meet.
        var (_, benId) = await PasswordUser(server, "ben");
        var phone = Browser(server);
        var claims = Kim();
        claims["preferred_username"] = "ben";
        Assert.Equal("/", await SignIn(phone, claims));
        Assert.Equal(benId, (await phone.GetFromJsonAsync<Me>("/auth/me", Token))!.Id);

        Assert.Equal(HttpStatusCode.NoContent, (await admin.DeleteAsync("/api/admin/providers/fake/migration-window", Token)).StatusCode);
        Assert.Null((await admin.GetFromJsonAsync<AdminProvider[]>("/api/admin/providers", Token))![0].MigrationWindowUntil);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PutAsJsonAsync("/api/admin/providers/fake/migration-window", new { hours = 0 }, Token)).StatusCode);
    }

    private sealed class MovableClock(DateTimeOffset start) : TimeProvider
    {
        public DateTimeOffset Now { get; set; } = start;

        public override DateTimeOffset GetUtcNow() => Now;
    }

    [Fact]
    public async Task A_provider_session_ends_on_time_so_the_provider_checks_again()
    {
        var clock = new MovableClock(DateTimeOffset.UtcNow);
        using var server = Server(("OIDC_FAKE_AUTO_CREATE", "true"), ("OIDC_FAKE_SESSION_HOURS", "12"))
            .WithWebHostBuilder(host => host.ConfigureTestServices(services => services.AddSingleton<TimeProvider>(clock)));
        var kim = Browser(server);
        await SignIn(kim, Kim());
        var (ben, _) = await PasswordUser(server, "ben");

        clock.Now += TimeSpan.FromHours(11);
        Assert.Equal(HttpStatusCode.OK, (await kim.GetAsync("/auth/me", Token)).StatusCode);
        // Using it does not stretch it.
        clock.Now += TimeSpan.FromHours(2);
        Assert.Equal(HttpStatusCode.Unauthorized, (await kim.GetAsync("/auth/me", Token)).StatusCode);
        // Password sessions keep their 30 days.
        Assert.Equal(HttpStatusCode.OK, (await ben.GetAsync("/auth/me", Token)).StatusCode);
    }

    [Fact]
    public async Task An_admin_links_a_provider_account_by_hand_and_that_person_signs_in_to_it()
    {
        using var server = Server();
        var admin = Browser(server);
        (await admin.PostAsJsonAsync("/auth/login", new { username = "admin", password = AdminPassword }, Token)).EnsureSuccessStatusCode();
        var sam = await server.Services.GetRequiredService<AccountService>().CreateUserAsync("sam", "a long enough password", cancellation: Token);

        Assert.Equal(HttpStatusCode.BadRequest,
            (await admin.PostAsJsonAsync($"/api/admin/users/{sam.Id}/identities", new { provider = "nope", subject = "kim-subject" }, Token)).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent,
            (await admin.PostAsJsonAsync($"/api/admin/users/{sam.Id}/identities", new { provider = "fake", subject = "kim-subject" }, Token)).StatusCode);

        var browser = Browser(server);
        Assert.Equal("/", await SignIn(browser, Kim()));
        Assert.Equal("sam", (await browser.GetFromJsonAsync<Me>("/auth/me", Token))!.Username);
    }
}
