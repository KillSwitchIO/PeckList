using PeckList.Core.Configuration;

namespace PeckList.Core.Accounts;

/// <summary>Hashes and checks passwords (the server uses ASP.NET Core Identity's PBKDF2 hasher).</summary>
public interface IPasswordHasher
{
    string Hash(string password);

    /// <summary>Whether <paramref name="password"/> matches; <paramref name="rehash"/> is set when the hash should be upgraded.</summary>
    bool Verify(string hash, string password, out bool rehash);
}

public abstract record LoginResult
{
    public sealed record Success(Account Account) : LoginResult;

    /// <summary>Unknown user or wrong password (never says which).</summary>
    public sealed record Invalid : LoginResult;

    public sealed record Locked(DateTimeOffset Until) : LoginResult;
}

public enum PasswordChange
{
    Changed,
    WrongPassword,
    TooShort,
    TooLong,
    Unchanged,

    /// <summary>A demo account's password is the one the banner shows (PL-117).</summary>
    DemoAccount,
}

/// <summary>Logins, lockout, password changes and the first admin (spec: Accounts &amp; Admin).</summary>
public sealed class AccountService(IAccountStore store, IPasswordHasher hasher, TimeProvider time)
{
    public const string AdminUsername = "admin";
    public const int MinPasswordLength = 12;

    /// <summary>The longest password anyone can set from now on.</summary>
    public const int MaxNewPasswordLength = 64;

    /// <summary>
    /// The longest password worth checking, so one set before <see cref="MaxNewPasswordLength"/> still
    /// signs in; beyond it, hashing is only work for someone else's benefit (audit S17).
    /// </summary>
    public const int MaxTriedPasswordLength = 256;
    public const int MaxFailedLogins = 5;
    public static readonly TimeSpan LockoutTime = TimeSpan.FromMinutes(15);

    /// <summary>Lowercase letters, digits, dots, dashes and underscores, up to 32, not starting or ending with a mark.</summary>
    public static bool IsValidUsername(string username) =>
        username.Length is > 0 and <= ExternalSignIn.MaxUsernameLength
        && ExternalSignIn.UsernameBase(new ExternalIdentity { Subject = "", Username = username }) == username;

    /// <summary>
    /// The pre-made accounts of a demo server (<c>DEMO_ACCOUNTS</c>): their passwords are public,
    /// so wrong guesses lock nobody out and nobody changes them.
    /// </summary>
    public IReadOnlySet<string> DemoUsernames { get; init; } = new HashSet<string>();

    private bool IsDemo(Account account) => DemoUsernames.Contains(account.Username.ToLowerInvariant());

    /// <summary>Verified against when the user does not exist, so timing does not reveal usernames.</summary>
    private readonly Lazy<string> decoy = new(() => hasher.Hash(Ids.NewPassword()));

    public async Task<LoginResult> LoginAsync(string username, string password, CancellationToken cancellation = default)
    {
        // Too long to check, or a username with a NUL, which none holds: never hashed, never looked up,
        // and the same answer whoever is named.
        if (password.Length > MaxTriedPasswordLength || username.Contains('\0')) return new LoginResult.Invalid();
        var account = await store.FindByUsernameAsync(username.Trim(), cancellation);
        if (account?.PasswordHash is null || account.Disabled)
        {
            hasher.Verify(decoy.Value, password, out _);
            return new LoginResult.Invalid();
        }
        var now = time.GetUtcNow();
        if (account.LockedUntil > now) return new LoginResult.Locked(account.LockedUntil.Value);

        if (!hasher.Verify(account.PasswordHash, password, out var rehash))
        {
            if (IsDemo(account)) return new LoginResult.Invalid();
            var failures = account.FailedLogins + 1;
            var locked = failures >= MaxFailedLogins;
            await store.UpdateAsync(account with
            {
                FailedLogins = locked ? 0 : failures,
                LockedUntil = locked ? now + LockoutTime : null,
            }, cancellation);
            return locked ? new LoginResult.Locked(now + LockoutTime) : new LoginResult.Invalid();
        }
        var updated = account with
        {
            FailedLogins = 0,
            LockedUntil = null,
            PasswordHash = rehash ? hasher.Hash(password) : account.PasswordHash,
        };
        if (updated != account) await store.UpdateAsync(updated, cancellation);
        return new LoginResult.Success(updated);
    }

