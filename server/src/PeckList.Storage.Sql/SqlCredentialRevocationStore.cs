using Dapper;
using PeckList.Core.Accounts;

namespace PeckList.Storage.Sql;

/// <summary>Kept revocations in <c>credential_revocations</c> (0022); times as Unix milliseconds.</summary>
public sealed class SqlCredentialRevocationStore(SqlDatabase database) : ICredentialRevocationStore
{
    /// <summary>
    /// Records one credential's revocation from its own row, inside the caller's transaction: the
    /// API key and passkey stores run it as they revoke or remove. One already recorded keeps its time.
    /// </summary>
    internal const string RecordApiKey =
        "INSERT INTO credential_revocations (kind, id, account_id, revoked_at) " +
        "SELECT 'apiKey', id, user_id, @at FROM api_keys WHERE id = @id ON CONFLICT DO NOTHING";

    /// <inheritdoc cref="RecordApiKey"/>
    internal const string RecordPasskey =
        "INSERT INTO credential_revocations (kind, id, account_id, revoked_at) " +
        "SELECT 'passkey', id, account_id, @at FROM passkeys WHERE id = @id ON CONFLICT DO NOTHING";

    public async Task<IReadOnlyList<CredentialRevocation>> AllAsync(CancellationToken cancellation = default)
    {
        await using var connection = await database.OpenAsync(cancellation);
        var rows = await connection.QueryAsync<Row>(new CommandDefinition(
            "SELECT kind, id, account_id AS accountId, revoked_at AS revokedAt FROM credential_revocations ORDER BY revoked_at, kind, id",
            cancellationToken: cancellation));
        return [.. rows.Select(row => new CredentialRevocation(row.Kind, row.Id, row.AccountId, DateTimeOffset.FromUnixTimeMilliseconds(row.RevokedAt)))];
    }

    public Task AddAsync(CredentialRevocation revocation, CancellationToken cancellation = default) =>
        WriteAsync(
            "INSERT INTO credential_revocations (kind, id, account_id, revoked_at) VALUES (@kind, @id, @accountId, @at) ON CONFLICT DO NOTHING",
            new { kind = revocation.Kind, id = revocation.Id, accountId = revocation.AccountId, at = revocation.RevokedAt.ToUnixTimeMilliseconds() },
            cancellation);

    public Task DeleteForAccountAsync(string accountId, CancellationToken cancellation = default) =>
        WriteAsync("DELETE FROM credential_revocations WHERE account_id = @accountId", new { accountId }, cancellation);

    private async Task WriteAsync(string sql, object values, CancellationToken cancellation)
    {
        await using var connection = await database.OpenAsync(cancellation);
        await using var transaction = await database.BeginWriteAsync(connection, cancellation);
        await connection.ExecuteAsync(new CommandDefinition(sql, values, transaction, cancellationToken: cancellation));
        await transaction.CommitAsync(cancellation);
    }

    private sealed record Row
    {
        public string Kind { get; init; } = "";
        public string Id { get; init; } = "";
        public string AccountId { get; init; } = "";
        public long RevokedAt { get; init; }
    }
}
