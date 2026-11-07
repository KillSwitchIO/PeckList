using PeckList.Core.Accounts;
using PeckList.Core.Configuration;
using PeckList.Storage.Sql;

namespace PeckList.Storage.Tests;

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
        ClientId = "pecklist",
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
        var provider = Pocket() with { RequiredGroups = ["pecklist", "family"] };
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
    public async Task A_sign_in_with_no_groups_lowers_the_role_says_so_and_the_next_with_the_group_restores_it()
    {
        var provider = Pocket() with
        {
            RoleMap = new Dictionary<string, Role>(StringComparer.OrdinalIgnoreCase) { ["pl-admins"] = Role.Admin },
        };
        await accountService.CreateUserAsync("ann", "correct horse battery", Role.SuperAdmin, cancellation: Token);
        var kim = await SignedIn(provider, Kim("pl-admins"));
        Assert.Equal(Role.Admin, kim.Role);

        var lowered = Assert.IsType<ExternalSignInResult.Success>(await signIn.SignInAsync(provider, Kim(), Token));
        Assert.Equal(Role.User, lowered.Account.Role);
        Assert.Equal(Role.Admin, lowered.RoleBefore);
        Assert.Equal(Role.User, (await accounts.FindByIdAsync(kim.Id, Token))!.Role);

        var restored = Assert.IsType<ExternalSignInResult.Success>(await signIn.SignInAsync(provider, Kim("pl-admins"), Token));
        Assert.Equal(Role.Admin, restored.Account.Role);
        Assert.Equal(Role.User, restored.RoleBefore);
        Assert.Equal(Role.Admin, (await accounts.FindByIdAsync(kim.Id, Token))!.Role);

        // Groups were sent and match nothing: lowered just the same.
        var otherGroups = Assert.IsType<ExternalSignInResult.Success>(await signIn.SignInAsync(provider, Kim("family"), Token));
        Assert.Equal(Role.User, otherGroups.Account.Role);
        Assert.Equal(Role.Admin, otherGroups.RoleBefore);

        // Nothing changed: already a plain user.
        var same = Assert.IsType<ExternalSignInResult.Success>(await signIn.SignInAsync(provider, Kim(), Token));
        Assert.Equal(same.Account.Role, same.RoleBefore);
    }

    [Fact]
    public async Task The_last_super_admin_signing_in_with_no_groups_keeps_the_role_and_it_is_said()
    {
        var provider = Pocket() with
        {
            RoleMap = new Dictionary<string, Role>(StringComparer.OrdinalIgnoreCase) { ["pl-owners"] = Role.SuperAdmin },
        };
        await SignedIn(provider, Kim("pl-owners"));
        var spared = Assert.IsType<ExternalSignInResult.Success>(await signIn.SignInAsync(provider, Kim(), Token));
        Assert.Equal(Role.SuperAdmin, spared.Account.Role);
        Assert.True(spared.LastSuperAdminSpared);
    }

    [Fact]
    public async Task Required_groups_refuse_a_sign_in_with_no_groups_before_any_role_changes()
    {
        var provider = Pocket() with
        {
            RequiredGroups = ["pl-admins"],
            RoleMap = new Dictionary<string, Role>(StringComparer.OrdinalIgnoreCase) { ["pl-admins"] = Role.Admin },
        };
        await accountService.CreateUserAsync("ann", "correct horse battery", Role.SuperAdmin, cancellation: Token);
        var kim = await SignedIn(provider, Kim("pl-admins"));

        Assert.IsType<ExternalSignInResult.NotAllowed>(await signIn.SignInAsync(provider, Kim(), Token));
        Assert.Equal(Role.Admin, (await accounts.FindByIdAsync(kim.Id, Token))!.Role);
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
        var strict = Pocket() with { RequiredGroups = ["pecklist"] };
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
    public async Task A_migration_window_never_hands_over_an_admin_unless_only_admins_set_usernames()
    {
        var root = await accountService.CreateUserAsync("root", "correct horse battery", Role.SuperAdmin, cancellation: Token);
        await signIn.OpenMigrationWindowAsync("pocket", TimeSpan.FromHours(1), Token);
        // Someone renamed themselves "root" at the provider: a fresh account, not the admin's.
        var renamed = await SignedIn(Pocket(), Kim() with { Subject = "sub-renamed", Username = "root" });
        Assert.NotEqual(root.Id, renamed.Id);
        Assert.Equal(Role.User, renamed.Role);

        var trusted = await SignedIn(Pocket() with { LinkByUsername = UsernameLinking.All }, Kim() with { Subject = "sub-root", Username = "root" });
        Assert.Equal(root.Id, trusted.Id);
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
    public async Task A_subject_map_joins_and_remaps_without_moving_anything()
    {
        var ben = await accountService.CreateUserAsync("bendimit", "correct horse battery", cancellation: Token);
        await accountService.SetRoleAsync(ben.Id, Role.SuperAdmin, Token);
        var benAtPocket = Kim() with { Subject = "sub-ben", Username = "Ben" };

        // Signed in before the mapping existed: an account of its own.
        var stray = await SignedIn(Pocket(), benAtPocket);
        Assert.NotEqual(ben.Id, stray.Id);

        var mapped = Pocket() with { SubjectMap = new Dictionary<string, string> { ["sub-ben"] = "bendimit" } };
        var result = Assert.IsType<ExternalSignInResult.Success>(await signIn.SignInAsync(mapped, benAtPocket, Token));
        Assert.Equal((ben.Id, "remap"), (result.Account.Id, result.JoinedBy));
        Assert.Equal(ben.Id, (await identities.FindAsync("pocket", "sub-ben", Token))!.AccountId);
        // The stray account is left as it was, only without the link.
        Assert.NotNull(await accounts.FindByIdAsync(stray.Id, Token));
        Assert.Empty(await signIn.IdentitiesOfAsync(stray.Id, Token));

        // From then on a plain sign-in.
        Assert.Null(Assert.IsType<ExternalSignInResult.Success>(await signIn.SignInAsync(mapped, benAtPocket, Token)).JoinedBy);
    }

    private OidcProviderSettings Mapping(string username, string account, UsernameLinking linking = UsernameLinking.Off) =>
        Pocket() with { LinkByUsername = linking, UserMap = new Dictionary<string, string> { [username] = account } };

    private static ExternalIdentity Holding(string subject, string username) => Kim() with { Subject = subject, Username = username };

    private async Task<ExternalSignInResult.Success> Success(OidcProviderSettings provider, ExternalIdentity identity) =>
        Assert.IsType<ExternalSignInResult.Success>(await signIn.SignInAsync(provider, identity, Token));

    private Task Saved(string username, string accountId) => identities.PutMappingAsync(new IdentityMapping
    {
        Provider = "pocket", ProviderUsername = username, AccountId = accountId, CreatedAt = DateTimeOffset.UtcNow,
    }, Token);

    [Fact]
    public async Task A_username_that_changes_hands_after_the_first_sign_in_claims_nothing()
    {
        var kim = await accountService.CreateUserAsync("kimberly", "correct horse battery", cancellation: Token);
        var provider = Mapping("kim", "kimberly");
        Assert.Equal((kim.Id, "mapping"), (await Success(provider, Holding("sub-kim", "kim")) is var first ? (first.Account.Id, first.JoinedBy) : default));

        // Kim renames at the provider, and someone else takes the name.
        var other = await Success(provider, Holding("sub-other", "kim"));
        Assert.NotEqual(kim.Id, other.Account.Id);
        Assert.True(other.Created);
        Assert.Equal(kim.Id, (await identities.FindAsync("pocket", "sub-kim", Token))!.AccountId);

        // Kim's link still decides, whatever Kim is called now.
        Assert.Equal(kim.Id, (await Success(provider, Holding("sub-kim", "kimmy"))).Account.Id);
    }

    [Fact]
    public async Task Unlinking_someone_opens_a_username_entry_in_the_setting_to_a_first_claim_again()
    {
        // The setting cannot be emptied from here, so the guide says to take the entry out.
        var kim = await accountService.CreateUserAsync("kimberly", "correct horse battery", cancellation: Token);
        var provider = Mapping("kim", "kimberly");
        await SignedIn(provider, Holding("sub-kim", "kim"));
        Assert.Equal(UnlinkResult.Unlinked, await signIn.UnlinkAsync(kim.Id, "pocket", "sub-kim", selfService: false, Token));

        Assert.Equal(kim.Id, (await SignedIn(provider, Holding("sub-other", "kim"))).Id);
    }

    [Fact]
    public async Task A_username_mapping_never_joins_an_admin_account_without_all_and_says_so()
    {
        var boss = await accountService.CreateUserAsync("boss", "correct horse battery", Role.Admin, cancellation: Token);

        var newAccount = await Success(Mapping("rob", "boss"), Holding("sub-rob", "rob"));
        Assert.True(newAccount.Created);
        Assert.NotEqual(boss.Id, newAccount.Account.Id);
        Assert.Equal("boss", newAccount.MappingRefusedTo);

        // Linking by username being on for plain users is not enough.
        var plainUsers = await Success(Mapping("sam", "boss", UsernameLinking.Users), Holding("sub-sam", "sam"));
        Assert.NotEqual(boss.Id, plainUsers.Account.Id);

        var waiting = await signIn.SignInAsync(Mapping("ann", "boss") with { AutoCreate = false }, Holding("sub-ann", "ann"), Token);
        Assert.Equal("boss", Assert.IsType<ExternalSignInResult.Pending>(waiting).MappingRefusedTo);

        var all = await Success(Mapping("kim", "boss", UsernameLinking.All), Holding("sub-kim", "kim"));
        Assert.Equal((boss.Id, "mapping"), (all.Account.Id, all.JoinedBy));
        Assert.Null(all.MappingRefusedTo);
    }

    [Fact]
    public async Task Someone_already_linked_with_a_matching_username_mapping_signs_in_and_nothing_changes()
    {
        var ben = await accountService.CreateUserAsync("ben", "correct horse battery", Role.SuperAdmin, cancellation: Token);
        var firstIn = Mapping("ben", "ben", UsernameLinking.All);
        await SignedIn(firstIn, Holding("sub-ben", "ben"));
        var before = await identities.FindAsync("pocket", "sub-ben", Token);

        foreach (var linking in new[] { UsernameLinking.All, UsernameLinking.Users, UsernameLinking.Off })
        {
            var again = await Success(Mapping("ben", "ben", linking), Holding("sub-ben", "ben"));
            Assert.Equal((ben.Id, false, null, null), (again.Account.Id, again.Created, again.JoinedBy, again.MappingRefusedTo));
            Assert.Equal(Role.SuperAdmin, again.Account.Role);
        }
        var after = await identities.FindAsync("pocket", "sub-ben", Token);
        Assert.Equal((before!.AccountId, before.Username, before.LinkedAt), (after!.AccountId, after.Username, after.LinkedAt));
        Assert.Single(await signIn.IdentitiesOfAsync(ben.Id, Token));
    }

    [Fact]
    public async Task A_subject_entry_decides_and_a_username_shaped_like_one_does_not()
    {
        var boss = await accountService.CreateUserAsync("boss", "correct horse battery", Role.Admin, cancellation: Token);
        var provider = Pocket() with { SubjectMap = new Dictionary<string, string> { ["auth0|abc"] = "boss" } };

        var renamed = await Success(provider, Holding("sub-other", "auth0|abc"));
        Assert.NotEqual(boss.Id, renamed.Account.Id);
        var prefixed = await Success(provider, Holding("sub-third", "sub:auth0|abc"));
        Assert.NotEqual(boss.Id, prefixed.Account.Id);

        // Exact, so a subject differing in case is another person.
        Assert.NotEqual(boss.Id, (await Success(provider, Holding("AUTH0|ABC", "nobody"))).Account.Id);
        Assert.Equal((boss.Id, "mapping"), (await Success(provider, Holding("auth0|abc", "anything")) is var real ? (real.Account.Id, real.JoinedBy) : default));
    }

    [Fact]
    public async Task A_saved_mapping_is_deleted_once_used_and_cannot_be_claimed_again()
    {
        var kim = await accountService.CreateUserAsync("kimberly", "correct horse battery", cancellation: Token);
        await Saved("kim", kim.Id);

        var used = await Success(Pocket(), Holding("sub-kim", "kim"));
        Assert.Equal((kim.Id, "mapping", "kim"), (used.Account.Id, used.JoinedBy, used.MappingUsed));
        Assert.Empty(await identities.ListMappingsAsync(Token));

        Assert.NotEqual(kim.Id, (await Success(Pocket(), Holding("sub-other", "kim"))).Account.Id);
    }

    /// <summary>Another sign-in wins the mapping just before this one gets to it.</summary>
    private class Beaten : System.Reflection.DispatchProxy
    {
        public IIdentityStore Inner { get; set; } = null!;

        /// <summary>Whose sign-in won.</summary>
        public string Winner { get; set; } = "";

        protected override object? Invoke(System.Reflection.MethodInfo? method, object?[]? args)
        {
            if (method!.Name != nameof(IIdentityStore.LinkByMappingAsync)) return method.Invoke(Inner, args);
            Inner.LinkByMappingAsync((LinkedIdentity)args![0]! with { Subject = Winner }, (string)args[1]!, Token).GetAwaiter().GetResult();
            return Task.FromResult(false);
        }
    }

    private ExternalSignIn BeatenBy(string winner)
    {
        var beaten = System.Reflection.DispatchProxy.Create<IIdentityStore, Beaten>();
        ((Beaten)(object)beaten).Inner = identities;
        ((Beaten)(object)beaten).Winner = winner;
        return new ExternalSignIn(accounts, accountService, beaten, groups, secrets, TimeProvider.System);
    }

    [Fact]
    public async Task The_same_person_signing_in_twice_at_once_makes_no_second_account()
    {
        var kim = await accountService.CreateUserAsync("kimberly", "correct horse battery", cancellation: Token);
        await Saved("kim", kim.Id);
        var before = await accounts.CountAsync(Token);

        var result = Assert.IsType<ExternalSignInResult.Success>(await BeatenBy("sub-kim").SignInAsync(Pocket(), Holding("sub-kim", "kim"), Token));

        Assert.Equal((kim.Id, false), (result.Account.Id, result.Created));
        Assert.Equal(before, await accounts.CountAsync(Token));
    }

    [Fact]
    public async Task Someone_else_winning_the_mapping_leaves_this_sign_in_to_the_usual_steps()
    {
        var kim = await accountService.CreateUserAsync("kimberly", "correct horse battery", cancellation: Token);
        await Saved("kim", kim.Id);

        var result = Assert.IsType<ExternalSignInResult.Success>(await BeatenBy("sub-winner").SignInAsync(Pocket(), Holding("sub-loser", "kim"), Token));

        Assert.True(result.Created);
        Assert.NotEqual(kim.Id, result.Account.Id);
        Assert.Null(result.MappingUsed);
        Assert.Equal(kim.Id, (await identities.FindAsync("pocket", "sub-winner", Token))!.AccountId);
    }

    [Fact]
    public async Task A_disabled_account_still_reports_the_saved_mapping_it_used()
    {
        var kim = await accountService.CreateUserAsync("kimberly", "correct horse battery", cancellation: Token);
        await accountService.SetDisabledAsync(kim.Id, true, Token);
        await Saved("kim", kim.Id);

        var result = await signIn.SignInAsync(Pocket(), Holding("sub-kim", "kim"), Token);
        Assert.Equal("kim", Assert.IsType<ExternalSignInResult.Disabled>(result).MappingUsed);
        Assert.Empty(await identities.ListMappingsAsync(Token));
    }

    [Fact]
    public async Task A_saved_mapping_for_someone_already_there_is_deleted_at_their_next_sign_in()
    {
        var kim = await accountService.CreateUserAsync("kimberly", "correct horse battery", cancellation: Token);
        await signIn.LinkByAdminAsync("pocket", "sub-kim", kim.Id, Token);
        await Saved("kim", kim.Id);

        var again = await Success(Pocket(), Holding("sub-kim", "kim"));
        Assert.Equal((kim.Id, null, "kim"), (again.Account.Id, again.JoinedBy, again.MappingUsed));
        Assert.Empty(await identities.ListMappingsAsync(Token));
    }

    [Fact]
    public async Task A_saved_mapping_whose_account_is_linked_to_someone_else_does_nothing()
    {
        var kim = await accountService.CreateUserAsync("kimberly", "correct horse battery", cancellation: Token);
        await signIn.LinkByAdminAsync("pocket", "sub-kim", kim.Id, Token);
        await Saved("kim", kim.Id);

        var other = await Success(Pocket(), Holding("sub-other", "kim"));
        Assert.NotEqual(kim.Id, other.Account.Id);
        Assert.Null(other.MappingUsed);
        Assert.Single(await identities.ListMappingsAsync(Token));
    }

    [Fact]
    public async Task Someone_already_linked_who_takes_a_mapped_name_stays_where_they_are()
    {
        var kim = await accountService.CreateUserAsync("kimberly", "correct horse battery", cancellation: Token);
        var boss = await accountService.CreateUserAsync("boss", "correct horse battery", Role.Admin, cancellation: Token);
        var own = await SignedIn(Pocket(), Holding("sub-other", "other"));
        await Saved("saved", kim.Id);

        foreach (var (provider, name) in new[] { (Mapping("kim", "kimberly"), "kim"), (Pocket(), "saved"), (Mapping("big", "boss", UsernameLinking.All), "big") })
        {
            var result = await Success(provider, Holding("sub-other", name));
            Assert.Equal((own.Id, null, null, null), (result.Account.Id, result.JoinedBy, result.MappingUsed, result.MappingRefusedTo));
        }
        Assert.Empty(await signIn.IdentitiesOfAsync(kim.Id, Token));
        Assert.Empty(await signIn.IdentitiesOfAsync(boss.Id, Token));

        // The real Kim still gets in, and the saved mapping is still there for them.
        Assert.Equal(kim.Id, (await SignedIn(Pocket(), Holding("sub-saved", "saved"))).Id);
    }

    [Theory]
    [InlineData("kim@evil.example")]
    [InlineData(".kim.")]
    [InlineData("-kim_")]
    [InlineData("k\u00EFm")]
    [InlineData("\u212Aim")]
    [InlineData("kim2")]
    public async Task A_mapping_matches_the_exact_name_and_nothing_near_it(string name)
    {
        var kim = await accountService.CreateUserAsync("kimberly", "correct horse battery", cancellation: Token);
        Assert.NotEqual(kim.Id, (await SignedIn(Mapping("kim", "kimberly"), Holding("sub-near", name))).Id);
        Assert.Empty(await signIn.IdentitiesOfAsync(kim.Id, Token));
    }

    [Fact]
    public async Task A_mapping_never_falls_back_on_the_email()
    {
        var kim = await accountService.CreateUserAsync("kimberly", "correct horse battery", cancellation: Token);
        var noName = Kim() with { Subject = "sub-near", Username = null, Email = "kim@evil.example" };
        Assert.NotEqual(kim.Id, (await SignedIn(Mapping("kim", "kimberly"), noName)).Id);
        Assert.Empty(await signIn.IdentitiesOfAsync(kim.Id, Token));
    }

    [Theory]
    [InlineData("KIM")]
    [InlineData(" kim ")]
    public async Task A_mapping_ignores_case_and_spaces_around_the_name(string name)
    {
        var kim = await accountService.CreateUserAsync("kimberly", "correct horse battery", cancellation: Token);
        Assert.Equal(kim.Id, (await SignedIn(Mapping("kim", "kimberly"), Holding("sub-kim", name))).Id);
    }

    [Fact]
    public async Task A_provider_that_sends_an_email_as_the_username_needs_it_written_in_full()
    {
        var kim = await accountService.CreateUserAsync("kimberly", "correct horse battery", cancellation: Token);
        Assert.Equal(kim.Id, (await SignedIn(Mapping("kim@corp.example", "kimberly"), Holding("sub-kim", "kim@corp.example"))).Id);
    }

    [Fact]
    public async Task Someone_removing_their_own_link_opens_a_username_entry_to_a_first_claim_again()
    {
        var kim = await accountService.CreateUserAsync("kimberly", "correct horse battery", cancellation: Token);
        var provider = Mapping("kim", "kimberly");
        await SignedIn(provider, Holding("sub-kim", "kim"));
        Assert.Equal(UnlinkResult.Unlinked, await signIn.UnlinkAsync(kim.Id, "pocket", "sub-kim", selfService: true, Token));

        Assert.Equal(kim.Id, (await SignedIn(provider, Holding("sub-other", "kim"))).Id);
    }

    [Fact]
    public async Task Someone_re_created_at_the_provider_lands_in_a_new_account()
    {
        var kim = await accountService.CreateUserAsync("kimberly", "correct horse battery", cancellation: Token);
        var provider = Mapping("kim", "kimberly");
        await SignedIn(provider, Holding("sub-kim", "kim"));

        Assert.NotEqual(kim.Id, (await SignedIn(provider, Holding("sub-kim-again", "kim"))).Id);
    }

    [Fact]
    public async Task A_setting_naming_an_account_that_is_gone_stops_there_and_a_saved_mapping_under_it_does_not_act()
    {
        var kim = await accountService.CreateUserAsync("kimberly", "correct horse battery", cancellation: Token);
        await Saved("kim", kim.Id);

        var result = await Success(Mapping("kim", "nobody"), Holding("sub-kim", "kim"));

        Assert.NotEqual(kim.Id, result.Account.Id);
        Assert.Null(result.MappingUsed);
        Assert.Single(await identities.ListMappingsAsync(Token));
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

        // Both name the same provider user: the setting wins, and the saved one stays unused.
        await Saved("kim.lee", kim.Id);
        var overridden = Pocket() with { UserMap = new Dictionary<string, string> { ["kim.lee"] = "someone" } };
        Assert.Equal(other.Id, (await SignedIn(overridden, Kim() with { Subject = "sub-other" })).Id);
        Assert.Single(await identities.ListMappingsAsync(Token));

        // A mapping to an account that is gone is ignored.
        var gone = Pocket() with { UserMap = new Dictionary<string, string> { ["newbie"] = "nobody" } };
        Assert.Equal("newbie", (await SignedIn(gone, Kim() with { Subject = "sub-new", Username = "newbie" })).Username);
    }
}
