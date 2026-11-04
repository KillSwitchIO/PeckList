using Dapper;
using PeckList.Core.Accounts;

namespace PeckList.Storage.Sql;

/// <summary>Passkeys in <c>passkeys</c> (PL-123); times as Unix milliseconds, flags as 0/1.</summary>
public sealed class SqlPasskeyStore(SqlDatabase database) : IPasskeyStore
{
    private const string Columns =
        "id, account_id AS accountId, name, public_key AS publicKey, sign_count AS signCount, transports, " +
        "backed_up AS backedUp, created_at AS createdAt, last_used_at AS lastUsedAt";

    public async Task<IReadOnlyList<Passkey>> ListAsync(string accountId, CancellationToken cancellation = default)
    {
        await using var connection = await database.OpenAsync(cancellation);
        var rows = await connection.QueryAsync<Row>(new CommandDefinition(
            $"SELECT {Columns} FROM passkeys WHERE account_id = @accountId ORDER BY created_at, id",
            new { accountId }, cancellationToken: cancellation));
        return [.. rows.Select(row => row.ToPasskey())];
    }

    public async Task<IReadOnlyList<Passkey>> AllAsync(CancellationToken cancellation = default)
    {
        await using var connection = await database.OpenAsync(cancellation);
        var rows = await connection.QueryAsync<Row>(new CommandDefinition(
            $"SELECT {Columns} FROM passkeys ORDER BY created_at, id", cancellationToken: cancellation));
        return [.. rows.Select(row => row.ToPasskey())];
    }

    public async Task<Passkey?> FindAsync(string id, CancellationToken cancellation = default)
    {
        await using var connection = await database.OpenAsync(cancellation);
        var row = await connection.QueryFirstOrDefaultAsync<Row>(new CommandDefinition(
            $"SELECT {Columns} FROM passkeys WHERE id = @id", new { id }, cancellationToken: cancellation));
        return row?.ToPasskey();
    }

    public async Task AddAsync(Passkey passkey, CancellationToken cancellation = default)
    {
        try
        {
            await WriteAsync(
                """
                INSERT INTO passkeys (id, account_id, name, public_key, sign_count, transports, backed_up, created_at, last_used_at)
                VALUES (@Id, @AccountId, @Name, @PublicKey, @SignCount, @Transports, @BackedUp, @CreatedAt, @LastUsedAt)
                """,
                Row.From(passkey), cancellation);
        }
        catch (System.Data.Common.DbException error) when (SqlDatabase.IsUniqueViolation(error))
        {
            throw new InvalidOperationException($"passkey {passkey.Id} is already stored", error);
        }
    }

    public async Task<bool> UpdateAsync(Passkey passkey, CancellationToken cancellation = default) =>
        await WriteAsync(
            "UPDATE passkeys SET name = @Name, sign_count = @SignCount, backed_up = @BackedUp, last_used_at = @LastUsedAt WHERE id = @Id",
            Row.From(passkey), cancellation) > 0;

    public async Task<bool> DeleteAsync(string id, CancellationToken cancellation = default) =>
        await WriteAsync("DELETE FROM passkeys WHERE id = @id", new { id }, cancellation) > 0;

    public Task<int> DeleteAllAsync(string accountId, CancellationToken cancellation = default) =>
        WriteAsync("DELETE FROM passkeys WHERE account_id = @accountId", new { accountId }, cancellation);

    private async Task<int> WriteAsync(string sql, object values, CancellationToken cancellation)
    {
        await using var connection = await database.OpenAsync(cancellation);
        await using var transaction = await database.BeginWriteAsync(connection, cancellation);
        var changed = await connection.ExecuteAsync(new CommandDefinition(sql, values, transaction, cancellationToken: cancellation));
        await transaction.CommitAsync(cancellation);
        return changed;
    }

    /// <summary>The table's shape, the same on every database.</summary>
    private sealed class Row
    {
        public string Id { get; set; } = "";
        public string AccountId { get; set; } = "";
        public string Name { get; set; } = "";
        public string PublicKey { get; set; } = "";
        public long SignCount { get; set; }
        public string? Transports { get; set; }
        public long BackedUp { get; set; }
        public long CreatedAt { get; set; }
        public long? LastUsedAt { get; set; }

        public static Row From(Passkey passkey) => new()
        {
            Id = passkey.Id,
            AccountId = passkey.AccountId,
            Name = passkey.Name,
            PublicKey = passkey.PublicKey,
            SignCount = passkey.SignCount,
            Transports = passkey.Transports,
            BackedUp = passkey.BackedUp ? 1 : 0,
            CreatedAt = passkey.CreatedAt.ToUnixTimeMilliseconds(),
            LastUsedAt = passkey.LastUsedAt?.ToUnixTimeMilliseconds(),
        };

        public Passkey ToPasskey() => new()
        {
            Id = Id,
            AccountId = AccountId,
            Name = Name,
            PublicKey = PublicKey,
            SignCount = SignCount,
            Transports = Transports,
            BackedUp = BackedUp != 0,
            CreatedAt = DateTimeOffset.FromUnixTimeMilliseconds(CreatedAt),
            LastUsedAt = LastUsedAt is { } used ? DateTimeOffset.FromUnixTimeMilliseconds(used) : null,
        };
    }
}
