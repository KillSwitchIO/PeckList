using PeckList.Core.Accounts;

namespace PeckList.Core.Tests;

/// <summary>A clock the test moves by hand.</summary>
public sealed class TestClock(DateTimeOffset start) : TimeProvider
{
    public DateTimeOffset Now { get; set; } = start;

    public override DateTimeOffset GetUtcNow() => Now;
}

/// <summary>Accounts in memory, for tests of the rules above the store.</summary>
public sealed class MemoryAccountStore : IAccountStore
{
    public Dictionary<string, Account> ById { get; } = [];

    public Task<int> CountAsync(CancellationToken cancellation = default) => Task.FromResult(ById.Count);

    /// <summary>Waited on before every list: lets a test hold two changes in the middle at once.</summary>
    public Func<Task>? BeforeList { get; set; }

    public async Task<IReadOnlyList<Account>> ListAsync(CancellationToken cancellation = default)
    {
        if (BeforeList is { } wait) await wait();
        return ById.Values.OrderBy(each => each.CreatedAt).ToList();
    }

    public Task<Account?> FindByIdAsync(string id, CancellationToken cancellation = default) =>
        Task.FromResult(ById.GetValueOrDefault(id));

    public Task<Account?> FindByUsernameAsync(string username, CancellationToken cancellation = default) =>
        Task.FromResult(ById.Values.FirstOrDefault(each => each.Username == username.ToLowerInvariant()));

    public Task<Account?> FindByFriendCodeAsync(string code, CancellationToken cancellation = default) =>
        Task.FromResult(ById.Values.FirstOrDefault(each => each.FriendCode == code));

    public Task CreateAsync(Account account, CancellationToken cancellation = default)
    {
        if (ById.Values.Any(each => each.Username == account.Username.ToLowerInvariant())) throw new DuplicateUsernameException(account.Username);
        ById[account.Id] = account with { Username = account.Username.ToLowerInvariant() };
        return Task.CompletedTask;
    }

    public Task UpdateAsync(Account account, CancellationToken cancellation = default)
    {
        if (!ById.ContainsKey(account.Id)) throw new KeyNotFoundException();
        ById[account.Id] = account;
        return Task.CompletedTask;
    }

    public Task<bool> DeleteAsync(string id, CancellationToken cancellation = default) => Task.FromResult(ById.Remove(id));
}

/// <summary>"Hashes" by prefixing; flags old-style hashes for an upgrade.</summary>
public sealed class FakeHasher : IPasswordHasher
{
    public int Verifications { get; private set; }

    public string Hash(string password) => "v2:" + password;

    public bool Verify(string hash, string password, out bool rehash)
    {
        Verifications++;
        rehash = hash.StartsWith("v1:", StringComparison.Ordinal);
        return hash == "v2:" + password || hash == "v1:" + password;
    }
}

public sealed class AccountServiceTests
{
    private readonly MemoryAccountStore store = new();
    private readonly FakeHasher hasher = new();
    private readonly TestClock clock = new(new DateTimeOffset(2026, 10, 21, 12, 0, 0, TimeSpan.Zero));
    private readonly AccountService accounts;

    public AccountServiceTests() => accounts = new AccountService(store, hasher, clock);

    private static CancellationToken Token => TestContext.Current.CancellationToken;

    private Account Admin => store.ById.Values.Single(each => each.Username == "admin");

    [Fact]
    public async Task A_long_admin_password_stops_a_first_start_and_makes_nothing()
    {
        var error = await Assert.ThrowsAsync<PeckList.Core.Configuration.SettingsException>(() =>
            accounts.EnsureAdminAsync(new string('x', AccountService.MaxNewPasswordLength + 1), Token));
        Assert.Contains("ADMIN_PASSWORD must be 12 to 64 characters", error.Message);
        Assert.Empty(store.ById);
    }

    [Fact]
    public async Task An_admin_password_that_could_never_sign_in_is_refused_wherever_it_would_be_used()
    {
        var tooLong = new string('x', AccountService.MaxTriedPasswordLength + 1);

        // A server in use that lost its admin.
        await accounts.CreateUserAsync("sam", "correct horse battery", cancellation: Token);
        await Assert.ThrowsAsync<PeckList.Core.Configuration.SettingsException>(() => accounts.EnsureAdminAsync(tooLong, Token));

        // A server moving from AUTH_MODE=none: an admin with no password.
        await accounts.EnsureOwnerAsync(Token);
        await Assert.ThrowsAsync<PeckList.Core.Configuration.SettingsException>(() => accounts.EnsureAdminAsync(tooLong, Token));
        Assert.Null(Admin.PasswordHash);
    }

