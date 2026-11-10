using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using PeckList.Core.Accounts;
using PeckList.Core.Audit;
using PeckList.Core.Configuration;
using PeckList.Server.Audit;
using PeckList.Server.Auth;

namespace PeckList.Server.Tests;

/// <summary>
/// A role from ROLE_MAP lapses unless a sign-in through its provider renews it (audit S10 follow-up,
/// R1), and whatever acts with the account's role loses it then: an API key with no expiry, a session.
/// </summary>
public sealed class RoleLeaseTests(ServerFixture fixture) : IClassFixture<ServerFixture>
{
    private const string Password = "a long enough password";

    private static CancellationToken Token => TestContext.Current.CancellationToken;

    private WebApplicationFactory<Program> Server(params (string, string)[] settings) =>
        fixture.Factory([("ADMIN_PASSWORD", "correct horse battery"), ("DB_PATH", fixture.NewDbPath()), .. settings]);

    private static async Task<(HttpClient Session, Account Account)> Admin(WebApplicationFactory<Program> server, string username)
    {
        var account = await server.Services.GetRequiredService<AccountService>()
            .CreateUserAsync(username, Password, Role.Admin, mustChangePassword: false, cancellation: Token);
        var session = server.CreateClient();
        (await session.PostAsJsonAsync("/auth/login", new { username, password = Password }, Token)).EnsureSuccessStatusCode();
        return (session, account);
    }

    private static async Task<HttpClient> AdminKey(WebApplicationFactory<Program> server, HttpClient session)
    {
        // No expiry: the lease is what takes admin away from it (Ben, 2026-11-08).
        var made = await session.PostAsJsonAsync("/api/account/api-keys", new { name = "Automation", scopes = new[] { "admin" } }, Token);
        made.EnsureSuccessStatusCode();
        var created = (await made.Content.ReadFromJsonAsync<ApiKeyAuth.CreatedKey>(Token))!;
        Assert.Null(created.Key.ExpiresAt);
        var key = server.CreateClient();
        key.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", created.Token);
        return key;
    }

    /// <summary>As if a sign-in through pocket gave the role this long ago.</summary>
    private static async Task Renewed(WebApplicationFactory<Program> server, string id, TimeSpan ago)
    {
        var store = server.Services.GetRequiredService<IAccountStore>();
        var account = (await store.FindByIdAsync(id, Token))!;
        await store.UpdateAsync(account with { RoleProvider = "pocket", RoleRenewedAt = DateTimeOffset.UtcNow - ago }, Token);
    }

    private static async Task<IReadOnlyList<AuditEntry>> Events(WebApplicationFactory<Program> server, string type)
    {
        await server.Services.GetRequiredService<AuditLog>().FlushAsync(Token);
        var entries = (await server.Services.GetRequiredService<IAuditStore>().QueryAsync(new AuditQuery { Ascending = true }, Token)).Entries;
        return [.. entries.Where(each => each.Type == type)];
    }

    [Fact]
    public async Task An_api_key_with_no_expiry_loses_admin_when_the_lease_lapses()
    {
        using var server = Server();
        var (session, kim) = await Admin(server, "kim-l");
        var key = await AdminKey(server, session);

        await Renewed(server, kim.Id, TimeSpan.FromDays(13));
        Assert.Equal(HttpStatusCode.OK, (await key.GetAsync("/api/admin/users", Token)).StatusCode);

        await Renewed(server, kim.Id, TimeSpan.FromDays(15));
        Assert.Equal(HttpStatusCode.Forbidden, (await key.GetAsync("/api/admin/users", Token)).StatusCode);
        var stored = (await server.Services.GetRequiredService<IAccountStore>().FindByIdAsync(kim.Id, Token))!;
        Assert.Equal((Role.User, (string?)null), (stored.Role, stored.RoleProvider));
        var lapsed = Assert.Single(await Events(server, "auth.role-lease-lapsed"));
        Assert.Equal((kim.Id, "system"), (lapsed.TargetId, lapsed.ActorName));
        Assert.Contains("pocket", lapsed.Detail);
        // Still a key, for what a user may do; once lowered it stays lowered without another event.
        Assert.Equal(HttpStatusCode.Forbidden, (await key.GetAsync("/api/admin/users", Token)).StatusCode);
        Assert.Single(await Events(server, "auth.role-lease-lapsed"));
    }

