namespace Punchlist.Core.Accounts;

public enum Role
{
    User,
    Admin,
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
    public required DateTimeOffset CreatedAt { get; init; }

    /// <summary>The code in this account's friend link (<c>/f/7QM4K2XP</c>); null until first asked for.</summary>
    public string? FriendCode { get; init; }
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

    /// <exception cref="DuplicateUsernameException">The username is taken.</exception>
    Task CreateAsync(Account account, CancellationToken cancellation = default);

    /// <summary>Replace the stored account with this one (same id).</summary>
    Task UpdateAsync(Account account, CancellationToken cancellation = default);
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
}