    /// <summary>Change a password. Success gives a new security stamp, ending the account's other sessions.</summary>
    public async Task<(PasswordChange Result, Account? Account)> ChangePasswordAsync(
        string id, string current, string next, CancellationToken cancellation = default)
    {
        var account = await store.FindByIdAsync(id, cancellation) ?? throw new KeyNotFoundException($"no account {id}");
        if (IsDemo(account)) return (PasswordChange.DemoAccount, null);
        if (account.PasswordHash is null || current.Length > MaxTriedPasswordLength || !hasher.Verify(account.PasswordHash, current, out _))
        {
            return (PasswordChange.WrongPassword, null);
        }
        if (next.Length < MinPasswordLength) return (PasswordChange.TooShort, null);
        if (next.Length > MaxNewPasswordLength) return (PasswordChange.TooLong, null);
        if (next == current) return (PasswordChange.Unchanged, null);
        var updated = account with
        {
            PasswordHash = hasher.Hash(next),
            MustChangePassword = false,
            SecurityStamp = Ids.NewUlid(time),
        };
        await store.UpdateAsync(updated, cancellation);
        return (PasswordChange.Changed, updated);
    }

    /// <summary>
    /// Make sure the admin exists and can log in. Returns the password to show once when one was
    /// generated, else null. <paramref name="configuredPassword"/> (ADMIN_PASSWORD) is used instead
    /// of generating one, and needs no change on first login. With <paramref name="keepWithoutPassword"/>
    /// an admin that has no password stays that way: it has another way in, and doing without a password
    /// was its own choice.
    /// </summary>
    public async Task<string?> EnsureAdminAsync(string? configuredPassword, bool keepWithoutPassword, CancellationToken cancellation = default)
    {
        var password = keepWithoutPassword ? null : await EnsureAdminPasswordAsync(configuredPassword, cancellation);
        await EnsureSuperAdminAsync(cancellation);
        return password;
    }

    /// <inheritdoc cref="EnsureAdminAsync(string?, bool, CancellationToken)"/>
    public Task<string?> EnsureAdminAsync(string? configuredPassword, CancellationToken cancellation = default) =>
        EnsureAdminAsync(configuredPassword, keepWithoutPassword: false, cancellation);

    private async Task<string?> EnsureAdminPasswordAsync(string? configuredPassword, CancellationToken cancellation)
    {
        var admin = await store.FindByUsernameAsync(AdminUsername, cancellation);
        if (admin?.PasswordHash is not null) return null;
        // Removed on purpose: the name only comes back to rescue a server with no working super admin.
        if (admin is null && (await store.ListAsync(cancellation)).Any(IsActiveSuperAdmin)) return null;
        // Over the limit only stops a first start, with nothing to lose: a server in use would go down.
        // Past what can be checked, the account could never sign in, so it stops wherever it is used.
        if (configuredPassword?.Length > MaxTriedPasswordLength
            || (configuredPassword?.Length > MaxNewPasswordLength && admin is null && await store.CountAsync(cancellation) == 0))
        {
            throw new SettingsException($"ADMIN_PASSWORD must be {MinPasswordLength} to {MaxNewPasswordLength} characters");
        }
        var password = configuredPassword ?? Ids.NewPassword();
        if (admin is null)
        {
            await store.CreateAsync(NewAccount(AdminUsername, Role.SuperAdmin) with
            {
                PasswordHash = hasher.Hash(password),
                MustChangePassword = configuredPassword is null,
            }, cancellation);
        }
        else
        {
            // No way in at all, as when made while AUTH_MODE was none: give it a password now.
            await store.UpdateAsync(admin with
            {
                PasswordHash = hasher.Hash(password),
                MustChangePassword = configuredPassword is null,
                SecurityStamp = Ids.NewUlid(time),
            }, cancellation);
        }
        return configuredPassword is null ? password : null;
    }

