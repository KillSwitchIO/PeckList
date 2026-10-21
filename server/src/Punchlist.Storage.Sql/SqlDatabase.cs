using System.Data.Common;
using Dapper;
using Punchlist.Core.Storage;

namespace Punchlist.Storage.Sql;

/// <summary>
/// One SQL database and how to talk to it. The stores (entities, accounts, secrets) share it;
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

    /// <summary>Runs the dialect's embedded migrations (its own assembly's <c>Migrations/*.sql</c>).</summary>
    public async Task MigrateAsync(CancellationToken cancellation = default)
    {
        await using var connection = await OpenAsync(cancellation);
        await SqlMigrations.RunAsync(connection, GetType().Assembly, cancellation);
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
