using Punchlist.Core.Accounts;
using Punchlist.Core.Configuration;
using Punchlist.Storage.Sql;

namespace Punchlist.Storage.Tests;

/// <summary>The OIDC sign-in rules on a real database (spec: Accounts &amp; Admin, OIDC).</summary>
public sealed class ExternalSignInTests(SqliteFiles files) : IClassFixture<SqliteFiles>, IAsyncLifetime
{
    private static CancellationToken Token => TestContext.Current.CancellationToken;

    private SqlAccountStore accounts = null!;
    private SqlIdentityStore identities = null!;
    private SqlServerGroupStore groups = null!;
    private SqlSecretStore secrets = null!;
    private AccountService accountService = null!;
    private ExternalSignIn signIn = null!;

    public async ValueTask InitializeAsync()
    {
        var database = await files.NewDatabaseAsync();
        accounts = new SqlAccountStore(database);
        identities = new SqlIdentityStore(database);
        groups = new SqlServerGroupStore(database);
        secrets = new SqlSecretStore(database);
        accountService = new AccountService(accounts, new NoHasher(), TimeProvider.System);
        signIn = new ExternalSignIn(accounts, accountService, identities, groups, secrets, TimeProvider.System);
    }

    public ValueTask DisposeAsync() => ValueTask.CompletedTask;

    private sealed class NoHasher : IPasswordHasher
    {
        public string Hash(string password) => password;

        public bool Verify(string hash, string password, out bool rehash)
        {
            rehash = false;
            return hash == password;
        }
    }

    private static OidcProviderSettings Pocket(bool autoCreate = true) => new()
    {
        Name = "pocket",
        DisplayName = "Pocket ID",
        Authority = new Uri("https://id.example.com"),
        ClientId = "punchlist",
        Scopes = ["openid"],
        AutoCreate = autoCreate,
    };

    private static ExternalIdentity Kim(params string[] groups) => new()
    {
        Subject = "sub-kim",
        Username = "Kim.Lee",
        DisplayName = "Kim Lee",
        Email = "kim@example.com",
        Groups = groups,
    };

    private async Task<Account> SignedIn(OidcProviderSettings provider, ExternalIdentity identity) =>
        Assert.IsType<ExternalSignInResult.Success>(await signIn.SignInAsync(provider, identity, Token)).Account;

    [Fact]
    public async Task Required_groups_keep_others_out_without_storing_anything()
    {
        var provider = Pocket() with { RequiredGroups = ["punchlist", "family"] };
        Assert.IsType<ExternalSignInResult.NotAllowed>(await signIn.SignInAsync(provider, Kim("gaming"), Token));
        Assert.Equal(0, await accounts.CountAsync(Token));
        Assert.Empty(await identities.ListPendingAsync(Token));

        var kim = await SignedIn(provider, Kim("FAMILY"));
        Assert.Equal("kim.lee", kim.Username);
        // Taken out of the group later: the next sign-in is refused.
        Assert.IsType<ExternalSignInResult.NotAllowed>(await signIn.SignInAsync(provider, Kim(), Token));
    }

    [Fact]
    public async Task Auto_create_makes_and_links_an_account_once()
    {
        var first = Assert.IsType<ExternalSignInResult.Success>(await signIn.SignInAsync(Pocket(), Kim(), Token));
        Assert.True(first.Created);
        Assert.Null(first.Account.PasswordHash);
        Assert.Equal(Role.User, first.Account.Role);
        var again = Assert.IsType<ExternalSignInResult.Success>(await signIn.SignInAsync(Pocket(), Kim() with { Username = "renamed" }, Token));
        Assert.False(again.Created);
        Assert.Equal(first.Account.Id, again.Account.Id);
        Assert.Equal(first.Account.Id, (await identities.FindAsync("pocket", "sub-kim", Token))!.AccountId);
    }

    [Fact]
    public async Task A_taken_username_gets_a_number_and_never_the_existing_account()
    {
        var local = await accountService.CreateUserAsync("kim.lee", "correct horse battery", cancellation: Token);
        var kim = await SignedIn(Pocket(), Kim());
        Assert.NotEqual(local.Id, kim.Id);
        Assert.Equal("kim.lee2", kim.Username);
    }

