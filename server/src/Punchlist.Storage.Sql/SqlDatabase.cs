using System.Data.Common;
using Dapper;
using Punchlist.Core.Storage;

namespace Punchlist.Storage.Sql;

/// <summary>
/// One SQL database and how to talk to it. The stores (entities, accounts, groups, secrets) share it;
/// a dialect supplies connections, the write lock and how JSON goes in and out.
/// </summary>
public abstract class SqlDatabase : IDatabase
{
    public abstract Task<DbConnection> OpenAsync(CancellationToken cancellation);

    /// <summary>Begin a transaction that holds the database's single write lock until it ends.</summary>
    public abstract Task<DbTransaction> BeginWriteAsync(DbConnection connection, CancellationToken cancellation);

    /// <summary>The SQL expression for the JSON parameter <c>@doc</c> (a cast on databases with a JSON type).</summary>
    public virtual string DocParameter => "@doc";

    /// <summary>The SQL expression that reads the <c>doc</c> column back as text.</summary>
    public virtual string DocColumn => "doc";

    /// <summary>The condition matching <c>id</c> against the list parameter <c>@ids</c>.</summary>
    public virtual string IdInList => "id IN @ids";

    /// <summary>A top-level field of <c>doc</c> as text (null when missing or JSON null).</summary>
    public virtual string JsonText(string field) => $"CAST(json_extract(doc, '$.{field}') AS TEXT)";

    /// <summary>LIKE that ignores case (SQLite's does already).</summary>
    public virtual string CaseInsensitiveLike => "LIKE";

    /// <summary>The larger of two values.</summary>
    public virtual string Greatest(string a, string b) => $"MAX({a}, {b})";

    /// <summary>Runs the dialect's embedded migrations (its own assembly's <c>Migrations/*.sql</c>).</summary>
    public async Task MigrateAsync(CancellationToken cancellation = default)
    {
        await using var connection = await OpenAsync(cancellation);
        await SqlMigrations.RunAsync(connection, GetType().Assembly, cancellation);
    }

    public async Task<bool> IsEmptyAsync(CancellationToken cancellation = default)
    {
        await using var connection = await OpenAsync(cancellation);
        var rows = await connection.ExecuteScalarAsync<long>(new CommandDefinition(
            "SELECT (SELECT COUNT(*) FROM entities) + (SELECT COUNT(*) FROM accounts) + (SELECT COUNT(*) FROM server_secrets) + (SELECT COUNT(*) FROM server_groups) + (SELECT COUNT(*) FROM identities)",
            cancellationToken: cancellation));
        return rows == 0;
    }

    public async Task<IReadOnlyDictionary<string, long>> CountRowsAsync(CancellationToken cancellation = default)
    {
        await using var connection = await OpenAsync(cancellation);
        var counts = new SortedDictionary<string, long>(StringComparer.Ordinal);
        foreach (var table in new[] { "accounts", "identities", "pending_signins", "server_groups", "server_group_members", "audit_entries" })
        {
            counts[table] = Convert.ToInt64(await connection.ExecuteScalarAsync(new CommandDefinition($"SELECT COUNT(*) FROM {table}", cancellationToken: cancellation)));
        }
        await using var reader = await connection.ExecuteReaderAsync(new CommandDefinition(
            "SELECT collection, deleted, COUNT(*) FROM entities GROUP BY collection, deleted", cancellationToken: cancellation));
        while (await reader.ReadAsync(cancellation))
        {
            var deleted = Convert.ToBoolean(reader.GetValue(1));
            counts[(deleted ? "deleted." : "entities.") + reader.GetString(0)] = Convert.ToInt64(reader.GetValue(2));
        }
        return counts;
    }

    public async Task WipeAsync(CancellationToken cancellation = default)
    {
        await using var connection = await OpenAsync(cancellation);
        await using var transaction = await BeginWriteAsync(connection, cancellation);
        foreach (var table in new[] { "visibility", "revocations", "entities", "server_group_members", "server_groups", "identities", "pending_signins", "accounts", "server_secrets" })
        {
            await connection.ExecuteAsync(new CommandDefinition($"DELETE FROM {table}", transaction: transaction, cancellationToken: cancellation));
        }
        await connection.ExecuteAsync(new CommandDefinition(
            "UPDATE counters SET value = 0 WHERE name = 'seq'", transaction: transaction, cancellationToken: cancellation));
        await transaction.CommitAsync(cancellation);
    }

    public async Task<bool> PingAsync(CancellationToken cancellation = default)
    {
        try
        {
            await using var connection = await OpenAsync(cancellation);
            return await connection.ExecuteScalarAsync<int>(new CommandDefinition("SELECT 1", cancellationToken: cancellation)) == 1;
        }
        catch (DbException)
        {
            return false;
        }
    }
}