    [Fact]
    public async Task A_session_loses_admin_when_the_lease_lapses_and_a_role_set_by_hand_never_does()
    {
        using var server = Server();
        var (lee, leeAccount) = await Admin(server, "lee-l");
        await Renewed(server, leeAccount.Id, TimeSpan.FromDays(20));
        Assert.Equal(HttpStatusCode.Forbidden, (await lee.GetAsync("/api/admin/users", Token)).StatusCode);

        // Made admin by hand: no lease, however long ago.
        var (mo, _) = await Admin(server, "mo-l");
        Assert.Equal(HttpStatusCode.OK, (await mo.GetAsync("/api/admin/users", Token)).StatusCode);
    }

    [Fact]
    public async Task With_renew_days_at_zero_a_role_never_lapses()
    {
        using var server = Server(("ROLE_MAP_RENEW_DAYS", "0"));
        var (session, kim) = await Admin(server, "kim-z");
        var key = await AdminKey(server, session);
        await Renewed(server, kim.Id, TimeSpan.FromDays(400));
        Assert.Equal(HttpStatusCode.OK, (await key.GetAsync("/api/admin/users", Token)).StatusCode);
    }

    [Fact]
    public async Task The_daily_check_lowers_lapsed_roles_and_spares_the_only_super_admin()
    {
        using var server = Server();
        var (_, kim) = await Admin(server, "kim-d");
        await Renewed(server, kim.Id, TimeSpan.FromDays(15));
        var store = server.Services.GetRequiredService<IAccountStore>();
        // The server's own admin is the only super admin.
        var admin = (await store.FindByUsernameAsync("admin", Token))!;
        await Renewed(server, admin.Id, TimeSpan.FromDays(15));

        var leases = server.Services.GetRequiredService<RoleLeases>();
        foreach (var account in await store.ListAsync(Token)) await leases.CheckAsync(account, Token);
        Assert.Equal(Role.User, (await store.FindByIdAsync(kim.Id, Token))!.Role);
        Assert.Equal(Role.SuperAdmin, (await store.FindByIdAsync(admin.Id, Token))!.Role);
        Assert.Contains(await Events(server, "auth.role-lease-kept"), each => each.TargetId == admin.Id);
        // Warned once a day, not at every request.
        foreach (var account in await store.ListAsync(Token)) await leases.CheckAsync(account, Token);
        Assert.Single(await Events(server, "auth.role-lease-kept"));
    }

    [Fact]
    public async Task The_upgrade_start_leases_before_the_server_answers_so_a_role_set_by_hand_right_after_stays_unleased()
    {
        var database = fixture.NewDbPath();
        (string, string)[] settings =
        [
            ("ADMIN_PASSWORD", "correct horse battery"), ("DB_PATH", database),
            ("OIDC_PROVIDERS", "fake"), ("OIDC_FAKE_AUTHORITY", FakeOidcProvider.Authority), ("OIDC_FAKE_CLIENT_ID", FakeOidcProvider.ClientId),
            ("OIDC_FAKE_CLIENT_SECRET", "secret"), ("OIDC_FAKE_ROLE_MAP", "pl-admins=admin"),
        ];
        string id;
        using (var before = fixture.Factory(settings))
        {
            // As a database from before leases: an admin linked to the provider, and no note that leases started.
            id = (await before.Services.GetRequiredService<AccountService>()
                .CreateUserAsync("pia-s", Password, Role.Admin, mustChangePassword: false, cancellation: Token)).Id;
            await before.Services.GetRequiredService<IIdentityStore>().LinkAsync(new LinkedIdentity
            {
                Provider = "fake", Subject = "sub-pia", AccountId = id, LinkedAt = DateTimeOffset.UtcNow, LastUsedAt = DateTimeOffset.UtcNow,
            }, Token);
            var secrets = before.Services.GetRequiredService<ISecretStore>();
            foreach (var (name, _) in await secrets.ListAsync(RoleLeaseCheck.StartedKind, Token)) await secrets.DeleteAsync(RoleLeaseCheck.StartedKind, name, Token);
        }

        using var after = fixture.Factory(settings);
        var store = after.Services.GetRequiredService<IAccountStore>();
        // Started by the time the server is up, not a minute later.
        Assert.Equal("fake", (await store.FindByIdAsync(id, Token))!.RoleProvider);
        await after.Services.GetRequiredService<AccountService>().SetRoleAsync(id, Role.Admin, Token);
        Assert.Equal(0, await after.Services.GetRequiredService<RoleLeaseCheck>().StartLeasesAsync(Token));
        Assert.Null((await store.FindByIdAsync(id, Token))!.RoleProvider);
    }

