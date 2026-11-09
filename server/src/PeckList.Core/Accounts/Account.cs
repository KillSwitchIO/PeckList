namespace PeckList.Core.Accounts;

/// <summary>Stored and sent lowercase (<c>superadmin</c>); see <see cref="Roles"/> for what each may do.</summary>
public enum Role
{
    User,
    Admin,
    SuperAdmin,
}

/// <summary>
/// A login. Lives outside the synced entities (it holds the password hash); its id is the user id
/// the user's entities carry.
/// </summary>
public sealed record Account
{
    public required string Id { get; init; }

    /// <summary>Lowercase; unique.</summary>
    public required string Username { get; init; }

    /// <summary>Null when the account cannot log in with a password (yet).</summary>
    public string? PasswordHash { get; init; }

    public Role Role { get; init; } = Role.User;
    public bool MustChangePassword { get; init; }
    public int FailedLogins { get; init; }
    public DateTimeOffset? LockedUntil { get; init; }

    /// <summary>Changes whenever sessions must end (password change, disable): old cookies stop working.</summary>
    public required string SecurityStamp { get; init; }

    public bool Disabled { get; init; }

    /// <summary>When an admin deleted it: turned off at once, removed for good after the grace period, restorable until then.</summary>
    public DateTimeOffset? DeletedAt { get; init; }
    public required DateTimeOffset CreatedAt { get; init; }

    /// <summary>The code in this account's friend link (<c>/f/7QM4K2XP</c>); null until first asked for.</summary>
    public string? FriendCode { get; init; }

    /// <summary>The person's email, lowercase; null when none (PL-122).</summary>
    public string? Email { get; init; }

    /// <summary>
    /// When <see cref="Email"/> was confirmed: a link in it opened, or an identity provider that
    /// vouches for it. Null until then; reset links only ever go to a confirmed email.
    /// </summary>
    public DateTimeOffset? EmailVerifiedAt { get; init; }

    /// <summary>The email, when it is confirmed.</summary>
    public string? VerifiedEmail => EmailVerifiedAt is null ? null : Email;
}

/// <summary>Logins (never synced). Every adapter passes the same contract suite.</summary>
public interface IAccountStore
{
    Task<int> CountAsync(CancellationToken cancellation = default);

    /// <summary>Every account, oldest first.</summary>
    Task<IReadOnlyList<Account>> ListAsync(CancellationToken cancellation = default);

    Task<Account?> FindByIdAsync(string id, CancellationToken cancellation = default);

    /// <summary>Case-insensitive.</summary>
    Task<Account?> FindByUsernameAsync(string username, CancellationToken cancellation = default);

    Task<Account?> FindByFriendCodeAsync(string code, CancellationToken cancellation = default);

    /// <summary>Accounts with this email, confirmed or not (case-insensitive); oldest first.</summary>
    async Task<IReadOnlyList<Account>> FindByEmailAsync(string email, CancellationToken cancellation = default)
    {
        var wanted = email.Trim().ToLowerInvariant();
        return (await ListAsync(cancellation)).Where(account => account.Email == wanted).ToList();
    }

    /// <exception cref="DuplicateUsernameException">The username is taken.</exception>
    Task CreateAsync(Account account, CancellationToken cancellation = default);

    /// <summary>Replace the stored account with this one (same id).</summary>
    Task UpdateAsync(Account account, CancellationToken cancellation = default);

    /// <summary>Remove the account row for good (after its grace period); false when it was not there.</summary>
    Task<bool> DeleteAsync(string id, CancellationToken cancellation = default);
}

public sealed class DuplicateUsernameException(string username) : Exception($"username '{username}' is taken");

/// <summary>Small named values the server keeps for itself, e.g. the keys that sign login cookies.</summary>
public interface ISecretStore
{
    Task<IReadOnlyList<(string Name, string Value)>> ListAsync(string kind, CancellationToken cancellation = default);

    /// <summary>Every value of every kind.</summary>
    Task<IReadOnlyList<(string Kind, string Name, string Value)>> AllAsync(CancellationToken cancellation = default);

    /// <summary>Add or replace a value.</summary>
    Task PutAsync(string kind, string name, string value, CancellationToken cancellation = default);

    /// <summary>One value by its kind and name (the table's key, so no list is read), or null.</summary>
    Task<string?> GetAsync(string kind, string name, CancellationToken cancellation = default);

    /// <summary>
    /// Remove a value and return it, in one step: of two callers at once, only one gets it. Null when
    /// there was none. For one-time tokens, so a used one leaves nothing behind (audit S14).
    /// </summary>
    Task<string?> TakeAsync(string kind, string name, CancellationToken cancellation = default);

    /// <summary>Remove a value; nothing happens when there is none.</summary>
    Task DeleteAsync(string kind, string name, CancellationToken cancellation = default);
}