    /// <summary>A deleted account in its grace period is disabled, so it does not count.</summary>
    private static bool IsActiveSuperAdmin(Account account) => account.Role == Role.SuperAdmin && !account.Disabled;

    /// <summary>The one account used when AUTH_MODE is none: the admin, made without a password if missing.</summary>
    public async Task<Account> EnsureOwnerAsync(CancellationToken cancellation = default)
    {
        var admin = await store.FindByUsernameAsync(AdminUsername, cancellation);
        if (admin is null) await store.CreateAsync(NewAccount(AdminUsername, Role.SuperAdmin), cancellation);
        await EnsureSuperAdminAsync(cancellation);
        return (await store.FindByUsernameAsync(AdminUsername, cancellation))!;
    }

    /// <summary>
    /// There is always an active super admin. Servers from before roles had only admins: the
    /// bootstrap admin (else the oldest admin) is promoted.
    /// </summary>
    public async Task EnsureSuperAdminAsync(CancellationToken cancellation = default)
    {
        var all = await store.ListAsync(cancellation);
        if (all.Any(IsActiveSuperAdmin)) return;
        var pick = all.FirstOrDefault(account => account.Username == AdminUsername && !account.Disabled)
            ?? all.FirstOrDefault(account => account.Role == Role.Admin && !account.Disabled);
        if (pick is not null) await store.UpdateAsync(pick with { Role = Role.SuperAdmin }, cancellation);
    }

    /// <summary>
    /// Turn an account off or back on. Off: no sign-in by any means, and its sessions end; its data,
    /// shares and assignments stay.
    /// </summary>
    /// <exception cref="LastSuperAdminException">It is the last active super admin.</exception>
    public async Task<Account> SetDisabledAsync(string id, bool disabled, CancellationToken cancellation = default)
    {
        var account = await store.FindByIdAsync(id, cancellation) ?? throw new KeyNotFoundException($"no account {id}");
        if (account.Disabled == disabled) return account;
        if (disabled) await EnsureNotLastSuperAdminAsync(account, cancellation);
        var updated = account with
        {
            Disabled = disabled,
            SecurityStamp = disabled ? Ids.NewUlid(time) : account.SecurityStamp,
            FailedLogins = 0,
            LockedUntil = null,
        };
        await store.UpdateAsync(updated, cancellation);
        return updated;
    }

    /// <summary>
    /// Delete an account (spec: Users, delete with grace period and restore): it is turned off at
    /// once, its sessions end, and it is removed for good when the grace period is over.
    /// </summary>
    /// <exception cref="LastSuperAdminException">It is the last active super admin.</exception>
    public async Task<Account> DeleteAsync(string id, CancellationToken cancellation = default)
    {
        var account = await store.FindByIdAsync(id, cancellation) ?? throw new KeyNotFoundException($"no account {id}");
        if (account.DeletedAt is not null) return account;
        await EnsureNotLastSuperAdminAsync(account, cancellation);
        var updated = account with
        {
            DeletedAt = time.GetUtcNow(),
            Disabled = true,
            SecurityStamp = Ids.NewUlid(time),
        };
        await store.UpdateAsync(updated, cancellation);
        return updated;
    }

    /// <summary>Take back a deletion within the grace period: the account works again.</summary>
    public async Task<Account> RestoreAsync(string id, CancellationToken cancellation = default)
    {
        var account = await store.FindByIdAsync(id, cancellation) ?? throw new KeyNotFoundException($"no account {id}");
        if (account.DeletedAt is null) return account;
        var updated = account with { DeletedAt = null, Disabled = false, FailedLogins = 0, LockedUntil = null };
        await store.UpdateAsync(updated, cancellation);
        return updated;
    }

    /// <summary>
    /// Give an account a role. Sessions continue; the new role applies from the next request.
    /// </summary>
    /// <exception cref="LastSuperAdminException">It is the last active super admin and would lose the role.</exception>
    public async Task<Account> SetRoleAsync(string id, Role role, CancellationToken cancellation = default)
    {
        var account = await store.FindByIdAsync(id, cancellation) ?? throw new KeyNotFoundException($"no account {id}");
        if (account.Role == role) return account;
        await EnsureNotLastSuperAdminAsync(account, cancellation);
        var updated = account with { Role = role };
        await store.UpdateAsync(updated, cancellation);
        return updated;
    }