    [Fact]
    public async Task The_first_start_with_leases_leases_the_roles_a_linked_providers_map_gives_from_today()
    {
        using var server = Server();
        var accounts = server.Services.GetRequiredService<AccountService>();
        var identities = server.Services.GetRequiredService<IIdentityStore>();
        async Task<Account> Linked(string username, Role role, string? provider)
        {
            var account = await accounts.CreateUserAsync(username, Password, role, mustChangePassword: false, cancellation: Token);
            if (provider is not null)
            {
                await identities.LinkAsync(new LinkedIdentity
                {
                    Provider = provider, Subject = $"sub-{username}", AccountId = account.Id, LinkedAt = DateTimeOffset.UtcNow, LastUsedAt = DateTimeOffset.UtcNow,
                }, Token);
            }
            return account;
        }
        var lin = await Linked("lin-s", Role.Admin, "pocket");
        var mo = await Linked("mo-s", Role.Admin, null);
        var nia = await Linked("nia-s", Role.Admin, "github");
        var ola = await Linked("ola-s", Role.SuperAdmin, "pocket");
        var pocket = new OidcProviderSettings
        {
            Name = "pocket", DisplayName = "Pocket ID", Authority = new Uri("https://id.example.com"), ClientId = "pecklist", Scopes = ["openid"],
            RoleMap = new Dictionary<string, Role>(StringComparer.OrdinalIgnoreCase) { ["pl-admins"] = Role.Admin },
        };
        var github = pocket with { Name = "github", RoleMap = new Dictionary<string, Role>() };
        var settings = server.Services.GetRequiredService<ServerSettings>() with { OidcProviders = [pocket, github] };
        var check = ActivatorUtilities.CreateInstance<RoleLeaseCheck>(server.Services, settings);
        // As a database from before leases: the start has already noted them started on this new one.
        var secrets = server.Services.GetRequiredService<ISecretStore>();
        foreach (var (name, _) in await secrets.ListAsync(RoleLeaseCheck.StartedKind, Token)) await secrets.DeleteAsync(RoleLeaseCheck.StartedKind, name, Token);

        var before = DateTimeOffset.UtcNow;
        Assert.Equal(1, await check.StartLeasesAsync(Token));
        var store = server.Services.GetRequiredService<IAccountStore>();
        var leased = (await store.FindByIdAsync(lin.Id, Token))!;
        Assert.Equal("pocket", leased.RoleProvider);
        Assert.InRange(leased.RoleRenewedAt!.Value, before.AddSeconds(-1), DateTimeOffset.UtcNow.AddSeconds(1));
        // By hand (no link), a provider with no ROLE_MAP, a role pocket's map cannot give: not leased.
        Assert.All([mo, nia, ola], each => Assert.Null(store.FindByIdAsync(each.Id, Token).Result!.RoleProvider));
        Assert.Single(await Events(server, "auth.role-lease-started"));
        // Once only: set by hand afterwards, it stays unleased at the next start.
        await accounts.SetRoleAsync(lin.Id, Role.Admin, Token);
        Assert.Equal(0, await check.StartLeasesAsync(Token));
        Assert.Null((await store.FindByIdAsync(lin.Id, Token))!.RoleProvider);
    }
}
