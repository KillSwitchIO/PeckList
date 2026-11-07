using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using PeckList.Core.Accounts;
using PeckList.Core.Audit;
using PeckList.Server.Audit;
using PeckList.Server.Auth;

namespace PeckList.Server.Tests;

/// <summary>Passkeys in PeckList itself (PL-123), with a software authenticator.</summary>
public sealed class PasskeyTests(ServerFixture fixture) : IClassFixture<ServerFixture>
{
    private const string AdminPassword = "correct horse battery";
    private const string Password = "a long enough password";
    private const string Site = "https://tasks.example.com";
    private const string App = "com.killswitch10.pecklist";

    private static CancellationToken Token => TestContext.Current.CancellationToken;

    private WebApplicationFactory<Program> Server(params (string Key, string Value)[] extra) =>
        fixture.Factory([("ADMIN_PASSWORD", AdminPassword), ("PUBLIC_URL", Site), .. extra]);

    private static HttpClient Browser(WebApplicationFactory<Program> server) =>
        server.Browser(allowAutoRedirect: false);

    private static async Task<HttpClient> LogIn(WebApplicationFactory<Program> server, string username, string password)
    {
        var client = Browser(server);
        (await client.PostAsJsonAsync("/auth/login", new { username, password }, Token)).EnsureSuccessStatusCode();
        return client;
    }

    private static async Task<(HttpClient Client, string Id)> NewUser(WebApplicationFactory<Program> server, string username)
    {
        var account = await server.Services.GetRequiredService<AccountService>()
            .CreateUserAsync(username, Password, mustChangePassword: false, cancellation: Token);
        return (await LogIn(server, username, Password), account.Id);
    }

    private static async Task<(string Ceremony, JsonObject Options)> OptionsAsync(HttpClient client, string path, object? body = null)
    {
        var response = await client.PostAsJsonAsync(path, body ?? new { }, Token);
        response.EnsureSuccessStatusCode();
        var answer = (await response.Content.ReadFromJsonAsync<JsonObject>(Token))!;
        return ((string)answer["ceremony"]!, answer["options"]!.AsObject());
    }

    private static async Task<PasskeyView> AddPasskey(HttpClient client, SoftAuthenticator authenticator, string name = "Pixel")
    {
        var (ceremony, options) = await OptionsAsync(client, "/api/account/passkeys/options");
        var added = await client.PostAsJsonAsync("/api/account/passkeys", new { ceremony, credential = authenticator.Create(options), name }, Token);
        Assert.Equal(HttpStatusCode.OK, added.StatusCode);
        return (await added.Content.ReadFromJsonAsync<PasskeyView>(Token))!;
    }

    private static async Task<HttpResponseMessage> SignInWith(HttpClient client, SoftAuthenticator authenticator)
    {
        var (ceremony, options) = await OptionsAsync(client, "/auth/passkey/sign-in/options");
        return await client.PostAsJsonAsync("/auth/passkey/sign-in", new { ceremony, credential = authenticator.Get(options) }, Token);
    }

    [Fact]
    public async Task A_passkey_added_in_settings_signs_in_without_a_username()
    {
        using var server = Server();
        var (sam, samId) = await NewUser(server, "sam");
        using var phone = new SoftAuthenticator(Site);
        var added = await AddPasskey(sam, phone);
        Assert.Equal("Pixel", added.Name);
        var listed = await sam.GetFromJsonAsync<PasskeyList>("/api/account/passkeys", Token);
        Assert.True(listed!.Available);
        Assert.Equal([added.Id], listed.Passkeys.Select(each => each.Id));

        var stranger = Browser(server);
        Assert.True((bool)(await stranger.GetFromJsonAsync<JsonObject>("/auth/providers", Token))!["passkeys"]!);
        var signedIn = await SignInWith(stranger, phone);
        Assert.Equal(HttpStatusCode.OK, signedIn.StatusCode);
        Assert.Equal("sam", (string?)(await signedIn.Content.ReadFromJsonAsync<JsonObject>(Token))!["username"]);
        Assert.Equal(HttpStatusCode.OK, (await stranger.GetAsync("/api/account/passkeys", Token)).StatusCode);
        var used = (await stranger.GetFromJsonAsync<PasskeyList>("/api/account/passkeys", Token))!.Passkeys.Single();
        Assert.NotNull(used.LastUsedAt);

        // A whole-server backup carries it, so a restore keeps the way in.
        var admin = await LogIn(server, "admin", AdminPassword);
        var backup = await (await admin.GetAsync("/api/admin/export", Token)).Content.ReadAsStringAsync(Token);
        Assert.Contains(added.Id, backup);
        Assert.Equal(1, (await admin.GetFromJsonAsync<AdminUser[]>("/api/admin/users", Token))!.Single(user => user.Id == samId).Passkeys);
    }

