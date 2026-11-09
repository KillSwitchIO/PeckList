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

    [Fact]
    public async Task The_newer_schema_check_reads_what_a_newer_version_left_and_changes_nothing()
    {
        var database = await CreateAsync();
        var token = TestContext.Current.CancellationToken;
        Assert.Null(await database.NewerSchemaAsync(token));

        await using (var connection = await database.OpenAsync(token))
        {
            await connection.ExecuteAsync("INSERT INTO schema_migrations (version, applied_at) VALUES (99999, 'from a newer version')");
        }
        var newer = await database.NewerSchemaAsync(token);
        Assert.NotNull(newer);
        Assert.Equal(99999, newer.Value.Database);
        Assert.True(newer.Value.Known is > 0 and < 99999);

        // A database with no schema yet: nothing to say.
        await using (var connection = await database.OpenAsync(token))
        {
            await connection.ExecuteAsync("DROP TABLE schema_migrations");
        }
        Assert.Null(await database.NewerSchemaAsync(token));
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
