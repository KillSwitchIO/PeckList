using Dapper;
using PeckList.Storage.Sql;

namespace PeckList.Storage.Tests;

/// <summary>Migrations on each database: what a rollback to an older server meets.</summary>
public abstract class MigrationContract
{
    protected abstract Task<SqlDatabase> CreateAsync();

    [Fact]
    public async Task Migrating_twice_changes_nothing()
    {
        var database = await CreateAsync();
        await database.MigrateAsync(TestContext.Current.CancellationToken);
    }

    [Fact]
    public async Task An_older_version_refuses_a_database_a_newer_one_upgraded()
    {
        var database = await CreateAsync();
        await using (var connection = await database.OpenAsync(TestContext.Current.CancellationToken))
        {
            await connection.ExecuteAsync("INSERT INTO schema_migrations (version, applied_at) VALUES (99999, 'from a newer version')");
        }

        var error = await Assert.ThrowsAsync<NewerDatabaseException>(() => database.MigrateAsync(TestContext.Current.CancellationToken));

        Assert.Contains("upgraded by a newer PeckList", error.Message);
        Assert.Contains("99999", error.Message);
    }
}

public sealed class SqliteMigrationTests(SqliteFiles files) : MigrationContract, IClassFixture<SqliteFiles>
{
    protected override Task<SqlDatabase> CreateAsync() => files.NewDatabaseAsync();
}

public sealed class PostgresMigrationTests(PostgresServer server) : MigrationContract, IClassFixture<PostgresServer>
{
    protected override Task<SqlDatabase> CreateAsync() => server.NewDatabaseAsync();
}