    [Fact]
    public async Task Without_auto_create_they_wait_for_an_admin()
    {
        Assert.IsType<ExternalSignInResult.Pending>(await signIn.SignInAsync(Pocket(autoCreate: false), Kim("family"), Token));
        Assert.IsType<ExternalSignInResult.Pending>(await signIn.SignInAsync(Pocket(autoCreate: false), Kim("family"), Token));
        var waiting = Assert.Single(await identities.ListPendingAsync(Token));
        Assert.Equal("kim.lee", waiting.Username);
        Assert.Equal("Kim Lee", waiting.DisplayName);
        Assert.Equal(["family"], waiting.Groups);
        Assert.Equal(0, await accounts.CountAsync(Token));

        var approved = await signIn.ApproveAsync(Pocket(autoCreate: false), "sub-kim", Token);
        Assert.Equal("kim.lee", approved!.Username);
        Assert.Empty(await identities.ListPendingAsync(Token));
        Assert.Null(await signIn.ApproveAsync(Pocket(autoCreate: false), "sub-kim", Token));
        Assert.Equal(approved.Id, (await SignedIn(Pocket(autoCreate: false), Kim("family"))).Id);
    }

    [Fact]
    public async Task A_disabled_account_stays_out()
    {
        var kim = await SignedIn(Pocket(), Kim());
        await accounts.UpdateAsync(kim with { Disabled = true }, Token);
        Assert.IsType<ExternalSignInResult.Disabled>(await signIn.SignInAsync(Pocket(), Kim(), Token));
    }

    [Fact]
    public async Task Roles_follow_the_role_map_at_every_sign_in()
    {
        var provider = Pocket() with
        {
            RoleMap = new Dictionary<string, Role>(StringComparer.OrdinalIgnoreCase) { ["pl-admins"] = Role.Admin, ["pl-owners"] = Role.SuperAdmin },
        };
        Assert.Equal(Role.Admin, (await SignedIn(provider, Kim("family", "PL-Admins"))).Role);
        Assert.Equal(Role.SuperAdmin, (await SignedIn(provider, Kim("pl-admins", "pl-owners"))).Role);
        // Kim is the only super admin: losing the group does not lock the server out.
        Assert.Equal(Role.SuperAdmin, (await SignedIn(provider, Kim("family"))).Role);

        var other = await accountService.CreateUserAsync("ann", "correct horse battery", Role.SuperAdmin, cancellation: Token);
        Assert.Equal(Role.User, (await SignedIn(provider, Kim("family"))).Role);
        Assert.Equal(Role.SuperAdmin, (await accounts.FindByIdAsync(other.Id, Token))!.Role);
    }

    [Fact]
    public async Task Group_maps_keep_the_providers_memberships_in_step_and_leave_manual_ones()
    {
        var provider = Pocket() with
        {
            GroupMap = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase) { ["family"] = "Family", ["chores"] = "Family" },
        };
        var kim = await SignedIn(provider, Kim("family", "gaming"));
        var family = (await groups.FindByNameAsync("Family", Token))!;
        var manual = new ServerGroup { Id = "G-MANUAL", Name = "Neighbors", CreatedAt = DateTimeOffset.UtcNow };
        await groups.CreateAsync(manual, Token);
        await groups.AddMembershipAsync(new(manual.Id, kim.Id, MembershipSource.Manual), Token);
        Assert.Equal(
            [new("G-MANUAL", kim.Id, "manual"), new(family.Id, kim.Id, "oidc:pocket")],
            (await groups.MembershipsAsync(Token)).OrderBy(each => each.Source).ToList());

        await SignedIn(provider, Kim("gaming"));
        Assert.Equal([new GroupMembership("G-MANUAL", kim.Id, "manual")], await groups.MembershipsAsync(Token));