    /// <summary>The server needs one active super admin: refuse to turn off, delete or demote the last.</summary>
    /// <exception cref="LastSuperAdminException">It is the last active super admin.</exception>
    private async Task EnsureNotLastSuperAdminAsync(Account account, CancellationToken cancellation)
    {
        if (account.Role != Role.SuperAdmin || account.Disabled) return;
        var others = (await store.ListAsync(cancellation))
            .Count(each => each.Id != account.Id && each.Role == Role.SuperAdmin && !each.Disabled);
        if (others == 0) throw new LastSuperAdminException();
    }

    /// <summary>
    /// The account's friend code, made on first use: 8 characters without look-alikes, shown as
    /// <c>7QM4-K2XP</c>. <paramref name="rotate"/> replaces it, so old links stop working.
    /// </summary>
    public async Task<string> FriendCodeAsync(string id, bool rotate = false, CancellationToken cancellation = default)
    {
        var account = await store.FindByIdAsync(id, cancellation) ?? throw new KeyNotFoundException($"no account {id}");
        if (account.FriendCode is not null && !rotate) return account.FriendCode;
        const string alphabet = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
        for (var attempt = 0; ; attempt++)
        {
            var code = System.Security.Cryptography.RandomNumberGenerator.GetString(alphabet, 8);
            if (await store.FindByFriendCodeAsync(code, cancellation) is not null && attempt < 10) continue;
            await store.UpdateAsync(account with { FriendCode = code }, cancellation);
            return code;
        }
    }

    /// <summary>The account behind a friend code as typed or linked (any case, with or without the dash).</summary>
    public Task<Account?> FindByFriendCodeAsync(string code, CancellationToken cancellation = default) =>
        store.FindByFriendCodeAsync(code.Replace("-", "", StringComparison.Ordinal).Trim().ToUpperInvariant(), cancellation);

    /// <summary>A new account that logs in with <paramref name=password/> (admin UI, tests).</summary>
    /// <exception cref="DuplicateUsernameException">The username is taken.</exception>
    public async Task<Account> CreateUserAsync(
        string username, string password, Role role = Role.User, bool mustChangePassword = true, CancellationToken cancellation = default)
    {
        CheckLength(password);
        var account = NewAccount(username.Trim(), role) with
        {
            PasswordHash = hasher.Hash(password),
            MustChangePassword = mustChangePassword,
        };
        await store.CreateAsync(account, cancellation);
        return account with { Username = account.Username.ToLowerInvariant() };
    }

    /// <summary>
    /// A demo account as <c>DEMO_ACCOUNTS</c> has it: there, a plain user, enabled, signing in with
    /// <paramref name="password"/> and no change asked for. True when it had to be made.
    /// </summary>
    public async Task<bool> EnsureDemoAccountAsync(string username, string password, CancellationToken cancellation = default)
    {
        var account = await store.FindByUsernameAsync(username, cancellation);
        if (account is null)
        {
            // Not held to the limit for new passwords: it is the server's own setting, and nobody picks or changes it.
            await store.CreateAsync(NewAccount(username.Trim(), Role.User) with { PasswordHash = hasher.Hash(password), MustChangePassword = false }, cancellation);
            return true;
        }
        var samePassword = account.PasswordHash is not null && hasher.Verify(account.PasswordHash, password, out _);
        var updated = account with
        {
            PasswordHash = samePassword ? account.PasswordHash : hasher.Hash(password),
            Role = Role.User,
            MustChangePassword = false,
            Disabled = false,
            DeletedAt = null,
            FailedLogins = 0,
            LockedUntil = null,
            SecurityStamp = samePassword && account.Role == Role.User ? account.SecurityStamp : Ids.NewUlid(time),
        };
        if (updated != account) await store.UpdateAsync(updated, cancellation);
        return false;
    }

