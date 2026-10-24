using System.Data.Common;
using Npgsql;
using Punchlist.Storage.Sql;

namespace Punchlist.Storage.Postgres;

/// <summary>
/// PostgreSQL 15+ (<c>DB_CONNECTION_STRING</c>). Documents are <c>jsonb</c>. Writers serialize on a
/// transaction-scoped advisory lock: a plain sequence can commit out of order, and a client whose
/// cursor passed a gap would never see the late change.
/// </summary>
public sealed class PostgresDatabase(string connectionString) : SqlDatabase, IAsyncDisposable
{
    /// <summary>Arbitrary, fixed key for the write lock ("PLST").</summary>
    private const long WriteLock = 0x504C5354;

    private readonly NpgsqlDataSource dataSource = NpgsqlDataSource.Create(WithDefaults(connectionString));

    /// <summary>
    /// Skip GSS (Kerberos) encryption unless the connection string asks for it: the image has no
    /// Kerberos library, and trying it logs a confusing error on every start.
    /// </summary>
    public static string WithDefaults(string connectionString)
    {
        var builder = new NpgsqlConnectionStringBuilder(connectionString);
        if (!connectionString.Contains("gss", StringComparison.OrdinalIgnoreCase))
        {
            builder.GssEncryptionMode = GssEncryptionMode.Disable;
        }
        return builder.ConnectionString;
    }

    public override string DocParameter => "CAST(@doc AS jsonb)";

    public override string DocColumn => "doc::text";

    // Npgsql sends a list as one array parameter.
    public override string IdInList => "id = ANY(@ids)";

    public override string Greatest(string a, string b) => $"GREATEST({a}, {b})";

    public override string CaseInsensitiveLike => "ILIKE";

    public override string JsonText(string field) => $"doc->>'{field}'";

    public override async Task<DbConnection> OpenAsync(CancellationToken cancellation) =>
        await dataSource.OpenConnectionAsync(cancellation);

    public override async Task<DbTransaction> BeginWriteAsync(DbConnection connection, CancellationToken cancellation)
    {
        var transaction = await connection.BeginTransactionAsync(cancellation);
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = $"SELECT pg_advisory_xact_lock({WriteLock})";
        await command.ExecuteNonQueryAsync(cancellation);
        return transaction;
    }

    public ValueTask DisposeAsync() => dataSource.DisposeAsync();
}