    [Fact]
    public async Task A_password_over_the_cap_is_never_hashed_when_tried()
    {
        var sam = await accounts.CreateUserAsync("sam", "correct horse battery", cancellation: Token);
        var tooLong = new string('x', AccountService.MaxTriedPasswordLength + 1);

        Assert.IsType<LoginResult.Invalid>(await accounts.LoginAsync("sam", tooLong, Token));
        Assert.IsType<LoginResult.Invalid>(await accounts.LoginAsync("nobody", tooLong, Token));
        Assert.Equal(PasswordChange.WrongPassword, (await accounts.ChangePasswordAsync(sam.Id, tooLong, "a brand new password", Token)).Result);
        Assert.Equal(PasswordChange.WrongPassword, (await accounts.RemovePasswordAsync(sam.Id, tooLong, Token)).Result);
        Assert.Equal(0, hasher.Verifications);
    }

    [Fact]
    public async Task First_start_makes_an_admin_with_a_generated_password_to_change()
    {
        var password = await accounts.EnsureAdminAsync(null, Token);
        Assert.NotNull(password);
        Assert.Equal(20, password.Length);
        Assert.Equal(Role.SuperAdmin, Admin.Role);
        Assert.True(Admin.MustChangePassword);
        Assert.Equal(26, Admin.Id.Length);

        // Only once.
        Assert.Null(await accounts.EnsureAdminAsync(null, Token));
        Assert.Single(store.ById);
        Assert.IsType<LoginResult.Success>(await accounts.LoginAsync("Admin", password, Token));
    }

    [Fact]
    public async Task A_configured_admin_password_is_used_and_needs_no_change()
    {
        Assert.Null(await accounts.EnsureAdminAsync("correct horse battery", Token));
        Assert.False(Admin.MustChangePassword);
        Assert.IsType<LoginResult.Success>(await accounts.LoginAsync("admin", "correct horse battery", Token));
    }

    [Fact]
    public async Task The_owner_from_auth_mode_none_gets_a_password_when_logins_start()
    {
        var owner = await accounts.EnsureOwnerAsync(Token);
        Assert.Null(owner.PasswordHash);
        Assert.Equal(owner, await accounts.EnsureOwnerAsync(Token));

        var password = await accounts.EnsureAdminAsync(null, Token);
        Assert.NotNull(password);
        Assert.Equal(owner.Id, Admin.Id);
        Assert.IsType<LoginResult.Success>(await accounts.LoginAsync("admin", password, Token));
    }

    [Fact]
    public async Task Unknown_users_and_wrong_passwords_look_the_same()
    {
        await accounts.EnsureAdminAsync("correct horse battery", Token);
        var before = hasher.Verifications;
        Assert.IsType<LoginResult.Invalid>(await accounts.LoginAsync("nobody", "whatever", Token));
        Assert.IsType<LoginResult.Invalid>(await accounts.LoginAsync("admin", "wrong", Token));
        // A hash is checked either way, so timing does not tell them apart.
        Assert.Equal(before + 2, hasher.Verifications);
    }

    [Fact]
    public async Task Locks_after_repeated_failures_then_unlocks_after_a_while()
    {
        await accounts.EnsureAdminAsync("correct horse battery", Token);
        for (var attempt = 1; attempt < AccountService.MaxFailedLogins; attempt++)
        {
            Assert.IsType<LoginResult.Invalid>(await accounts.LoginAsync("admin", "wrong", Token));
        }
        var locked = Assert.IsType<LoginResult.Locked>(await accounts.LoginAsync("admin", "wrong", Token));
        Assert.Equal(clock.Now + AccountService.LockoutTime, locked.Until);

        // Even the right password waits out the lock.
        Assert.IsType<LoginResult.Locked>(await accounts.LoginAsync("admin", "correct horse battery", Token));
        clock.Now += AccountService.LockoutTime;
        Assert.IsType<LoginResult.Success>(await accounts.LoginAsync("admin", "correct horse battery", Token));
        Assert.Equal(0, Admin.FailedLogins);
        Assert.Null(Admin.LockedUntil);
    }

