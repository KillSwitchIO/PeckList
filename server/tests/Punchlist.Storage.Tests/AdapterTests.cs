using Punchlist.Core.Accounts;
using Punchlist.Core.Storage;
using Punchlist.Storage.Postgres;
using Punchlist.Storage.Sql;
using Punchlist.Storage.Sqlite;
using Testcontainers.PostgreSql;

namespace Punchlist.Storage.Tests;

/// <summary>Fresh SQLite databases in a temp folder, deleted afterwards.</summary>
public sealed class SqliteFiles : IDisposable
{
    private readonly string folder = Directory.CreateTempSubdirectory("punchlist-sqlite-").FullName;

    public async Task<SqlDatabase> NewDatabaseAsync()
    {
        var database = new SqliteDatabase(Path.Combine(folder, "nested", $"{Guid.NewGuid():N}.db"));
        await database.MigrateAsync(TestContext.Current.CancellationToken);
        return database;
    }

    public void Dispose()
    {
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        Directory.Delete(folder, recursive: true);
    }
}

/// <summary>One PostgreSQL container for the whole run (Testcontainers; needs Docker).</summary>
public sealed class PostgresServer : IAsyncLifetime
{
    private readonly PostgreSqlContainer container = new PostgreSqlBuilder("postgres:15-alpine").Build();
    private int databases;

    public async ValueTask InitializeAsync() => await container.StartAsync();

    public async ValueTask DisposeAsync() => await container.DisposeAsync();

    /// <summary>A new, empty, migrated database.</summary>
    public async Task<SqlDatabase> NewDatabaseAsync()
    {
        var name = $"test{Interlocked.Increment(ref databases)}";
        await container.ExecScriptAsync($"CREATE DATABASE {name}");
        var connection = new Npgsql.NpgsqlConnectionStringBuilder(container.GetConnectionString()) { Database = name }.ToString();
        var database = new PostgresDatabase(connection);
        await database.MigrateAsync(TestContext.Current.CancellationToken);
        return database;
    }
}

public sealed class SqliteEntityStoreTests(SqliteFiles files) : EntityStoreContract, IClassFixture<SqliteFiles>
{
    protected override async Task<(IDatabase, IEntityStore)> CreateAsync()
    {
        var database = await files.NewDatabaseAsync();
        return (database, new SqlEntityStore(database));
    }
}

public sealed class PostgresEntityStoreTests(PostgresServer server) : EntityStoreContract, IClassFixture<PostgresServer>
{
    protected override async Task<(IDatabase, IEntityStore)> CreateAsync()
    {
        var database = await server.NewDatabaseAsync();
        return (database, new SqlEntityStore(database));
    }
}

public sealed class SqliteAccountStoreTests(SqliteFiles files) : AccountStoreContract, IClassFixture<SqliteFiles>
{
    protected override async Task<(IAccountStore, ISecretStore)> CreateAsync()
    {
        var database = await files.NewDatabaseAsync();
        return (new SqlAccountStore(database), new SqlSecretStore(database));
    }
}

public sealed class PostgresAccountStoreTests(PostgresServer server) : AccountStoreContract, IClassFixture<PostgresServer>
{
    protected override async Task<(IAccountStore, ISecretStore)> CreateAsync()
    {
        var database = await server.NewDatabaseAsync();
        return (new SqlAccountStore(database), new SqlSecretStore(database));
    }
}

public sealed class SqliteServerGroupStoreTests(SqliteFiles files) : ServerGroupStoreContract, IClassFixture<SqliteFiles>
{
    protected override async Task<IServerGroupStore> CreateAsync() => new SqlServerGroupStore(await files.NewDatabaseAsync());
}

public sealed class PostgresServerGroupStoreTests(PostgresServer server) : ServerGroupStoreContract, IClassFixture<PostgresServer>
{
    protected override async Task<IServerGroupStore> CreateAsync() => new SqlServerGroupStore(await server.NewDatabaseAsync());
}

public sealed class SqliteIdentityStoreTests(SqliteFiles files) : IdentityStoreContract, IClassFixture<SqliteFiles>
{
    protected override async Task<IIdentityStore> CreateAsync() => new SqlIdentityStore(await files.NewDatabaseAsync());
}

public sealed class PostgresIdentityStoreTests(PostgresServer server) : IdentityStoreContract, IClassFixture<PostgresServer>
{
    protected override async Task<IIdentityStore> CreateAsync() => new SqlIdentityStore(await server.NewDatabaseAsync());
}
