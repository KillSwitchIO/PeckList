using Dapper;
using Microsoft.Extensions.DependencyInjection;
using PeckList.Core.Storage;
using PeckList.Storage.Sqlite;

namespace PeckList.Server.Tests;

/// <summary>An older server on a database a newer one upgraded stops with one line, before it starts.</summary>
public sealed class NewerDatabaseTests : IDisposable
{
    private static CancellationToken Token => TestContext.Current.CancellationToken;

    private readonly string folder = Directory.CreateTempSubdirectory("pecklist-newer-").FullName;

    public void Dispose()
    {
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        Directory.Delete(folder, recursive: true);
    }

    private static IServiceProvider With(IDatabase database) =>
        new ServiceCollection().AddSingleton(database).BuildServiceProvider();

    [Fact]
    public async Task A_database_a_newer_version_upgraded_gives_one_line_to_stop_with()
    {
        var database = new SqliteDatabase(Path.Combine(folder, "pecklist.db"));
        await database.MigrateAsync(Token);
        Assert.Null(await StartupChecks.NewerDatabaseAsync(With(database), cancellation: Token));

        await using (var connection = await database.OpenAsync(Token))
        {
            await connection.ExecuteAsync("INSERT INTO schema_migrations (version, applied_at) VALUES (99999, 'from a newer version')");
        }
        var line = await StartupChecks.NewerDatabaseAsync(With(database), cancellation: Token);

        Assert.NotNull(line);
        Assert.Contains("upgraded by a newer PeckList (schema 99999", line);
        Assert.Contains("restore a backup from before the upgrade", line);
        Assert.DoesNotContain("\n", line);
    }

    [Fact]
    public async Task A_new_database_or_one_that_cannot_be_opened_is_left_to_the_normal_start()
    {
        Assert.Null(await StartupChecks.NewerDatabaseAsync(With(new SqliteDatabase(Path.Combine(folder, "new.db"))), cancellation: Token));
        Assert.Null(await StartupChecks.NewerDatabaseAsync(
            With(new SqliteDatabase(Path.Combine(folder, "no such folder", "pecklist.db"))), cancellation: Token));
    }

    [Fact]
    public void A_refusal_found_while_starting_is_known_however_the_host_wrapped_it()
    {
        // The newer schema can also turn up while migrating (the early check found nothing in
        // time); the host may hand it on as it is, wrapped, or in an aggregate.
        var newer = new PeckList.Storage.Sql.NewerDatabaseException(18, 15);
        Assert.Same(newer, StartupChecks.Find<PeckList.Storage.Sql.NewerDatabaseException>(newer));
        Assert.Same(newer, StartupChecks.Find<PeckList.Storage.Sql.NewerDatabaseException>(new InvalidOperationException("starting", newer)));
        Assert.Same(newer, StartupChecks.Find<PeckList.Storage.Sql.NewerDatabaseException>(
            new AggregateException(new TimeoutException(), new AggregateException(newer))));
        Assert.Null(StartupChecks.Find<PeckList.Storage.Sql.NewerDatabaseException>(new InvalidOperationException("other")));
        Assert.NotEqual(StartupChecks.ExitCodes.NewerDatabase, StartupChecks.ExitCodes.Settings);
        Assert.NotEqual(StartupChecks.ExitCodes.NewerDatabase, StartupChecks.ExitCodes.Unwritable);
        Assert.DoesNotContain(1, new[] { StartupChecks.ExitCodes.Settings, StartupChecks.ExitCodes.NewerDatabase, StartupChecks.ExitCodes.Unwritable });
    }
}