    [Fact]
    public async Task A_success_clears_earlier_failures()
    {
        await accounts.EnsureAdminAsync("correct horse battery", Token);
        await accounts.LoginAsync("admin", "wrong", Token);
        await accounts.LoginAsync("admin", "correct horse battery", Token);
        Assert.Equal(0, Admin.FailedLogins);
    }

    [Fact]
    public async Task Disabled_accounts_cannot_log_in()
    {
        await accounts.EnsureAdminAsync("correct horse battery", Token);
        await store.UpdateAsync(Admin with { Disabled = true }, Token);
        Assert.IsType<LoginResult.Invalid>(await accounts.LoginAsync("admin", "correct horse battery", Token));
    }

    [Fact]
    public async Task Upgrades_an_old_hash_on_login()
    {
        await accounts.EnsureAdminAsync("correct horse battery", Token);
        await store.UpdateAsync(Admin with { PasswordHash = "v1:correct horse battery" }, Token);
        await accounts.LoginAsync("admin", "correct horse battery", Token);
        Assert.Equal("v2:correct horse battery", Admin.PasswordHash);
    }

    [Fact]
    public async Task Changing_the_password_checks_it_and_ends_other_sessions()
    {
        var generated = (await accounts.EnsureAdminAsync(null, Token))!;
        var stamp = Admin.SecurityStamp;
        Assert.Equal(PasswordChange.WrongPassword, (await accounts.ChangePasswordAsync(Admin.Id, "nope", "a brand new password", Token)).Result);
        Assert.Equal(PasswordChange.TooShort, (await accounts.ChangePasswordAsync(Admin.Id, generated, "short", Token)).Result);
        Assert.Equal(PasswordChange.Unchanged, (await accounts.ChangePasswordAsync(Admin.Id, generated, generated, Token)).Result);

        var (result, updated) = await accounts.ChangePasswordAsync(Admin.Id, generated, "a brand new password", Token);
        Assert.Equal(PasswordChange.Changed, result);
        Assert.False(updated!.MustChangePassword);
        Assert.NotEqual(stamp, updated.SecurityStamp);
        Assert.IsType<LoginResult.Success>(await accounts.LoginAsync("admin", "a brand new password", Token));
    }

    /// <summary>
    /// Confirming the password (deleting the account, changing or removing the password) counts
    /// wrong ones toward the same lockout as signing in, so a session in someone else's hands
    /// cannot guess it (security review of self-delete, Low 2).
    /// </summary>
    [Fact]
    public async Task Wrong_passwords_when_confirming_count_toward_the_sign_in_lockout()
    {
        await accounts.EnsureAdminAsync("correct horse battery", Token);
        // Two wrong at sign-in, then wrong when deleting, changing and removing it.
        await accounts.LoginAsync("admin", "wrong", Token);
        await accounts.LoginAsync("admin", "wrong", Token);
        Assert.IsType<PasswordCheck.Wrong>(await accounts.ConfirmPasswordAsync(Admin, "wrong", Token));
        Assert.Equal(PasswordChange.WrongPassword, (await accounts.ChangePasswordAsync(Admin.Id, "wrong", "a brand new password", Token)).Result);
        var (removal, locked) = await accounts.RemovePasswordAsync(Admin.Id, "wrong", Token);
        Assert.Equal(PasswordChange.Locked, removal);
        Assert.Equal(clock.Now + AccountService.LockoutTime, locked!.LockedUntil);

        // Locked everywhere, the right password too, until it ends.
        Assert.IsType<LoginResult.Locked>(await accounts.LoginAsync("admin", "correct horse battery", Token));
        Assert.Equal(clock.Now + AccountService.LockoutTime,
            Assert.IsType<PasswordCheck.Locked>(await accounts.ConfirmPasswordAsync(Admin, "correct horse battery", Token)).Until);
        Assert.Equal(PasswordChange.Locked, (await accounts.ChangePasswordAsync(Admin.Id, "correct horse battery", "a brand new password", Token)).Result);
        Assert.NotNull(Admin.PasswordHash);

        clock.Now += AccountService.LockoutTime;
        Assert.IsType<PasswordCheck.Right>(await accounts.ConfirmPasswordAsync(Admin, "correct horse battery", Token));
    }

