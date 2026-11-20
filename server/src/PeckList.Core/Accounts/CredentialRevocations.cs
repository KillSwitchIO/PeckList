namespace PeckList.Core.Accounts;

/// <summary>
/// An API key revoked or a passkey removed, kept for good (migration 0022). A whole-server restore
/// re-applies these, so a credential taken away (it leaked, the phone was lost) does not come back
/// with an older backup, even after the key's own row is pruned or the passkey's is gone.
/// </summary>
public sealed record CredentialRevocation(string Kind, string Id, string AccountId, DateTimeOffset RevokedAt)
{
    public const string ApiKey = "apiKey";
    public const string Passkey = "passkey";
}

/// <summary>
/// The kept revocations. The API key and passkey stores write them as they revoke or remove, in the
/// same transaction; this store reads them for backups, puts back a backup's, and forgets an
/// account's when it is removed for good.
/// </summary>
public interface ICredentialRevocationStore
{
    /// <summary>Every revocation, oldest first.</summary>
    Task<IReadOnlyList<CredentialRevocation>> AllAsync(CancellationToken cancellation = default);

    /// <summary>Records one; one already recorded for the same credential keeps its first time.</summary>
    Task AddAsync(CredentialRevocation revocation, CancellationToken cancellation = default);

    /// <summary>An account is removed for good: its revocations go with it.</summary>
    Task DeleteForAccountAsync(string accountId, CancellationToken cancellation = default);
}
