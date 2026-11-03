namespace PeckList.Core.Accounts;

/// <summary>
/// An identity provider's account linked to one of ours (spec: Accounts &amp; Admin, Linking). The
/// provider's subject never changes for a person, unlike usernames and emails.
/// </summary>
public sealed record LinkedIdentity
{
    public required string Provider { get; init; }
    public required string Subject { get; init; }
    public required string AccountId { get; init; }

    /// <summary>As the provider last sent it, for admins telling identities apart.</summary>
    public string? Email { get; init; }

    /// <summary>The provider's username claim at the last sign-in (null for links made before it was kept).</summary>
    public string? Username { get; init; }

    public required DateTimeOffset LinkedAt { get; init; }
    public required DateTimeOffset LastUsedAt { get; init; }
}

/// <summary>Someone the provider let in who has no account yet, waiting for an admin (auto-create off).</summary>
public sealed record PendingSignIn
{
    public required string Provider { get; init; }
    public required string Subject { get; init; }
    public required string Username { get; init; }
    public string? DisplayName { get; init; }
    public string? Email { get; init; }
    public IReadOnlyList<string> Groups { get; init; } = [];
    public required DateTimeOffset FirstSeen { get; init; }
    public required DateTimeOffset LastSeen { get; init; }

    public bool Equals(PendingSignIn? other) =>
        other is not null && Provider == other.Provider && Subject == other.Subject && Username == other.Username
        && DisplayName == other.DisplayName && Email == other.Email && Groups.SequenceEqual(other.Groups)
        && FirstSeen == other.FirstSeen && LastSeen == other.LastSeen;

    public override int GetHashCode() => HashCode.Combine(Provider, Subject);
}

/// <summary>
/// An admin's mapping: whoever signs in through <see cref="Provider"/> with this username lands in
/// <see cref="AccountId"/>, even when linked elsewhere (spec: Accounts &amp; Admin, Linking).
/// </summary>
public sealed record IdentityMapping
{
    public required string Provider { get; init; }

    /// <summary>Lowercase; matched without regard to case.</summary>
    public required string ProviderUsername { get; init; }

    public required string AccountId { get; init; }
    public required DateTimeOffset CreatedAt { get; init; }
}

/// <summary>Linked identities and pending sign-ins (never synced). Every adapter passes the same contract suite.</summary>
public interface IIdentityStore
{
    Task<LinkedIdentity?> FindAsync(string provider, string subject, CancellationToken cancellation = default);

    /// <summary>Every link, by provider then subject (backups, admin lists).</summary>
    Task<IReadOnlyList<LinkedIdentity>> ListAsync(CancellationToken cancellation = default);

    /// <exception cref="IdentityTakenException">That provider subject is linked already.</exception>
    Task LinkAsync(LinkedIdentity identity, CancellationToken cancellation = default);

    /// <summary>Replace a link's account, email, username and last use (same provider and subject).</summary>
    Task UpdateAsync(LinkedIdentity identity, CancellationToken cancellation = default);

    /// <summary>False when there was no such link.</summary>
    Task<bool> UnlinkAsync(string provider, string subject, CancellationToken cancellation = default);

    /// <summary>Unbind every identity of one provider; returns how many.</summary>
    Task<int> UnlinkProviderAsync(string provider, CancellationToken cancellation = default);

    /// <summary>Oldest first.</summary>
    Task<IReadOnlyList<PendingSignIn>> ListPendingAsync(CancellationToken cancellation = default);

    /// <summary>Add or replace (same provider and subject).</summary>
    Task PutPendingAsync(PendingSignIn pending, CancellationToken cancellation = default);

    Task<bool> RemovePendingAsync(string provider, string subject, CancellationToken cancellation = default);

    /// <summary>By provider then username.</summary>
    Task<IReadOnlyList<IdentityMapping>> ListMappingsAsync(CancellationToken cancellation = default);

    /// <summary>Add or replace (same provider and username, ignoring case; stored lowercase).</summary>
    Task PutMappingAsync(IdentityMapping mapping, CancellationToken cancellation = default);

    Task<bool> RemoveMappingAsync(string provider, string providerUsername, CancellationToken cancellation = default);
}

public sealed class IdentityTakenException(string provider, string subject)
    : Exception($"that {provider} account ({subject}) is linked to another user");
