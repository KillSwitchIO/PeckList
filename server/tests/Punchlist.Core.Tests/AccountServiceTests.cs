using Punchlist.Core.Accounts;

namespace Punchlist.Core.Tests;

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

    public Task<Account?> FindByIdAsync(string id, CancellationToken cancellation = default) =>
        Task.FromResult(ById.GetValueOrDefault(id));

    public Task<Account?> FindByUsernameAsync(string username, CancellationToken cancellation = default) =>
        Task.FromResult(ById.Values.FirstOrDefault(each => each.Username == username.ToLowerInvariant()));

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
    public async Task First_start_makes_an_admin_with_a_generated_password_to_change()
    {
        var password = await accounts.EnsureAdminAsync(null, Token);
        Assert.NotNull(password);
        Assert.Equal(20, password.Length);
        Assert.Equal(Role.Admin, Admin.Role);
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
}
