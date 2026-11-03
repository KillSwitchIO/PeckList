using PeckList.Core.History;
using PeckList.Core.Notifications;
using PeckList.Core.Push;
using PeckList.Core.Audit;
using PeckList.Core.Accounts;
using PeckList.Core.Storage;
using PeckList.Storage.Postgres;
using PeckList.Storage.Sql;
using PeckList.Storage.Sqlite;
using Testcontainers.PostgreSql;

namespace PeckList.Storage.Tests;

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

/// <summary>
/// A PostgreSQL server for the tests: the one PUNCHLIST_TEST_POSTGRES names (a connection string,
/// e.g. CI's postgres service), else a container of its own (Testcontainers; needs Docker).
/// </summary>
public sealed class PostgresServer : IAsyncLifetime
{
    private static readonly string? Given = Environment.GetEnvironmentVariable("PUNCHLIST_TEST_POSTGRES");
    private readonly PostgreSqlContainer? container = string.IsNullOrEmpty(Given) ? new PostgreSqlBuilder("postgres:15-alpine").Build() : null;

    public async ValueTask InitializeAsync()
    {
        if (container is not null) await container.StartAsync();
    }

    public async ValueTask DisposeAsync()
    {
        if (container is not null) await container.DisposeAsync();
    }

    /// <summary>A new, empty, migrated database (a unique name: a given server is shared by every test class).</summary>
    public async Task<SqlDatabase> NewDatabaseAsync()
    {
        var server = container?.GetConnectionString() ?? Given!;
        var name = $"test_{Guid.NewGuid():N}";
        await using (var admin = new Npgsql.NpgsqlConnection(server))
        {
            await admin.OpenAsync(TestContext.Current.CancellationToken);
            await using var create = new Npgsql.NpgsqlCommand($"CREATE DATABASE {name}", admin);
            await create.ExecuteNonQueryAsync(TestContext.Current.CancellationToken);
        }
        var connection = new Npgsql.NpgsqlConnectionStringBuilder(server) { Database = name }.ToString();
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

public sealed class SqliteAuditStoreTests(SqliteFiles files) : AuditStoreContract, IClassFixture<SqliteFiles>
{
    protected override async Task<IAuditStore> CreateAsync() => new SqlAuditStore(await files.NewDatabaseAsync());
}

public sealed class PostgresAuditStoreTests(PostgresServer server) : AuditStoreContract, IClassFixture<PostgresServer>
{
    protected override async Task<IAuditStore> CreateAsync() => new SqlAuditStore(await server.NewDatabaseAsync());
}

public sealed class SqliteStatsSourceTests(SqliteFiles files) : StatsSourceContract, IClassFixture<SqliteFiles>
{
    protected override async Task<SqlDatabase> CreateAsync() => await files.NewDatabaseAsync();
}

public sealed class PostgresStatsSourceTests(PostgresServer server) : StatsSourceContract, IClassFixture<PostgresServer>
{
    protected override async Task<SqlDatabase> CreateAsync() => await server.NewDatabaseAsync();
}

public sealed class SqliteNotificationStoreTests(SqliteFiles files) : NotificationStoreContract, IClassFixture<SqliteFiles>
{
    protected override async Task<(INotificationStore, IPushStore)> CreateAsync()
    {
        var database = await files.NewDatabaseAsync();
        return (new SqlNotificationStore(database), new SqlPushStore(database, TimeProvider.System));
    }
}

public sealed class PostgresNotificationStoreTests(PostgresServer server) : NotificationStoreContract, IClassFixture<PostgresServer>
{
    protected override async Task<(INotificationStore, IPushStore)> CreateAsync()
    {
        var database = await server.NewDatabaseAsync();
        return (new SqlNotificationStore(database), new SqlPushStore(database, TimeProvider.System));
    }
}

public sealed class SqliteTaskHistoryStoreTests(SqliteFiles files) : TaskHistoryStoreContract, IClassFixture<SqliteFiles>
{
    protected override async Task<ITaskHistoryStore> CreateAsync() => new SqlTaskHistoryStore(await files.NewDatabaseAsync());
}

public sealed class PostgresTaskHistoryStoreTests(PostgresServer server) : TaskHistoryStoreContract, IClassFixture<PostgresServer>
{
    protected override async Task<ITaskHistoryStore> CreateAsync() => new SqlTaskHistoryStore(await server.NewDatabaseAsync());
}

public sealed class SqliteApiKeyStoreTests(SqliteFiles files) : ApiKeyStoreContract, IClassFixture<SqliteFiles>
{
    protected override async Task<IApiKeyStore> CreateAsync() => new SqlApiKeyStore(await files.NewDatabaseAsync());
}

public sealed class PostgresApiKeyStoreTests(PostgresServer server) : ApiKeyStoreContract, IClassFixture<PostgresServer>
{
    protected override async Task<IApiKeyStore> CreateAsync() => new SqlApiKeyStore(await server.NewDatabaseAsync());
}