    [Fact]
    public async Task The_right_password_when_confirming_clears_earlier_failures()
    {
        await accounts.EnsureAdminAsync("correct horse battery", Token);
        await accounts.LoginAsync("admin", "wrong", Token);
        await accounts.ConfirmPasswordAsync(Admin, "wrong", Token);
        Assert.Equal(2, Admin.FailedLogins);
        var right = Assert.IsType<PasswordCheck.Right>(await accounts.ConfirmPasswordAsync(Admin, "correct horse battery", Token));
        Assert.Equal(0, right.Account.FailedLogins);
        Assert.Equal(0, Admin.FailedLogins);

        // A change after the right password keeps the cleared count.
        await accounts.ConfirmPasswordAsync(Admin, "wrong", Token);
        Assert.Equal(PasswordChange.Changed, (await accounts.ChangePasswordAsync(Admin.Id, "correct horse battery", "a brand new password", Token)).Result);
        Assert.Equal(0, Admin.FailedLogins);
    }

    [Fact]
    public async Task Confirming_a_password_too_long_to_check_counts_for_nothing_and_is_never_hashed()
    {
        await accounts.EnsureAdminAsync("correct horse battery", Token);
        var before = hasher.Verifications;
        Assert.IsType<PasswordCheck.Wrong>(await accounts.ConfirmPasswordAsync(Admin, new string('x', AccountService.MaxTriedPasswordLength + 1), Token));
        Assert.Equal(before, hasher.Verifications);
        Assert.Equal(0, Admin.FailedLogins);
    }

    [Fact]
    public async Task Reset_gives_a_new_password_to_change_and_unlocks()
    {
        await accounts.EnsureAdminAsync("correct horse battery", Token);
        await store.UpdateAsync(Admin with { LockedUntil = clock.Now.AddHours(1), FailedLogins = 2 }, Token);
        var password = await accounts.ResetPasswordAsync("admin", Token);
        Assert.True(Admin.MustChangePassword);
        Assert.IsType<LoginResult.Success>(await accounts.LoginAsync("admin", password, Token));
        await Assert.ThrowsAsync<KeyNotFoundException>(() => accounts.ResetPasswordAsync("nobody", Token));
    }

    [Fact]
    public async Task Reset_refuses_a_deleted_account_and_leaves_its_password_as_it_was()
    {
        var kim = await accounts.CreateUserAsync("kim", "a long enough password", cancellation: Token);
        await accounts.DeleteAsync(kim.Id, Token);
        var before = (await store.FindByIdAsync(kim.Id, Token))!;

        var refused = await Assert.ThrowsAsync<ArgumentException>(() => accounts.ResetPasswordAsync("kim", Token));
        Assert.Contains("was deleted", refused.Message);
        Assert.Equal((before.PasswordHash, before.SecurityStamp), ((await store.FindByIdAsync(kim.Id, Token))!.PasswordHash, (await store.FindByIdAsync(kim.Id, Token))!.SecurityStamp));
    }
}

public sealed class RoleTests
{
    private readonly MemoryAccountStore store = new();
    private readonly TestClock clock = new(new DateTimeOffset(2026, 10, 22, 8, 0, 0, TimeSpan.Zero));
    private readonly AccountService accounts;

    public RoleTests() => accounts = new AccountService(store, new FakeHasher(), clock);

    private static CancellationToken Token => TestContext.Current.CancellationToken;

    private async Task<Account> AddAsync(string username, Role role)
    {
        clock.Now = clock.Now.AddMinutes(1);
        return await accounts.CreateUserAsync(username, "correct horse battery", role, cancellation: Token);
    }

    [Fact]
    public void Each_role_has_a_fixed_set_of_permissions()
    {
        Assert.Empty(Roles.PermissionsOf(Role.User));
        Assert.True(Role.Admin.Can(Permission.ManageUsers));
        Assert.True(Role.Admin.Can(Permission.ManageSettings));
        Assert.False(Role.Admin.Can(Permission.ManageAdmins));
        Assert.False(Role.Admin.Can(Permission.Impersonate));
        Assert.Equal(Enum.GetValues<Permission>(), Roles.PermissionsOf(Role.SuperAdmin).Order());
    }