    private static void CheckLength(string password)
    {
        if (password.Length is < MinPasswordLength or > MaxNewPasswordLength)
        {
            throw new ArgumentException($"passwords need {MinPasswordLength} to {MaxNewPasswordLength} characters");
        }
    }

    /// <summary>An account that signs in through an identity provider only.</summary>
    /// <exception cref="DuplicateUsernameException">The username is taken.</exception>
    public async Task<Account> CreateWithoutPasswordAsync(string username, CancellationToken cancellation = default)
    {
        var account = NewAccount(username.Trim().ToLowerInvariant(), Role.User);
        await store.CreateAsync(account, cancellation);
        return account;
    }

    /// <summary>Give an account a new generated password it must change on login (CLI: admin reset-password).</summary>
    public async Task<string> ResetPasswordAsync(string username, CancellationToken cancellation = default)
    {
        var account = await store.FindByUsernameAsync(username, cancellation) ?? throw new KeyNotFoundException($"no user '{username}'");
        return await SetPasswordAsync(account.Id, null, cancellation);
    }

    /// <summary>
    /// An admin sets a password (or has one generated) that must be changed at the next sign-in. The
    /// account is unlocked and its sessions end. Returns the password, to show once.
    /// </summary>
    /// <exception cref="ArgumentException">A typed password is too short or too long.</exception>
    public async Task<string> SetPasswordAsync(string id, string? password, CancellationToken cancellation = default)
    {
        if (password is not null) CheckLength(password);
        var account = await store.FindByIdAsync(id, cancellation) ?? throw new KeyNotFoundException($"no account {id}");
        password ??= Ids.NewPassword();
        await store.UpdateAsync(account with
        {
            PasswordHash = hasher.Hash(password),
            MustChangePassword = true,
            FailedLogins = 0,
            LockedUntil = null,
            SecurityStamp = Ids.NewUlid(time),
        }, cancellation);
        return password;
    }

    /// <summary>
    /// A person sets a new password without the old one, through a reset link (PL-122). The account
    /// is unlocked and every session ends.
    /// </summary>
    public async Task<(PasswordChange Result, Account? Account)> ResetOwnPasswordAsync(
        string id, string next, CancellationToken cancellation = default)
    {
        var account = await store.FindByIdAsync(id, cancellation) ?? throw new KeyNotFoundException($"no account {id}");
        if (IsDemo(account)) return (PasswordChange.DemoAccount, null);
        if (next.Length < MinPasswordLength) return (PasswordChange.TooShort, null);
        if (next.Length > MaxNewPasswordLength) return (PasswordChange.TooLong, null);
        var updated = account with
        {
            PasswordHash = hasher.Hash(next),
            MustChangePassword = false,
            FailedLogins = 0,
            LockedUntil = null,
            SecurityStamp = Ids.NewUlid(time),
        };
        await store.UpdateAsync(updated, cancellation);
        return (PasswordChange.Changed, updated);
    }

    /// <summary>
    /// Do without a password (PL-123), confirmed with the current one; the caller has made sure
    /// another way in remains. Other password sessions end.
    /// </summary>
    public async Task<(PasswordChange Result, Account? Account)> RemovePasswordAsync(
        string id, string current, CancellationToken cancellation = default)
    {
        var account = await store.FindByIdAsync(id, cancellation) ?? throw new KeyNotFoundException($"no account {id}");
        if (IsDemo(account)) return (PasswordChange.DemoAccount, null);
        if (account.PasswordHash is null || current.Length > MaxTriedPasswordLength || !hasher.Verify(account.PasswordHash, current, out _))
        {
            return (PasswordChange.WrongPassword, null);
        }
        var updated = account with { PasswordHash = null, MustChangePassword = false, SecurityStamp = Ids.NewUlid(time) };
        await store.UpdateAsync(updated, cancellation);
        return (PasswordChange.Changed, updated);
    }

    private Account NewAccount(string username, Role role) => new()
    {
        Id = Ids.NewUlid(time),
        Username = username,
        Role = role,
        SecurityStamp = Ids.NewUlid(time),
        CreatedAt = time.GetUtcNow(),
    };
}
