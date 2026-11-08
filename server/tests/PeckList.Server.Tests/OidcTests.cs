using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Authentication.OpenIdConnect;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using PeckList.Core;
using PeckList.Core.Accounts;
using PeckList.Server.Auth;

namespace PeckList.Server.Tests;

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
        using var server = Server(("LOCAL_LOGIN", "disabled"));
        var options = await Browser(server).GetFromJsonAsync<SignInOptions>("/auth/providers", Token);
        Assert.Equal([new SignInProvider("fake", "Fake ID", "/auth/providers/fake/icon")], options!.Providers);
        Assert.False(options.LocalLogin);
        Assert.Equal(HttpStatusCode.NotFound, (await Browser(server).GetAsync("/auth/oidc/nope/login", Token)).StatusCode);
    }

    [Fact]
    public async Task With_local_login_disabled_no_password_gets_in_by_any_route()
    {
        using var server = Server(("OIDC_FAKE_AUTO_CREATE", "true"), ("REGISTRATION", "open"));
        var admin = Browser(server);
        (await admin.PostAsJsonAsync("/auth/login", new { username = "admin", password = AdminPassword }, Token)).EnsureSuccessStatusCode();
        var adminId = (await admin.GetFromJsonAsync<Me>("/auth/me", Token))!.Id;
        var link = (await (await admin.PostAsync($"/api/admin/users/{adminId}/login-link", null, Token))
            .Content.ReadFromJsonAsync<LoginLinkView>(Token))!;
        var kim = Browser(server);
        await SignIn(kim, Kim());

        // Turned off on the settings page (a live setting): the password session that did it ends at once.
        (await admin.PutAsJsonAsync("/api/admin/settings",
            new { values = new Dictionary<string, string?> { ["LOCAL_LOGIN"] = "disabled" } }, Token)).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.Unauthorized, (await admin.GetAsync("/auth/me", Token)).StatusCode);

        // The right password, straight at the API, gets nowhere; nor does a new password account.
        var api = Browser(server);
        var refused = await api.PostAsJsonAsync("/auth/login", new { username = "admin", password = AdminPassword }, Token);
        Assert.Equal(HttpStatusCode.Forbidden, refused.StatusCode);
        Assert.Equal("local_login_disabled", (await refused.Content.ReadFromJsonAsync<AuthError>(Token))!.Error);
        Assert.Equal(HttpStatusCode.Unauthorized, (await api.GetAsync("/auth/me", Token)).StatusCode);
        var signUp = await api.PostAsJsonAsync("/auth/signup", new { username = "lee", password = AdminPassword }, Token);
        Assert.Equal(HttpStatusCode.Forbidden, signUp.StatusCode);
        Assert.False((await api.GetFromJsonAsync<SignInOptions>("/auth/providers", Token))!.LocalLogin);

        // A provider's session goes on; it cannot set a password either.
        Assert.Equal(HttpStatusCode.OK, (await kim.GetAsync("/auth/me", Token)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden,
            (await kim.PostAsJsonAsync("/auth/password", new { current = "x", next = "a brand new password" }, Token)).StatusCode);

        // The way back in for an admin: a one-time sign-in link (pecklist admin login-link).
        var tab = Browser(server);
        Assert.Equal(HttpStatusCode.Redirect, (await tab.PostAsync(new Uri(link.Url).PathAndQuery, null, Token)).StatusCode);
        var me = await tab.GetFromJsonAsync<Me>("/auth/me", Token);
        Assert.Equal(("admin", false), (me!.Username, me.MustChangePassword));
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
        using var server = Server(("OIDC_FAKE_AUTO_CREATE", "true"), ("OIDC_FAKE_REQUIRED_GROUPS", "pecklist"));
        var browser = Browser(server);
        Assert.Equal("/login?error=oidc_not_allowed", await SignIn(browser, Kim("family")));
        Assert.Equal(HttpStatusCode.Unauthorized, (await browser.GetAsync("/auth/me", Token)).StatusCode);

        Assert.Equal("/", await SignIn(browser, Kim("family", "pecklist")));
        Assert.Equal(HttpStatusCode.OK, (await browser.GetAsync("/auth/me", Token)).StatusCode);
    }

    [Fact]
    public async Task A_sign_in_with_no_groups_lowers_the_role_everywhere_at_once_and_the_next_with_the_group_restores_it()
    {
        using var server = Server(("OIDC_FAKE_AUTO_CREATE", "true"), ("OIDC_FAKE_ROLE_MAP", "pl-admins=admin"));
        var kim = Browser(server);
        await SignIn(kim, Kim("pl-admins"));
        var phone = Browser(server);
        await SignIn(phone, Kim("pl-admins"));
        Assert.Equal("admin", (await phone.GetFromJsonAsync<Me>("/auth/me", Token))!.Role);

        await SignIn(kim, Kim());
        Assert.Equal("user", (await kim.GetFromJsonAsync<Me>("/auth/me", Token))!.Role);
        Assert.Equal("user", (await phone.GetFromJsonAsync<Me>("/auth/me", Token))!.Role);

        await SignIn(kim, Kim("pl-admins"));
        Assert.Equal("admin", (await kim.GetFromJsonAsync<Me>("/auth/me", Token))!.Role);
        Assert.Equal("admin", (await phone.GetFromJsonAsync<Me>("/auth/me", Token))!.Role);
    }

    private static async Task<List<string?>> RoleEvents(WebApplicationFactory<Program> server)
    {
        // A request is recorded just after its answer goes out.
        await Task.Delay(100, Token);
        await server.Services.GetRequiredService<PeckList.Server.Audit.AuditLog>().FlushAsync(Token);
        var audit = await server.Services.GetRequiredService<PeckList.Core.Audit.IAuditStore>()
            .QueryAsync(new PeckList.Core.Audit.AuditQuery { Ascending = true }, Token);
        return [.. audit.Entries.Where(entry => entry.Type.StartsWith("auth.oidc-role-", StringComparison.Ordinal)).Select(entry => $"{entry.Type} {entry.TargetName}: {entry.Detail}")];
    }

    [Fact]
    public async Task Every_role_a_sign_in_changes_is_in_the_audit_log()
    {
        using var server = Server(("OIDC_FAKE_AUTO_CREATE", "true"), ("OIDC_FAKE_ROLE_MAP", "pl-admins=admin"));
        var kim = Browser(server);
        await SignIn(kim, Kim("pl-admins"));
        await SignIn(kim, Kim("pl-admins"));
        await SignIn(kim, Kim());
        await SignIn(kim, Kim("pl-admins"));
        await SignIn(kim, Kim("family"));

        Assert.Equal([
            "auth.oidc-role-changed kim: fake groups changed user to admin.",
            "auth.oidc-role-changed kim: fake sent no groups, so admin became user. If the claim was dropped, a role from ROLE_MAP returns at the next sign-in with groups.",
            "auth.oidc-role-changed kim: fake groups changed user to admin.",
            "auth.oidc-role-changed kim: fake groups changed admin to user.",
        ], await RoleEvents(server));
    }

    [Fact]
    public async Task A_role_an_invite_or_an_approval_gives_from_the_map_is_in_the_audit_log()
    {
        using var server = Server(("OIDC_FAKE_ROLE_MAP", "pl-admins=admin"));
        var admin = Browser(server);
        (await admin.PostAsJsonAsync("/auth/login", new { username = "admin", password = AdminPassword }, Token)).EnsureSuccessStatusCode();
        var invite = (await (await admin.PostAsJsonAsync("/api/admin/invites", new { note = "Kim" }, Token))
            .Content.ReadFromJsonAsync<NewInvite>(Token))!;

        var kim = Browser(server);
        await SignIn(kim, Kim("pl-admins"), invite: invite.Url[(invite.Url.LastIndexOf('/') + 1)..]);
        Assert.Equal("admin", (await kim.GetFromJsonAsync<Me>("/auth/me", Token))!.Role);
        Assert.Equal(["auth.oidc-role-changed kim: fake groups changed user to admin."], await RoleEvents(server));

        var lee = new Dictionary<string, object>(Kim("pl-admins")) { ["sub"] = "lee-subject", ["preferred_username"] = "lee" };
        Assert.Equal("/login?error=oidc_pending", await SignIn(Browser(server), lee));
        (await admin.PostAsync("/api/admin/pending-signins/fake/lee-subject/approve", null, Token)).EnsureSuccessStatusCode();
        await Task.Delay(100, Token);
        await server.Services.GetRequiredService<PeckList.Server.Audit.AuditLog>().FlushAsync(Token);
        var audit = await server.Services.GetRequiredService<PeckList.Core.Audit.IAuditStore>()
            .QueryAsync(new PeckList.Core.Audit.AuditQuery { Ascending = true }, Token);
        var approved = Assert.Single(audit.Entries, entry => entry.Type == "admin.pending-approved");
        Assert.Equal(("lee", "fake, role admin"), (approved.TargetName, approved.Detail));
    }

    [Fact]
    public async Task A_sign_in_that_would_lower_the_only_super_admin_is_in_the_audit_log()
    {
        using var server = Server(("OIDC_FAKE_AUTO_CREATE", "true"), ("OIDC_FAKE_ROLE_MAP", "pl-owners=superadmin"));
        var kim = Browser(server);
        await SignIn(kim, Kim("pl-owners"));
        var service = server.Services.GetRequiredService<AccountService>();
        await service.SetRoleAsync((await server.Services.GetRequiredService<IAccountStore>().FindByUsernameAsync("admin", Token))!.Id, Role.User, Token);

        await SignIn(kim, Kim());

        Assert.Equal("superadmin", (await kim.GetFromJsonAsync<Me>("/auth/me", Token))!.Role);
        Assert.Equal(
            "auth.oidc-role-kept kim: fake would have lowered the only super admin, so the role stays. Make someone else a super admin, then lower this account in PeckList.",
            (await RoleEvents(server))[^1]);
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
    public async Task A_provider_sign_in_skips_the_temporary_password_but_the_password_still_asks()
    {
        using var server = Server(("OIDC_FAKE_LINK_BY_USERNAME", "true"));
        const string password = "a temporary password";
        await server.Services.GetRequiredService<AccountService>()
            .CreateUserAsync("kim", password, mustChangePassword: true, cancellation: Token);

        var phone = Browser(server);
        Assert.Equal("/", await SignIn(phone, Kim()));
        var me = await phone.GetFromJsonAsync<Me>("/auth/me", Token);
        Assert.Equal(("kim", false), (me!.Username, me.MustChangePassword));
        Assert.Equal(HttpStatusCode.OK, (await phone.GetAsync("/api/account/sign-in", Token)).StatusCode);

        var laptop = Browser(server);
        (await laptop.PostAsJsonAsync("/auth/login", new { username = "kim", password }, Token)).EnsureSuccessStatusCode();
        Assert.True((await laptop.GetFromJsonAsync<Me>("/auth/me", Token))!.MustChangePassword);
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
        Assert.Equal("/settings", (await phone.PostAsync(path, null, Token)).Headers.Location!.ToString());
        Assert.Equal(kimId, (await phone.GetFromJsonAsync<Me>("/auth/me", Token))!.Id);
        Assert.Equal("/login?error=link_expired", (await Browser(server).PostAsync(path, null, Token)).Headers.Location!.ToString());
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

    [Fact]
    public async Task The_session_knows_its_provider_and_the_server_serves_the_providers_icon()
    {
        using var server = Server(("OIDC_FAKE_AUTO_CREATE", "true"));
        var browser = Browser(server);
        Assert.Equal(HttpStatusCode.NotFound, (await browser.GetAsync("/auth/providers/fake/icon", Token)).StatusCode);

        await SignIn(browser, Kim());
        Assert.Equal("fake", (await browser.GetFromJsonAsync<Me>("/auth/me", Token))!.Provider);
        var admin = Browser(server);
        (await admin.PostAsJsonAsync("/auth/login", new { username = "admin", password = AdminPassword }, Token)).EnsureSuccessStatusCode();
        Assert.Null((await admin.GetFromJsonAsync<Me>("/auth/me", Token))!.Provider);

        // A miss is remembered for an hour, so a fresh server sees the icon the provider now has.
        // Servers often call an .ico a plain octet stream: its first bytes say what it is.
        provider.Favicon = ([0, 0, 1, 0], "application/octet-stream");
        using var later = Server();
        var icon = await Browser(later).GetAsync("/auth/providers/fake/icon", Token);
        Assert.Equal(HttpStatusCode.OK, icon.StatusCode);
        Assert.Equal("image/x-icon", icon.Content.Headers.ContentType!.MediaType);
        Assert.Equal([0, 0, 1, 0], await icon.Content.ReadAsByteArrayAsync(Token));
        Assert.Contains("sandbox", icon.Headers.GetValues("Content-Security-Policy").Single());

        // A web page where the icon should be is no icon...
        provider.Favicon = ("<html></html>"u8.ToArray(), "text/html");
        using var html = Server();
        Assert.Equal(HttpStatusCode.NotFound, (await Browser(html).GetAsync("/auth/providers/fake/icon", Token)).StatusCode);

        // ...but the icon the home page links to is.
        provider.HomePage = "<html><head><link rel=\"apple-touch-icon\" href=\"/nope.png\"><link href='img/icon.png' rel='icon' /></head></html>";
        using var linked = Server();
        var png = await Browser(linked).GetAsync("/auth/providers/fake/icon", Token);
        Assert.Equal("image/png", png.Content.Headers.ContentType!.MediaType);
    }

    [Fact]
    public void Icon_links_come_plain_icons_first()
    {
        Assert.Equal(
            ["/api/application-images/favicon", "/img/static-logo-512.png"],
            ProviderIcons.IconLinks(
                "<link rel=\"apple-touch-icon\" href=\"/img/static-logo-512.png\" />" +
                "<link rel=\"stylesheet\" href=\"/app.css\">" +
                "<link rel=\"icon\" href=\"/api/application-images/favicon\" />"));
        Assert.Equal(["resources/x/favicon.ico"], ProviderIcons.IconLinks("<LINK REL=\"shortcut icon\" HREF=resources/x/favicon.ico>"));
    }

    private static async Task<List<PeckList.Core.Audit.AuditEntry>> MappingEvents(WebApplicationFactory<Program> server)
    {
        // A request is recorded just after its answer goes out.
        await Task.Delay(100, Token);
        await server.Services.GetRequiredService<PeckList.Server.Audit.AuditLog>().FlushAsync(Token);
        var audit = await server.Services.GetRequiredService<PeckList.Core.Audit.IAuditStore>()
            .QueryAsync(new PeckList.Core.Audit.AuditQuery { Ascending = true }, Token);
        return [.. audit.Entries.Where(entry => entry.Type.StartsWith("auth.oidc-mapping-", StringComparison.Ordinal))];
    }

    [Fact]
    public async Task A_refused_mapping_tells_an_admin_what_to_do_without_naming_the_subject()
    {
        using var server = Server(("OIDC_FAKE_AUTO_CREATE", "true"), ("OIDC_FAKE_USER_MAP", "kim=admin"));
        var kim = Browser(server);
        await SignIn(kim, Kim());
        Assert.Equal("user", (await kim.GetFromJsonAsync<Me>("/auth/me", Token))!.Role);

        var note = Assert.Single(await MappingEvents(server));
        Assert.Equal(("auth.oidc-mapping-refused", "admin"), (note.Type, note.TargetName));
        Assert.Contains("Admin > Sign-in", note.Detail);
        Assert.Contains("OIDC_FAKE_USER_MAP", note.Detail);
        Assert.Contains("OIDC_FAKE_LINK_BY_USERNAME=all", note.Detail);
        Assert.DoesNotContain("kim-subject", note.Detail);
    }

    [Fact]
    public async Task A_sub_entry_signs_an_admin_in_and_shows_on_the_page()
    {
        using var server = Server(("OIDC_FAKE_AUTO_CREATE", "true"), ("OIDC_FAKE_USER_MAP", "sub:kim-subject=admin"));
        var kim = Browser(server);
        await SignIn(kim, Kim());
        Assert.Equal("admin", (await kim.GetFromJsonAsync<Me>("/auth/me", Token))!.Username);

        var overview = await kim.GetFromJsonAsync<OidcOverview>("/api/admin/oidc", Token);
        var shown = Assert.Single(overview!.Mappings);
        Assert.Equal(("sub:kim-subject", "admin", "settings"), (shown.ProviderUsername, shown.AccountUsername, shown.Source));
        Assert.Empty(await MappingEvents(server));
    }

    [Fact]
    public async Task Unbind_all_needs_a_super_admin_when_another_admin_is_linked()
    {
        using var server = Server();
        var admin = Browser(server);
        (await admin.PostAsJsonAsync("/auth/login", new { username = "admin", password = AdminPassword }, Token)).EnsureSuccessStatusCode();
        const string password = "a long enough password";
        var accounts = server.Services.GetRequiredService<AccountService>();
        var person = await accounts.CreateUserAsync("person", password, mustChangePassword: false, cancellation: Token);
        var boss = await accounts.CreateUserAsync("boss", password, Role.Admin, mustChangePassword: false, cancellation: Token);
        var other = await accounts.CreateUserAsync("other", password, Role.Admin, mustChangePassword: false, cancellation: Token);
        var plain = Browser(server);
        (await plain.PostAsJsonAsync("/auth/login", new { username = "boss", password }, Token)).EnsureSuccessStatusCode();

        async Task Link(string id, string subject) =>
            (await admin.PostAsJsonAsync($"/api/admin/users/{id}/identities", new { provider = "fake", subject }, Token)).EnsureSuccessStatusCode();
        Task<HttpResponseMessage> UnbindAll(HttpClient who) => who.PostAsync("/api/admin/providers/fake/unbind-all", null, Token);
        async Task<int> Links() => (await server.Services.GetRequiredService<IIdentityStore>().ListAsync(Token)).Count;

        // People and a plain admin's own link: that admin may.
        await Link(person.Id, "person-1");
        await Link(boss.Id, "boss-1");
        Assert.Equal(2, (await (await UnbindAll(plain)).Content.ReadFromJsonAsync<UnbindResult>(Token))!.Unbound);
        Assert.Equal(0, await Links());

        // Another admin's link: refused whole, and a super admin may.
        await Link(person.Id, "person-2");
        await Link(other.Id, "other-1");
        var refused = await UnbindAll(plain);
        Assert.Equal(HttpStatusCode.Forbidden, refused.StatusCode);
        Assert.Contains("admin_linked", await refused.Content.ReadAsStringAsync(Token));
        Assert.Equal(2, await Links());
        Assert.Equal(2, (await (await UnbindAll(admin)).Content.ReadFromJsonAsync<UnbindResult>(Token))!.Unbound);
        Assert.Equal(0, await Links());
    }

    [Fact]
    public async Task A_saved_mapping_refuses_an_admin_account_and_a_subject_and_says_when_it_is_used()
    {
        using var server = Server(("OIDC_FAKE_AUTO_CREATE", "true"));
        var admin = Browser(server);
        (await admin.PostAsJsonAsync("/auth/login", new { username = "admin", password = AdminPassword }, Token)).EnsureSuccessStatusCode();
        var accounts = server.Services.GetRequiredService<AccountService>();
        var kimberly = await accounts.CreateUserAsync("kimberly", "a long enough password", cancellation: Token);
        var boss = await accounts.CreateUserAsync("boss", "a long enough password", Role.Admin, cancellation: Token);
        Task<HttpResponseMessage> Save(string username, string accountId) =>
            admin.PutAsJsonAsync("/api/admin/oidc/mappings", new { provider = "fake", providerUsername = username, accountId }, Token);

        var refused = await Save("kim", boss.Id);
        Assert.Equal(HttpStatusCode.Conflict, refused.StatusCode);
        Assert.Contains("admin_needs_subject", await refused.Content.ReadAsStringAsync(Token));
        var subject = await Save("SUB:kim-subject", kimberly.Id);
        Assert.Equal(HttpStatusCode.BadRequest, subject.StatusCode);
        Assert.Contains("subject_not_username", await subject.Content.ReadAsStringAsync(Token));

        Assert.Equal(HttpStatusCode.NoContent, (await Save("kim", kimberly.Id)).StatusCode);
        var kim = Browser(server);
        await SignIn(kim, Kim());
        Assert.Equal("kimberly", (await kim.GetFromJsonAsync<Me>("/auth/me", Token))!.Username);

        var note = Assert.Single(await MappingEvents(server));
        Assert.Equal(("auth.oidc-mapping-used", "kim"), (note.Type, note.TargetName));
        Assert.DoesNotContain("kim-subject", note.Detail);
        Assert.Empty((await admin.GetFromJsonAsync<OidcOverview>("/api/admin/oidc", Token))!.Mappings);
    }

    [Fact]
    public async Task Admins_see_who_is_paired_with_what_and_map_remap_and_unmap()
    {
        using var server = Server(("OIDC_FAKE_AUTO_CREATE", "true"), ("OIDC_FAKE_USER_MAP", "Boss=admin"));
        var admin = Browser(server);
        (await admin.PostAsJsonAsync("/auth/login", new { username = "admin", password = AdminPassword }, Token)).EnsureSuccessStatusCode();
        var accounts = server.Services.GetRequiredService<AccountService>();
        var kimberly = await accounts.CreateUserAsync("kimberly", "a long enough password", cancellation: Token);

        // Kim signs in before anyone set things up: a new account "kim".
        await SignIn(Browser(server), Kim());
        var overview = await admin.GetFromJsonAsync<OidcOverview>("/api/admin/oidc", Token);
        Assert.Equal("fake", Assert.Single(overview!.Providers).Name);
        var kim = overview.Accounts.Single(account => account.Username == "kim");
        Assert.Equal(("kim-subject", "kim"), (Assert.Single(kim.Identities).Subject, kim.Identities[0].Username));
        Assert.Equal(("boss", "admin", "settings"), Assert.Single(overview.Mappings) is var boss ? (boss.ProviderUsername, boss.AccountUsername, boss.Source) : default);

        // Remap by hand: the provider account now signs into kimberly; kim keeps everything.
        var moved = await admin.PutAsJsonAsync("/api/admin/oidc/identities/fake/kim-subject/account", new { accountId = kimberly.Id }, Token);
        Assert.Equal(["kim"], (await moved.Content.ReadFromJsonAsync<UnbindResult>(Token))!.Stranded);
        var browser = Browser(server);
        await SignIn(browser, Kim());
        Assert.Equal("kimberly", (await browser.GetFromJsonAsync<Me>("/auth/me", Token))!.Username);

        // A saved mapping; one the settings make cannot be changed here.
        Assert.Equal(HttpStatusCode.NoContent, (await admin.PutAsJsonAsync("/api/admin/oidc/mappings",
            new { provider = "fake", providerUsername = "Sam", accountId = kimberly.Id }, Token)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await admin.PutAsJsonAsync("/api/admin/oidc/mappings",
            new { provider = "fake", providerUsername = "boss", accountId = kimberly.Id }, Token)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await admin.DeleteAsync("/api/admin/oidc/mappings/fake/boss", Token)).StatusCode);
        overview = await admin.GetFromJsonAsync<OidcOverview>("/api/admin/oidc", Token);
        Assert.Contains(overview!.Mappings, mapping => mapping is { ProviderUsername: "sam", AccountUsername: "kimberly", Source: "admin" });
        Assert.Equal(HttpStatusCode.NoContent, (await admin.DeleteAsync("/api/admin/oidc/mappings/fake/sam", Token)).StatusCode);

        // Unmap: the existing unlink.
        Assert.Equal(HttpStatusCode.OK, (await admin.DeleteAsync($"/api/admin/users/{kimberly.Id}/identities/fake/kim-subject", Token)).StatusCode);
        overview = await admin.GetFromJsonAsync<OidcOverview>("/api/admin/oidc", Token);
        Assert.All(overview!.Accounts, account => Assert.Empty(account.Identities));
    }
}