    [Theory]
    [InlineData("superadmin", Role.SuperAdmin)]
    [InlineData("Super-Admin", Role.SuperAdmin)]
    [InlineData("super_admin", Role.SuperAdmin)]
    [InlineData("ADMIN", Role.Admin)]
    [InlineData("user", Role.User)]
    public void Roles_read_as_typed(string text, Role expected)
    {
        Assert.True(Roles.TryParse(text, out var role));
        Assert.Equal(expected, role);
        Assert.Equal(expected, Enum.Parse<Role>(role.Name(), ignoreCase: true));
    }

    [Theory]
    [InlineData("owner")]
    [InlineData("2")]
    [InlineData("")]
    [InlineData(null)]
    public void Unknown_roles_are_refused(string? text) => Assert.False(Roles.TryParse(text, out _));

    [Fact]
    public async Task Servers_from_before_roles_get_their_admin_as_super_admin()
    {
        await AddAsync("ann", Role.Admin);
        await AddAsync("admin", Role.Admin);
        await accounts.EnsureAdminAsync(null, Token);
        Assert.Equal(Role.SuperAdmin, (await store.FindByUsernameAsync("admin", Token))!.Role);
        Assert.Equal(Role.Admin, (await store.FindByUsernameAsync("ann", Token))!.Role);
    }

    [Fact]
    public async Task The_admin_promoted_to_super_admin_has_no_lease_and_one_being_deleted_is_passed_over()
    {
        var gone = await AddAsync("ann", Role.Admin);
        await store.UpdateAsync(gone with { DeletedAt = clock.Now }, Token);
        var bob = await AddAsync("bob", Role.Admin);
        await store.UpdateAsync(bob with { RoleProvider = "pocket", RoleRenewedAt = clock.Now }, Token);
        await accounts.EnsureSuperAdminAsync(Token);
        Assert.Equal(Role.Admin, (await store.FindByUsernameAsync("ann", Token))!.Role);
        var raised = (await store.FindByUsernameAsync("bob", Token))!;
        Assert.Equal((Role.SuperAdmin, null, null), (raised.Role, raised.RoleProvider, raised.RoleRenewedAt));
    }

    [Fact]
    public async Task Without_the_bootstrap_admin_the_oldest_admin_is_promoted()
    {
        await AddAsync("sam", Role.User);
        await AddAsync("ann", Role.Admin);
        await AddAsync("bob", Role.Admin);
        await accounts.EnsureSuperAdminAsync(Token);
        Assert.Equal(Role.SuperAdmin, (await store.FindByUsernameAsync("ann", Token))!.Role);
        Assert.Equal(Role.Admin, (await store.FindByUsernameAsync("bob", Token))!.Role);
    }

    [Fact]
    public async Task The_last_super_admin_keeps_the_role()
    {
        var first = await AddAsync("ann", Role.SuperAdmin);
        var sam = await AddAsync("sam", Role.User);
        await Assert.ThrowsAsync<LastSuperAdminException>(() => accounts.SetRoleAsync(first.Id, Role.Admin, Token));

        await accounts.SetRoleAsync(sam.Id, Role.SuperAdmin, Token);
        Assert.Equal(Role.Admin, (await accounts.SetRoleAsync(first.Id, Role.Admin, Token)).Role);
        // A disabled super admin does not count.
        await store.UpdateAsync((await store.FindByIdAsync(first.Id, Token))! with { Role = Role.SuperAdmin, Disabled = true }, Token);
        await Assert.ThrowsAsync<LastSuperAdminException>(() => accounts.SetRoleAsync(sam.Id, Role.User, Token));
        await Assert.ThrowsAsync<KeyNotFoundException>(() => accounts.SetRoleAsync("nobody", Role.User, Token));
    }
}

public sealed class DisableTests
{
    private readonly MemoryAccountStore store = new();
    private readonly AccountService accounts;

    public DisableTests() => accounts = new AccountService(store, new FakeHasher(), new TestClock(new DateTimeOffset(2026, 10, 22, 9, 0, 0, TimeSpan.Zero)));

    private static CancellationToken Token => TestContext.Current.CancellationToken;

