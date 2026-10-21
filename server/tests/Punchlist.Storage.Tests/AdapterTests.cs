using Punchlist.Core.Storage;
using Punchlist.Storage.Postgres;
using Punchlist.Storage.Sqlite;
using Testcontainers.PostgreSql;

namespace Punchlist.Storage.Tests;

public sealed class SqliteEntityStoreTests : EntityStoreContract
{
    private readonly string folder = Directory.CreateTempSubdirectory("punchlist-sqlite-").FullName;

    protected override async Task<IEntityStore> CreateStoreAsync()
    {
        var store = new SqliteEntityStore(Path.Combine(folder, "nested", "punchlist.db"));
        await store.MigrateAsync(TestContext.Current.CancellationToken);
        return store;
    }

    public override ValueTask DisposeAsync()
    {
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        Directory.Delete(folder, recursive: true);
        return ValueTask.CompletedTask;
    }
}

/// <summary>One PostgreSQL container for the whole run (Testcontainers; needs Docker).</summary>
public sealed class PostgresServer : IAsyncLifetime
{
    private readonly PostgreSqlContainer container = new PostgreSqlBuilder("postgres:15-alpine").Build();
    private int databases;

    public async ValueTask InitializeAsync() => await container.StartAsync();

    public async ValueTask DisposeAsync() => await container.DisposeAsync();

    /// <summary>A connection string to a new, empty database.</summary>
    public async Task<string> NewDatabaseAsync()
    {
        var name = $"test{Interlocked.Increment(ref databases)}";
        await container.ExecScriptAsync($"CREATE DATABASE {name}");
        return new Npgsql.NpgsqlConnectionStringBuilder(container.GetConnectionString()) { Database = name }.ToString();
    }
}

public sealed class PostgresEntityStoreTests(PostgresServer server) : EntityStoreContract, IClassFixture<PostgresServer>
{
    private PostgresEntityStore? store;

    protected override async Task<IEntityStore> CreateStoreAsync()
    {
        store = new PostgresEntityStore(await server.NewDatabaseAsync());
        await store.MigrateAsync(TestContext.Current.CancellationToken);
        return store;
    }

    public override async ValueTask DisposeAsync()
    {
        if (store is not null) await store.DisposeAsync();
    }
}