    [Fact]
    public async Task A_passkey_for_another_site_a_spent_ceremony_or_an_unknown_one_is_refused()
    {
        using var server = Server();
        var (sam, _) = await NewUser(server, "sam");
        using var phone = new SoftAuthenticator(Site);
        await AddPasskey(sam, phone);

        // The same key, asked by a page on another site, signs for that site: no good here.
        using var elsewhere = new SoftAuthenticator("https://tasks.example.com.evil.example");
        var stranger = Browser(server);
        var (ceremony, options) = await OptionsAsync(stranger, "/auth/passkey/sign-in/options");
        Assert.Equal(HttpStatusCode.Unauthorized,
            (await stranger.PostAsJsonAsync("/auth/passkey/sign-in", new { ceremony, credential = elsewhere.Get(options) }, Token)).StatusCode);

        // A ceremony works once.
        (ceremony, options) = await OptionsAsync(stranger, "/auth/passkey/sign-in/options");
        var answer = phone.Get(options);
        Assert.Equal(HttpStatusCode.OK, (await stranger.PostAsJsonAsync("/auth/passkey/sign-in", new { ceremony, credential = answer }, Token)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized,
            (await Browser(server).PostAsJsonAsync("/auth/passkey/sign-in", new { ceremony, credential = answer }, Token)).StatusCode);
    }

    private static async Task<IReadOnlyList<AuditEntry>> AuditEntries(WebApplicationFactory<Program> server)
    {
        await server.Services.GetRequiredService<AuditLog>().FlushAsync(Token);
        return (await server.Services.GetRequiredService<IAuditStore>().QueryAsync(new AuditQuery { Ascending = true }, Token)).Entries;
    }

    [Theory]
    [InlineData("the old value")]
    [InlineData("no value")]
    [InlineData("a value too long to check")]
    public async Task An_admin_that_gave_up_its_password_stays_without_one_at_a_restart(string setting)
    {
        var db = fixture.NewDbPath();
        using var phone = new SoftAuthenticator(Site);
        string stamp;
        using (var first = Server(("DB_PATH", db)))
        {
            var admin = await LogIn(first, "admin", AdminPassword);
            await AddPasskey(admin, phone);
            Assert.Equal(HttpStatusCode.NoContent,
                (await admin.PostAsJsonAsync("/api/account/password/remove", new { current = AdminPassword }, Token)).StatusCode);
            stamp = (await first.Services.GetRequiredService<IAccountStore>().FindByUsernameAsync("admin", Token))!.SecurityStamp;
        }

        (string, string)[] settings = setting switch
        {
            "the old value" => [("ADMIN_PASSWORD", AdminPassword)],
            "no value" => [],
            _ => [("ADMIN_PASSWORD", new string('x', AccountService.MaxTriedPasswordLength + 1))],
        };
        var console = new StringWriter();
        using var restarted = fixture.Factory([("PUBLIC_URL", Site), ("DB_PATH", db), .. settings])
            .WithWebHostBuilder(host => host.ConfigureTestServices(services => services.AddSingleton(new StartupConsole(console))));

        var after = (await restarted.Services.GetRequiredService<IAccountStore>().FindByUsernameAsync("admin", Token))!;
        Assert.Null(after.PasswordHash);
        Assert.Equal(stamp, after.SecurityStamp);
        Assert.Equal(string.Empty, console.ToString());
        Assert.Equal(HttpStatusCode.Unauthorized,
            (await Browser(restarted).PostAsJsonAsync("/auth/login", new { username = "admin", password = AdminPassword }, Token)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await SignInWith(Browser(restarted), phone)).StatusCode);
        Assert.DoesNotContain(await AuditEntries(restarted), entry => entry.Type == "auth.admin-password-given");
    }

    [Fact]
    public async Task An_admin_with_no_way_in_gets_a_password_at_a_start_and_the_audit_log_says_so()
    {
        var db = fixture.NewDbPath();
        using (var open = fixture.Factory(("AUTH_MODE", "none"), ("DB_PATH", db)))
        {
            Assert.NotNull(open.Services);
        }

        using var local = Server(("DB_PATH", db));

        await LogIn(local, "admin", AdminPassword);
        var given = Assert.Single(await AuditEntries(local), entry => entry.Type == "auth.admin-password-given");
        Assert.Equal("source=setting", given.Detail);
    }

    [Fact]
    public async Task With_a_passkey_the_password_can_go_but_never_the_last_way_in()
    {
        using var server = Server();
        var (sam, samId) = await NewUser(server, "sam");
        Assert.Equal(HttpStatusCode.Conflict,
            (await sam.PostAsJsonAsync("/api/account/password/remove", new { current = Password }, Token)).StatusCode);
        using var phone = new SoftAuthenticator(Site);
        var added = await AddPasskey(sam, phone);
        Assert.Equal(HttpStatusCode.BadRequest,
            (await sam.PostAsJsonAsync("/api/account/password/remove", new { current = "not it at all" }, Token)).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent,
            (await sam.PostAsJsonAsync("/api/account/password/remove", new { current = Password }, Token)).StatusCode);
        // This session carries on; the password no longer signs in.
        Assert.False((await sam.GetFromJsonAsync<PasskeyList>("/api/account/passkeys", Token))!.Password);
        Assert.Equal(HttpStatusCode.Unauthorized,
            (await Browser(server).PostAsJsonAsync("/auth/login", new { username = "sam", password = Password }, Token)).StatusCode);

        var refused = await sam.DeleteAsync($"/api/account/passkeys/{added.Id}", Token);
        Assert.Equal(HttpStatusCode.Conflict, refused.StatusCode);
        // A second passkey, and the first one may go.
        using var laptop = new SoftAuthenticator(Site);
        await AddPasskey(sam, laptop, "Laptop");
        Assert.Equal(HttpStatusCode.NoContent, (await sam.DeleteAsync($"/api/account/passkeys/{added.Id}", Token)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await SignInWith(Browser(server), phone)).StatusCode);

        // An admin sees and removes a lost one.
        var admin = await LogIn(server, "admin", AdminPassword);
        var theirs = await admin.GetFromJsonAsync<PasskeyView[]>($"/api/admin/users/{samId}/passkeys", Token);
        Assert.Equal(["Laptop"], theirs!.Select(each => each.Name));
        Assert.Equal(HttpStatusCode.NoContent, (await admin.DeleteAsync($"/api/admin/users/{samId}/passkeys/{theirs![0].Id}", Token)).StatusCode);
    }

    [Fact]
    public async Task Passkeys_need_a_secure_address_and_PASSKEYS_turns_them_off()
    {
        foreach (var server in new[] { Server(("PASSKEYS", "off")), Server(("PUBLIC_URL", "http://tasks.example.com")) })
        {
            using (server)
            {
                var client = Browser(server);
                Assert.False((bool)(await client.GetFromJsonAsync<JsonObject>("/auth/providers", Token))!["passkeys"]!);
                Assert.Equal(HttpStatusCode.NotFound, (await client.PostAsJsonAsync("/auth/passkey/sign-in/options", new { }, Token)).StatusCode);
            }
        }
    }

    [Fact]
    public async Task The_android_app_signs_in_and_adds_passkeys_through_a_browser_tab()
    {
        using var server = Server();
        var (app, _) = await NewUser(server, "sam");
        // Signing in: the hand-off sends a tab with no session to the sign-in page, and back.
        var challenge = new string('a', 43);
        var handoff = $"/auth/app/handoff?provider=passkey&challenge={challenge}&scheme={App}";
        var tab = Browser(server);
        var toLogin = await tab.GetAsync(handoff, Token);
        Assert.Equal(HttpStatusCode.Redirect, toLogin.StatusCode);
        Assert.Equal($"/login?passkey=1&returnUrl={Uri.EscapeDataString(handoff)}", toLogin.Headers.Location!.OriginalString);

        // Adding one: the app's link step opens a page in the tab that needs no session there.
        var start = await app.PostAsJsonAsync("/auth/app/link-start", new { provider = "passkey", scheme = App }, Token);
        var link = (string)(await start.Content.ReadFromJsonAsync<JsonObject>(Token))!["url"]!;
        var toPage = await tab.GetAsync(link, Token);
        var page = toPage.Headers.Location!.OriginalString;
        Assert.StartsWith("/passkey/add?token=", page);
        var token = Uri.UnescapeDataString(page["/passkey/add?token=".Length..]);
        using var phone = new SoftAuthenticator(Site);
        var (ceremony, options) = await OptionsAsync(tab, "/auth/passkey/enroll/options", new { token });
        var done = await tab.PostAsJsonAsync("/auth/passkey/enroll", new { token, ceremony, credential = phone.Create(options), name = "Phone" }, Token);
        Assert.Equal(HttpStatusCode.OK, done.StatusCode);
        Assert.Equal($"{App}://link?result=passkey_added", (await done.Content.ReadFromJsonAsync<EnrollDone>(Token))!.Back);
        Assert.Equal(["Phone"], (await app.GetFromJsonAsync<PasskeyList>("/api/account/passkeys", Token))!.Passkeys.Select(each => each.Name));
        // The page's token is spent.
        Assert.Equal(HttpStatusCode.NotFound, (await tab.PostAsJsonAsync("/auth/passkey/enroll/options", new { token }, Token)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await SignInWith(tab, phone)).StatusCode);
    }
}