    [Fact]
    public async Task Turning_off_ends_sessions_and_never_the_last_super_admin()
    {
        var root = await accounts.CreateUserAsync("root", "correct horse battery", Role.SuperAdmin, cancellation: Token);
        var sam = await accounts.CreateUserAsync("sam", "correct horse battery", cancellation: Token);
        var off = await accounts.SetDisabledAsync(sam.Id, true, Token);
        Assert.True(off.Disabled);
        Assert.NotEqual(sam.SecurityStamp, off.SecurityStamp);
        Assert.IsType<LoginResult.Invalid>(await accounts.LoginAsync("sam", "correct horse battery", Token));
        Assert.False((await accounts.SetDisabledAsync(sam.Id, false, Token)).Disabled);
        Assert.IsType<LoginResult.Success>(await accounts.LoginAsync("sam", "correct horse battery", Token));

        await Assert.ThrowsAsync<LastSuperAdminException>(() => accounts.SetDisabledAsync(root.Id, true, Token));
    }

    [Fact]
    public async Task Two_super_admins_leaving_at_the_same_moment_still_leave_one()
    {
        var root = await accounts.CreateUserAsync("root", "correct horse battery", Role.SuperAdmin, cancellation: Token);
        var kim = await accounts.CreateUserAsync("kim", "correct horse battery", Role.SuperAdmin, cancellation: Token);
        // Each change is slow to look around, so without taking turns both would see the other still there.
        store.BeforeList = () => Task.Delay(100, Token);

        var both = await Task.WhenAll(Attempt(() => accounts.DeleteAsync(root.Id, Token)), Attempt(() => accounts.SetDisabledAsync(kim.Id, true, Token)));

        Assert.Equal(1, both.Count(went => went));
        Assert.Single(store.ById.Values, each => each.Role == Role.SuperAdmin && !each.Disabled);
    }

    private static async Task<bool> Attempt(Func<Task<Account>> change)
    {
        try
        {
            await change();
            return true;
        }
        catch (LastSuperAdminException)
        {
            return false;
        }
    }

    [Fact]
    public async Task An_admin_reset_password_must_be_changed()
    {
        var sam = await accounts.CreateUserAsync("sam", "correct horse battery", mustChangePassword: false, cancellation: Token);
        var given = await accounts.SetPasswordAsync(sam.Id, "a typed new password", Token);
        Assert.Equal("a typed new password", given);
        var login = Assert.IsType<LoginResult.Success>(await accounts.LoginAsync("sam", given, Token));
        Assert.True(login.Account.MustChangePassword);
        Assert.Equal(20, (await accounts.SetPasswordAsync(sam.Id, null, Token)).Length);
        await Assert.ThrowsAsync<ArgumentException>(() => accounts.SetPasswordAsync(sam.Id, "short", Token));
    }
}

public sealed class IdsTests
{
    [Fact]
    public void Ulids_sort_by_time_and_use_crockford_base32()
    {
        var early = Ids.NewUlid(new TestClock(new DateTimeOffset(2026, 10, 21, 12, 0, 0, TimeSpan.Zero)));
        var late = Ids.NewUlid(new TestClock(new DateTimeOffset(2026, 10, 21, 12, 0, 1, TimeSpan.Zero)));
        Assert.Matches("^[0-9A-HJKMNP-TV-Z]{26}$", early);
        Assert.True(string.CompareOrdinal(early, late) < 0);
        Assert.NotEqual(Ids.NewUlid(), Ids.NewUlid());
    }

    [Fact]
    public void Ulids_made_after_another_sort_after_it_even_in_the_same_millisecond()
    {
        var clock = new TestClock(new DateTimeOffset(2026, 10, 21, 12, 0, 0, TimeSpan.Zero));
        string? last = null;
        for (var each = 0; each < 1000; each++)
        {
            var next = Ids.NewUlidAfter(last, clock);
            Assert.True(last is null || string.CompareOrdinal(last, next) < 0, $"{next} after {last}");
            last = next;
        }
        // The next one up carries like any number.
        var time = Ids.NewUlid(clock)[..10];
        Assert.Equal(time + "ZZZZZZZZZZZZZZZ0", Ids.NewUlidAfter(time + "ZZZZZZZZZZZZZZYZ", clock));
    }
}
