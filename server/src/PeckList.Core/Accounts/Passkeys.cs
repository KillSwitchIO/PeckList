namespace PeckList.Core.Accounts;

/// <summary>
/// A passkey on an account (PL-123): a WebAuthn credential the person's device or password
/// manager holds. The server keeps only its public key and how often it was used.
/// </summary>
public sealed record Passkey
{
    /// <summary>The credential id, base64url: what the authenticator names it by.</summary>
    public required string Id { get; init; }

    public required string AccountId { get; init; }

    /// <summary>What the person calls it ("Pixel 9", "1Password").</summary>
    public required string Name { get; init; }

    /// <summary>The COSE public key, base64url.</summary>
    public required string PublicKey { get; init; }

    /// <summary>The authenticator's signature counter at the last use (0 for most synced passkeys).</summary>
    public long SignCount { get; init; }

    /// <summary>How the authenticator can be reached (<c>internal,hybrid</c>), as it said; null when it did not.</summary>
    public string? Transports { get; init; }

    /// <summary>Whether it is synced across the person's devices (a password manager, iCloud Keychain, Google Password Manager).</summary>
    public bool BackedUp { get; init; }

    public required DateTimeOffset CreatedAt { get; init; }
    public DateTimeOffset? LastUsedAt { get; init; }
}

/// <summary>Passkeys (never synced). Every adapter passes the same contract suite.</summary>
public interface IPasskeyStore
{
    /// <summary>An account's passkeys, oldest first.</summary>
    Task<IReadOnlyList<Passkey>> ListAsync(string accountId, CancellationToken cancellation = default);

    /// <summary>Every passkey on the server, for backups.</summary>
    Task<IReadOnlyList<Passkey>> AllAsync(CancellationToken cancellation = default);

    Task<Passkey?> FindAsync(string id, CancellationToken cancellation = default);

    /// <exception cref="InvalidOperationException">A passkey with this id is already stored.</exception>
    Task AddAsync(Passkey passkey, CancellationToken cancellation = default);

    /// <summary>Its name, counter and last use; false when it is gone.</summary>
    Task<bool> UpdateAsync(Passkey passkey, CancellationToken cancellation = default);

    Task<bool> DeleteAsync(string id, CancellationToken cancellation = default);

    /// <summary>Every passkey of an account (it was removed for good); how many went.</summary>
    Task<int> DeleteAllAsync(string accountId, CancellationToken cancellation = default);
}
