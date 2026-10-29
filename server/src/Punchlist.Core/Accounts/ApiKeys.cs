using System.Security.Cryptography;
using System.Text;

namespace Punchlist.Core.Accounts;

/// <summary>What an API key may do (R-FB-157). A key does nothing it was not given.</summary>
public static class ApiScopes
{
    /// <summary>Read tasks, lists, tags and the rest of the workspace (sync without changes, history, events).</summary>
    public const string TasksRead = "tasks:read";
    /// <summary>Push changes through sync (needs <see cref="TasksRead"/> too: a sync answers with what is new).</summary>
    public const string TasksWrite = "tasks:write";
    public const string FilesRead = "files:read";
    public const string FilesWrite = "files:write";
    /// <summary>List notifications, mark them read, clear them.</summary>
    public const string Notifications = "notifications";
    /// <summary>The admin API, as far as the owner's role allows.</summary>
    public const string Admin = "admin";

    public static readonly IReadOnlyList<string> All = [TasksRead, TasksWrite, FilesRead, FilesWrite, Notifications, Admin];
}

/// <summary>
/// A personal API key (R-FB-157): a name, what it may do, when it was made and when it stops
/// working (never, when null). Only a hash of its secret is kept; the secret is shown once.
/// </summary>
public sealed record ApiKey
{
    public required string Id { get; init; }
    public required string UserId { get; init; }
    public required string Name { get; init; }
    /// <summary>SHA-256 of the secret, lower-case hex.</summary>
    public required string SecretHash { get; init; }
    public required IReadOnlyList<string> Scopes { get; init; }
    public required DateTimeOffset CreatedAt { get; init; }
    public DateTimeOffset? ExpiresAt { get; init; }
    public DateTimeOffset? LastUsedAt { get; init; }
    public DateTimeOffset? RevokedAt { get; init; }

    public bool WorksAt(DateTimeOffset now) => RevokedAt is null && (ExpiresAt is null || ExpiresAt > now);
}

public interface IApiKeyStore
{
    Task AddAsync(ApiKey key, CancellationToken cancellation = default);

    Task<ApiKey?> FindAsync(string id, CancellationToken cancellation = default);

    /// <summary>A person's keys, newest first, revoked ones included.</summary>
    Task<IReadOnlyList<ApiKey>> ListAsync(string userId, CancellationToken cancellation = default);

    Task RevokeAsync(string id, DateTimeOffset at, CancellationToken cancellation = default);

    Task TouchAsync(string id, DateTimeOffset at, CancellationToken cancellation = default);

    /// <summary>An account goes: its keys go with it.</summary>
    Task DeleteForUserAsync(string userId, CancellationToken cancellation = default);
}

/// <summary>Why a key could not be made.</summary>
public sealed class ApiKeyRejected(string message) : Exception(message);

/// <summary>Making, checking and revoking API keys (R-FB-157). Tokens read <c>pl_&lt;id&gt;_&lt;secret&gt;</c>.</summary>
public sealed class ApiKeyService(IApiKeyStore keys, TimeProvider time)
{
    public const string Prefix = "pl_";
    public const int MaxNameLength = 80;
    /// <summary>A person keeps at most this many working keys.</summary>
    public const int MaxKeys = 50;

    /// <summary>A new key and its token (shown to the person once, never kept).</summary>
    public async Task<(ApiKey Key, string Token)> CreateAsync(
        string userId, Role role, string name, IReadOnlyList<string> scopes, DateTimeOffset? expiresAt, CancellationToken cancellation = default)
    {
        var trimmed = name.Trim();
        if (trimmed.Length is 0 or > MaxNameLength) throw new ApiKeyRejected($"a name of 1 to {MaxNameLength} characters");
        var wanted = scopes.Distinct().ToList();
        if (wanted.Count == 0) throw new ApiKeyRejected("at least one permission");
        if (wanted.FirstOrDefault(scope => !ApiScopes.All.Contains(scope)) is { } unknown) throw new ApiKeyRejected($"no such permission: {unknown}");
        if (wanted.Contains(ApiScopes.Admin) && role == Role.User)
            throw new ApiKeyRejected("only admins may give a key the admin permission");
        // Writing syncs, and a sync answers with what is new: writing needs reading.
        if (wanted.Contains(ApiScopes.TasksWrite) && !wanted.Contains(ApiScopes.TasksRead)) wanted.Add(ApiScopes.TasksRead);
        if (wanted.Contains(ApiScopes.FilesWrite) && !wanted.Contains(ApiScopes.FilesRead)) wanted.Add(ApiScopes.FilesRead);
        var now = time.GetUtcNow();
        if (expiresAt is { } expiry && expiry <= now) throw new ApiKeyRejected("an expiry date in the future");
        var working = (await keys.ListAsync(userId, cancellation)).Count(each => each.WorksAt(now));
        if (working >= MaxKeys) throw new ApiKeyRejected($"at most {MaxKeys} working keys");

        var id = Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(8));
        var secret = Base64Url(RandomNumberGenerator.GetBytes(32));
        var key = new ApiKey
        {
            Id = id,
            UserId = userId,
            Name = trimmed,
            SecretHash = Hash(secret),
            Scopes = [.. ApiScopes.All.Where(wanted.Contains)],
            CreatedAt = now,
            ExpiresAt = expiresAt,
        };
        await keys.AddAsync(key, cancellation);
        return (key, $"{Prefix}{id}_{secret}");
    }

    /// <summary>The working key a token names, or null (unknown, wrong secret, revoked or expired).</summary>
    public async Task<ApiKey?> CheckAsync(string token, CancellationToken cancellation = default)
    {
        if (!token.StartsWith(Prefix, StringComparison.Ordinal)) return null;
        var rest = token[Prefix.Length..];
        var cut = rest.IndexOf('_');
        if (cut <= 0 || cut == rest.Length - 1) return null;
        var key = await keys.FindAsync(rest[..cut], cancellation);
        if (key is null) return null;
        var given = Encoding.ASCII.GetBytes(Hash(rest[(cut + 1)..]));
        var kept = Encoding.ASCII.GetBytes(key.SecretHash);
        if (!CryptographicOperations.FixedTimeEquals(given, kept)) return null;
        return key.WorksAt(time.GetUtcNow()) ? key : null;
    }

    public Task<IReadOnlyList<ApiKey>> ListAsync(string userId, CancellationToken cancellation = default) => keys.ListAsync(userId, cancellation);

    /// <summary>Revoke one of a person's own keys; false when it is not theirs (or not there).</summary>
    public async Task<bool> RevokeAsync(string userId, string id, CancellationToken cancellation = default)
    {
        var key = await keys.FindAsync(id, cancellation);
        if (key is null || key.UserId != userId) return false;
        if (key.RevokedAt is null) await keys.RevokeAsync(id, time.GetUtcNow(), cancellation);
        return true;
    }

    public static string Hash(string secret) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(secret)));

    private static string Base64Url(byte[] bytes) => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}