        // GROUP_MAP=* mirrors every provider group by name.
        await SignedIn(Pocket() with { MirrorGroups = true }, Kim("gaming", "Family"));
        Assert.Equal(["Family", "gaming", "Neighbors"], (await groups.ListAsync(Token)).Select(group => group.Name));
    }

    [Fact]
    public async Task Linking_attaches_a_provider_account_to_the_signed_in_user()
    {
        var ben = await accountService.CreateUserAsync("ben", "correct horse battery", cancellation: Token);
        Assert.Equal(LinkResult.Linked, await signIn.LinkAsync(Pocket(), Kim(), ben.Id, Token));
        Assert.Equal(LinkResult.Linked, await signIn.LinkAsync(Pocket(), Kim(), ben.Id, Token));
        Assert.Equal(ben.Id, (await SignedIn(Pocket(autoCreate: false), Kim())).Id);

        var sam = await accountService.CreateUserAsync("sam", "correct horse battery", cancellation: Token);
        Assert.Equal(LinkResult.Taken, await signIn.LinkAsync(Pocket(), Kim(), sam.Id, Token));
        var strict = Pocket() with { RequiredGroups = ["punchlist"] };
        Assert.Equal(LinkResult.NotAllowed, await signIn.LinkAsync(strict, Kim() with { Subject = "other" }, sam.Id, Token));
    }

    [Fact]
    public async Task People_cannot_unlink_their_last_way_in_but_admins_can()
    {
        var kim = await SignedIn(Pocket(), Kim());
        Assert.Equal(UnlinkResult.LastWayIn, await signIn.UnlinkAsync(kim.Id, "pocket", "sub-kim", selfService: true, Token));
        await signIn.LinkAsync(Pocket() with { Name = "keycloak" }, Kim(), kim.Id, Token);
        Assert.Equal(UnlinkResult.Unlinked, await signIn.UnlinkAsync(kim.Id, "pocket", "sub-kim", selfService: true, Token));
        Assert.Equal(UnlinkResult.NotFound, await signIn.UnlinkAsync(kim.Id, "pocket", "sub-kim", selfService: true, Token));

        Assert.Equal(UnlinkResult.Unlinked, await signIn.UnlinkAsync(kim.Id, "keycloak", "sub-kim", selfService: false, Token));
        Assert.False(await signIn.CanSignInAsync(kim, Token));
    }

    [Fact]
    public async Task Moving_providers_keeps_everyone_in_their_own_account()
    {
        var oldIdp = Pocket();
        var newIdp = Pocket() with { Name = "keycloak" };
        var kim = await SignedIn(oldIdp, Kim());
        var ben = await accountService.CreateUserAsync("ben", "correct horse battery", cancellation: Token);
        await signIn.LinkAsync(oldIdp, Kim() with { Subject = "sub-ben", Username = "ben" }, ben.Id, Token);

        await signIn.OpenMigrationWindowAsync("keycloak", TimeSpan.FromHours(2), Token);
        var (unbound, stranded) = await signIn.UnbindProviderAsync("pocket", Token);
        Assert.Equal(2, unbound);
        Assert.Equal(["kim.lee"], stranded);

        // The new provider has its own subjects; the username finds the old account.
        Assert.Equal(kim.Id, (await SignedIn(newIdp, Kim() with { Subject = "kc-kim" })).Id);
        Assert.Equal(ben.Id, (await SignedIn(newIdp, Kim() with { Subject = "kc-ben", Username = "ben" })).Id);
        Assert.NotNull(await signIn.MigrationWindowAsync("keycloak", Token));

        // Closed: a newcomer with a taken name gets their own account again.
        await signIn.CloseMigrationWindowAsync("keycloak", Token);
        Assert.Null(await signIn.MigrationWindowAsync("keycloak", Token));
        var stranger = await SignedIn(newIdp, Kim() with { Subject = "kc-other", Username = "ben" });
        Assert.NotEqual(ben.Id, stranger.Id);
    }

    [Fact]
    public async Task A_migration_window_never_takes_an_account_already_linked_to_that_provider()
    {
        var kim = await SignedIn(Pocket(), Kim());
        await signIn.OpenMigrationWindowAsync("pocket", TimeSpan.FromHours(1), Token);
        var impostor = await SignedIn(Pocket(), Kim() with { Subject = "someone-else" });
        Assert.NotEqual(kim.Id, impostor.Id);
    }

    [Fact]
    public async Task One_time_links_work_once_and_not_after_they_expire()
    {
        var clock = new MovableClock();
        var links = new LoginLinks(secrets, accounts, clock);
        var ben = await accountService.CreateUserAsync("ben", "correct horse battery", cancellation: Token);
        var (token, expires) = await links.CreateAsync(ben.Id, cancellation: Token);
        Assert.Equal(clock.Now + LoginLinks.DefaultLifetime, expires);
        Assert.Equal(ben.Id, (await links.RedeemAsync(token, Token))?.Id);
        Assert.Null(await links.RedeemAsync(token, Token));

        var (late, _) = await links.CreateAsync(ben.Id, TimeSpan.FromMinutes(5), Token);
        clock.Now += TimeSpan.FromMinutes(6);
        Assert.Null(await links.RedeemAsync(late, Token));
        Assert.Null(await links.RedeemAsync("made-up", Token));
        await Assert.ThrowsAsync<KeyNotFoundException>(() => links.CreateAsync("nobody", cancellation: Token));
    }

    private sealed class MovableClock : TimeProvider
    {
        public DateTimeOffset Now { get; set; } = new(2026, 10, 22, 9, 0, 0, TimeSpan.Zero);

        public override DateTimeOffset GetUtcNow() => Now;
    }

    [Theory]
    [InlineData("Kim.Lee", null, "kim.lee")]
    [InlineData("kim@example.com", null, "kim")]
    [InlineData(null, "Zoë.O'Neil@example.com", "zoe.oneil")]
    [InlineData("  ", "---@x", "user")]
    [InlineData("ÆSIR_Łukasz", null, "aesir_lukasz")]
    [InlineData("a-very-long-username-that-goes-on-and-on", null, "a-very-long-username-that-goes-o")]
    public void Usernames_come_from_the_claims(string? username, string? email, string expected) =>
        Assert.Equal(expected, ExternalSignIn.UsernameBase(new ExternalIdentity { Subject = "s", Username = username, Email = email }));

    [Fact]
    public async Task A_verified_email_joins_the_one_account_another_provider_gave_it_only_when_asked()
    {
        var kim = await SignedIn(Pocket(), Kim());
        var elsewhere = Kim() with { Username = "kim2", EmailVerified = true };
        var keycloak = Pocket() with { Name = "keycloak", DisplayName = "Keycloak" };

        // Off by default: a new account.
        var separate = await SignedIn(keycloak, elsewhere with { Subject = "kc-kim" });
        Assert.NotEqual(kim.Id, separate.Id);
        await identities.UnlinkAsync("keycloak", "kc-kim", Token);

        // On and verified: joins Kim (case does not matter), and says so.
        var result = Assert.IsType<ExternalSignInResult.Success>(await signIn.SignInAsync(
            keycloak with { Name = "zitadel", LinkByEmail = true }, elsewhere with { Subject = "zi-kim", Email = "KIM@example.com" }, Token));
        Assert.Equal((kim.Id, false, "email"), (result.Account.Id, result.Created, result.JoinedBy));

        // On, but the email is not vouched for: a new account.
        var unverified = await SignedIn(keycloak with { Name = "authelia", LinkByEmail = true }, elsewhere with { Subject = "au-kim", EmailVerified = false });
        Assert.NotEqual(kim.Id, unverified.Id);
    }

    [Fact]
    public async Task An_email_two_accounts_share_joins_neither()
    {
        var kim = await SignedIn(Pocket(), Kim());
        var other = await SignedIn(Pocket(), Kim() with { Subject = "sub-kim-2", Username = "kim-two" });
        Assert.NotEqual(kim.Id, other.Id);
        var joined = await SignedIn(Pocket() with { Name = "keycloak", LinkByEmail = true }, Kim() with { Subject = "kc", Username = "kc", EmailVerified = true });
        Assert.NotEqual(kim.Id, joined.Id);
        Assert.NotEqual(other.Id, joined.Id);
    }

    [Fact]
    public async Task An_admin_links_a_provider_account_by_hand_settling_a_waiting_sign_in()
    {
        var sam = await accountService.CreateUserAsync("sam", "a long enough password", cancellation: Token);
        Assert.IsType<ExternalSignInResult.Pending>(await signIn.SignInAsync(Pocket(autoCreate: false), Kim(), Token));
        Assert.Equal(LinkResult.Linked, await signIn.LinkByAdminAsync("pocket", "sub-kim", sam.Id, Token));
        Assert.Empty(await identities.ListPendingAsync(Token));
        Assert.Equal(("kim@example.com", sam.Id), ((await identities.FindAsync("pocket", "sub-kim", Token))!.Email, (await identities.FindAsync("pocket", "sub-kim", Token))!.AccountId));
        // Kim now signs in as Sam's account; the same link again is fine, someone else's is not.
        Assert.Equal(sam.Id, (await SignedIn(Pocket(autoCreate: false), Kim())).Id);
        Assert.Equal(LinkResult.Linked, await signIn.LinkByAdminAsync("pocket", "sub-kim", sam.Id, Token));
        var other = await accountService.CreateUserAsync("lee", "a long enough password", cancellation: Token);
        Assert.Equal(LinkResult.Taken, await signIn.LinkByAdminAsync("pocket", "sub-kim", other.Id, Token));
    }

    [Fact]
    public async Task A_matching_username_joins_a_plain_users_account_only_when_asked()
    {
        var kim = await accountService.CreateUserAsync("kim.lee", "correct horse battery", cancellation: Token);
        // Off by default: the same name gets a new account.
        Assert.NotEqual(kim.Id, (await SignedIn(Pocket(), Kim() with { Subject = "first" })).Id);

        var keycloak = Pocket() with { Name = "keycloak", LinkByUsername = UsernameLinking.Users };
        var result = Assert.IsType<ExternalSignInResult.Success>(await signIn.SignInAsync(keycloak, Kim(), Token));
        Assert.Equal((kim.Id, "username"), (result.Account.Id, result.JoinedBy));
        Assert.Equal("Kim.Lee", (await identities.FindAsync("keycloak", "sub-kim", Token))!.Username);
        // Already linked to that provider: a second provider account with the name gets its own.
        Assert.NotEqual(kim.Id, (await SignedIn(keycloak, Kim() with { Subject = "other" })).Id);
    }

    [Fact]
    public async Task A_matching_username_joins_an_admin_only_with_all()
    {
        var admin = await accountService.CreateUserAsync("kim.lee", "correct horse battery", cancellation: Token);
        await accountService.SetRoleAsync(admin.Id, Role.Admin, Token);
        var users = Pocket() with { LinkByUsername = UsernameLinking.Users };
        Assert.NotEqual(admin.Id, (await SignedIn(users, Kim() with { Subject = "renamed-themselves" })).Id);

        var everyone = Pocket() with { Name = "keycloak", LinkByUsername = UsernameLinking.All };
        Assert.Equal(admin.Id, (await SignedIn(everyone, Kim())).Id);
    }

    [Fact]
    public async Task A_user_map_joins_and_remaps_without_moving_anything()
    {
        var ben = await accountService.CreateUserAsync("bendimit", "correct horse battery", cancellation: Token);
        await accountService.SetRoleAsync(ben.Id, Role.SuperAdmin, Token);
        var benAtPocket = Kim() with { Subject = "sub-ben", Username = "Ben" };

        // Signed in before the mapping existed: an account of its own.
        var stray = await SignedIn(Pocket(), benAtPocket);
        Assert.NotEqual(ben.Id, stray.Id);

        var mapped = Pocket() with { UserMap = new Dictionary<string, string> { ["ben"] = "bendimit" } };
        var result = Assert.IsType<ExternalSignInResult.Success>(await signIn.SignInAsync(mapped, benAtPocket, Token));
        Assert.Equal((ben.Id, "remap"), (result.Account.Id, result.JoinedBy));
        Assert.Equal(ben.Id, (await identities.FindAsync("pocket", "sub-ben", Token))!.AccountId);
        // The stray account is left as it was, only without the link.
        Assert.NotNull(await accounts.FindByIdAsync(stray.Id, Token));
        Assert.Empty(await signIn.IdentitiesOfAsync(stray.Id, Token));

        // From then on a plain sign-in.
        Assert.Null(Assert.IsType<ExternalSignInResult.Success>(await signIn.SignInAsync(mapped, benAtPocket, Token)).JoinedBy);
    }

    [Fact]
    public async Task Saved_mappings_work_like_the_setting_and_the_setting_wins()
    {
        var kim = await accountService.CreateUserAsync("kimberly", "correct horse battery", cancellation: Token);
        var other = await accountService.CreateUserAsync("someone", "correct horse battery", cancellation: Token);
        await identities.PutMappingAsync(new IdentityMapping
        {
            Provider = "pocket", ProviderUsername = "kim.lee", AccountId = kim.Id, CreatedAt = DateTimeOffset.UtcNow,
        }, Token);
        var result = Assert.IsType<ExternalSignInResult.Success>(await signIn.SignInAsync(Pocket(), Kim(), Token));
        Assert.Equal((kim.Id, "mapping"), (result.Account.Id, result.JoinedBy));

        var overridden = Pocket() with { UserMap = new Dictionary<string, string> { ["kim.lee"] = "someone" } };
        Assert.Equal(other.Id, (await SignedIn(overridden, Kim())).Id);

        // A mapping to an account that is gone is ignored.
        var gone = Pocket() with { UserMap = new Dictionary<string, string> { ["newbie"] = "nobody" } };
        Assert.Equal("newbie", (await SignedIn(gone, Kim() with { Subject = "sub-new", Username = "newbie" })).Username);
    }
}
