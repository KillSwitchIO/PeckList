using System.Data.Common;
using Microsoft.Data.Sqlite;
using PeckList.Storage.Sql;

namespace PeckList.Storage.Sqlite;

/// <summary>
/// The default database: one SQLite file (<c>DB_PATH</c>). WAL lets readers continue while a sync
/// writes; writers queue on SQLite's single write lock.
/// </summary>
public sealed class SqliteDatabase : SqlDatabase
{
    private readonly string connectionString;

    public SqliteDatabase(string path)
    {
        var folder = Path.GetDirectoryName(Path.GetFullPath(path));
        if (folder is not null) Directory.CreateDirectory(folder);
        connectionString = new SqliteConnectionStringBuilder
        {
            DataSource = path,
            Mode = SqliteOpenMode.ReadWriteCreate,
            Pooling = true,
            DefaultTimeout = 30,
        }.ToString();
    }

    public override async Task<DbConnection> OpenAsync(CancellationToken cancellation)
    {
        var connection = new SqliteConnection(connectionString);
        await connection.OpenAsync(cancellation);
        await using var pragmas = connection.CreateCommand();
        // Wait for the write lock instead of failing at once; WAL survives in the file itself.
        pragmas.CommandText = "PRAGMA busy_timeout = 30000; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;";
        await pragmas.ExecuteNonQueryAsync(cancellation);
        return connection;
    }

    // Not deferred (BEGIN IMMEDIATE): take the write lock now, before reading what to merge with.
    public override Task<DbTransaction> BeginWriteAsync(DbConnection connection, CancellationToken cancellation) =>
        Task.FromResult<DbTransaction>(((SqliteConnection)connection).BeginTransaction(deferred: false));
}
