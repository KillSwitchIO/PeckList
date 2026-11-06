using Dapper;
using PeckList.Core.Accounts;

namespace PeckList.Storage.Sql;

/// <summary>API keys in <c>api_keys</c> (R-FB-157); times as Unix milliseconds, scopes space-separated.</summary>
public sealed class SqlApiKeyStore(SqlDatabase database) : IApiKeyStore
{
    private const string Columns =
        "id, user_id AS userId, name, secret_hash AS secretHash, scopes, created_at AS createdAt, " +
        "expires_at AS expiresAt, last_used_at AS lastUsedAt, revoked_at AS revokedAt";

    public async Task AddAsync(ApiKey key, CancellationToken cancellation = default)
    {
        await using var connection = await database.OpenAsync(cancellation);
        await using var transaction = await database.BeginWriteAsync(connection, cancellation);
        await connection.ExecuteAsync(new CommandDefinition(
            """
            INSERT INTO api_keys (id, user_id, name, secret_hash, scopes, created_at, expires_at, last_used_at, revoked_at)
            VALUES (@Id, @UserId, @Name, @SecretHash, @Scopes, @CreatedAt, @ExpiresAt, @LastUsedAt, @RevokedAt)
            """,
            Row.From(key), transaction, cancellationToken: cancellation));
        await transaction.CommitAsync(cancellation);
    }

    public async Task<ApiKey?> FindAsync(string id, CancellationToken cancellation = default)
    {
        await using var connection = await database.OpenAsync(cancellation);
        var row = await connection.QueryFirstOrDefaultAsync<Row>(new CommandDefinition(
            $"SELECT {Columns} FROM api_keys WHERE id = @id", new { id }, cancellationToken: cancellation));
        return row?.ToKey();
    }

    public async Task<IReadOnlyList<ApiKey>> ListAsync(string userId, CancellationToken cancellation = default)
    {
        await using var connection = await database.OpenAsync(cancellation);
        var rows = await connection.QueryAsync<Row>(new CommandDefinition(
            $"SELECT {Columns} FROM api_keys WHERE user_id = @userId ORDER BY created_at DESC, id DESC",
            new { userId }, cancellationToken: cancellation));
        return [.. rows.Select(row => row.ToKey())];
    }

    public Task RevokeAsync(string id, DateTimeOffset at, CancellationToken cancellation = default) =>
        WriteAsync("UPDATE api_keys SET revoked_at = @at WHERE id = @id AND revoked_at IS NULL",
            new { id, at = at.ToUnixTimeMilliseconds() }, cancellation);

    public Task TouchAsync(string id, DateTimeOffset at, CancellationToken cancellation = default) =>
        WriteAsync("UPDATE api_keys SET last_used_at = @at WHERE id = @id",
            new { id, at = at.ToUnixTimeMilliseconds() }, cancellation);

    public async Task<int> PruneRevokedAsync(DateTimeOffset before, CancellationToken cancellation = default)
    {
        await using var connection = await database.OpenAsync(cancellation);
        await using var transaction = await database.BeginWriteAsync(connection, cancellation);
        var gone = await connection.ExecuteAsync(new CommandDefinition(
            "DELETE FROM api_keys WHERE revoked_at IS NOT NULL AND revoked_at < @before",
            new { before = before.ToUnixTimeMilliseconds() }, transaction, cancellationToken: cancellation));
        await transaction.CommitAsync(cancellation);
        return gone;
    }

    public Task DeleteForUserAsync(string userId, CancellationToken cancellation = default) =>
        WriteAsync("DELETE FROM api_keys WHERE user_id = @userId", new { userId }, cancellation);

    private async Task WriteAsync(string sql, object values, CancellationToken cancellation)
    {
        await using var connection = await database.OpenAsync(cancellation);
        await using var transaction = await database.BeginWriteAsync(connection, cancellation);
        await connection.ExecuteAsync(new CommandDefinition(sql, values, transaction, cancellationToken: cancellation));
        await transaction.CommitAsync(cancellation);
    }

    private sealed record Row
    {
        public string Id { get; init; } = "";
        public string UserId { get; init; } = "";
        public string Name { get; init; } = "";
        public string SecretHash { get; init; } = "";
        public string Scopes { get; init; } = "";
        public long CreatedAt { get; init; }
        public long? ExpiresAt { get; init; }
        public long? LastUsedAt { get; init; }
        public long? RevokedAt { get; init; }

        public static Row From(ApiKey key) => new()
        {
            Id = key.Id,
            UserId = key.UserId,
            Name = key.Name,
            SecretHash = key.SecretHash,
            Scopes = string.Join(' ', key.Scopes),
            CreatedAt = key.CreatedAt.ToUnixTimeMilliseconds(),
            ExpiresAt = key.ExpiresAt?.ToUnixTimeMilliseconds(),
            LastUsedAt = key.LastUsedAt?.ToUnixTimeMilliseconds(),
            RevokedAt = key.RevokedAt?.ToUnixTimeMilliseconds(),
        };

        public ApiKey ToKey() => new()
        {
            Id = Id,
            UserId = UserId,
            Name = Name,
            SecretHash = SecretHash,
            Scopes = Scopes.Split(' ', StringSplitOptions.RemoveEmptyEntries),
            CreatedAt = DateTimeOffset.FromUnixTimeMilliseconds(CreatedAt),
            ExpiresAt = ExpiresAt is { } expires ? DateTimeOffset.FromUnixTimeMilliseconds(expires) : null,
            LastUsedAt = LastUsedAt is { } used ? DateTimeOffset.FromUnixTimeMilliseconds(used) : null,
            RevokedAt = RevokedAt is { } revoked ? DateTimeOffset.FromUnixTimeMilliseconds(revoked) : null,
        };
    }
}
