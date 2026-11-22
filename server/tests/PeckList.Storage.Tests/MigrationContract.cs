using Dapper;
using PeckList.Core.Accounts;
using PeckList.Core.Push;
using PeckList.Storage.Sql;

namespace PeckList.Storage.Tests;

/// <summary>Migrations on each database: what a rollback to an older server meets.</summary>
public abstract class MigrationContract
{
    protected abstract Task<SqlDatabase> CreateAsync();

    /// <summary>A new database with no schema at all.</summary>
    protected abstract Task<SqlDatabase> CreateEmptyAsync();

    [Fact]
    public async Task A_database_from_0_13_0_rc_1_upgrades_through_0019_and_keeps_its_snoozes()
    {
        // QA, 0.13.0-rc.2: the upgrade in place was run on SQLite only. A database as rc.1 left it
        // (migrations to 0018), with a pending snooze, then this version's migrations on it.
        var token = TestContext.Current.CancellationToken;
        var database = await CreateEmptyAsync();
        var at = DateTimeOffset.UtcNow.AddMinutes(30);
        at = at.AddTicks(-(at.UtcTicks % TimeSpan.TicksPerMillisecond));
        await using (var connection = await database.OpenAsync(token))
        {
            await connection.ExecuteAsync("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
            foreach (var (version, sql) in SqlMigrations.Load(database.GetType().Assembly).Where(each => each.Version <= 18))
            {
                await connection.ExecuteAsync(sql);
                await connection.ExecuteAsync("INSERT INTO schema_migrations (version, applied_at) VALUES (@version, 'rc.1')", new { version });
            }
            // A snooze as rc.1 wrote it: no occurrence column yet.
            await connection.ExecuteAsync("INSERT INTO reminder_snoozes (user_id, task_id, at) VALUES ('u1', 't1', @at)",
                new { at = at.ToUnixTimeMilliseconds() });
        }

        await database.MigrateAsync(token);

        await using (var connection = await database.OpenAsync(token))
        {
            Assert.True(await connection.ExecuteScalarAsync<int>("SELECT MAX(version) FROM schema_migrations") >= 19);
        }
        var store = new SqlPushStore(database, TimeProvider.System);
        Assert.Equal(new ReminderSnooze("u1", "t1", at, null), Assert.Single(await store.SnoozesAsync(at.AddMinutes(-1), at.AddMinutes(1), cancellation: token)));
        // Snoozed again to the same time on the new version: the row takes the occurrence; a new one keeps its own.
        await store.SnoozeAsync("u1", "t1", at, "2026-11-19T10:00Z", cancellation: token);
        await store.SnoozeAsync("u1", "t2", at, "2026-11-19", cancellation: token);
        Assert.Equal(
            [new ReminderSnooze("u1", "t1", at, "2026-11-19T10:00Z"), new ReminderSnooze("u1", "t2", at, "2026-11-19")],
            await store.SnoozesAsync(at.AddMinutes(-1), at.AddMinutes(1), cancellation: token));
    }

    [Fact]
    public async Task A_database_from_0_13_0_rc_2_upgrades_through_0020_and_keeps_its_snoozes()
    {
        // 0.14.0 adds the reminder a snooze was pressed on (0020). A database as rc.2 left it
        // (migrations to 0019), with a pending snooze on an occurrence, then this version's on it.
        var token = TestContext.Current.CancellationToken;
        var database = await CreateEmptyAsync();
        var at = DateTimeOffset.UtcNow.AddMinutes(30);
        at = at.AddTicks(-(at.UtcTicks % TimeSpan.TicksPerMillisecond));
        const string occurrence = "2026-11-19T10:00Z";
        await using (var connection = await database.OpenAsync(token))
        {
            await connection.ExecuteAsync("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
            foreach (var (version, sql) in SqlMigrations.Load(database.GetType().Assembly).Where(each => each.Version <= 19))
            {
                await connection.ExecuteAsync(sql);
                await connection.ExecuteAsync("INSERT INTO schema_migrations (version, applied_at) VALUES (@version, 'rc.2')", new { version });
            }
            await connection.ExecuteAsync("INSERT INTO reminder_snoozes (user_id, task_id, at, occurrence) VALUES ('u1', 't1', @at, @occurrence)",
                new { at = at.ToUnixTimeMilliseconds(), occurrence });
        }

        await database.MigrateAsync(token);

        await using (var connection = await database.OpenAsync(token))
        {
            Assert.True(await connection.ExecuteScalarAsync<int>("SELECT MAX(version) FROM schema_migrations") >= 20);
        }
        var store = new SqlPushStore(database, TimeProvider.System);
        // rc.2's snooze names no reminder.
        var kept = new ReminderSnooze("u1", "t1", at, occurrence);
        Assert.Equal(kept, Assert.Single(await store.SnoozesAsync(at.AddMinutes(-1), at.AddMinutes(1), cancellation: token)));
        // Snoozes pressed on a reminder on the new version: the second replaces the first, and leaves
        // rc.2's, which named none.
        var first = at.AddMinutes(-20);
        await store.SnoozeAsync("u1", "t1", at.AddMinutes(5), occurrence, first, token);
        await store.SnoozeAsync("u1", "t1", at.AddMinutes(10), occurrence, first, token);
        Assert.Equal(
            [kept, new ReminderSnooze("u1", "t1", at.AddMinutes(10), occurrence, first)],
            await store.SnoozesAsync(at.AddMinutes(-1), at.AddMinutes(15), cancellation: token));
    }

    [Fact]
    public async Task A_database_from_0_13_0_upgrades_through_0021_and_keeps_its_snoozes()
    {
        // 0021 changes reminder_snoozes' key (SQLite makes the table again). A database as 0.13.0
        // left it (migrations to 0020), with a snooze that names a reminder and one that does not.
        var token = TestContext.Current.CancellationToken;
        var database = await CreateEmptyAsync();
        var at = DateTimeOffset.UtcNow.AddMinutes(30);
        at = at.AddTicks(-(at.UtcTicks % TimeSpan.TicksPerMillisecond));
        var first = at.AddMinutes(-20);
        const string occurrence = "2026-11-19T10:00Z";
        await using (var connection = await database.OpenAsync(token))
        {
            await connection.ExecuteAsync("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
            foreach (var (version, sql) in SqlMigrations.Load(database.GetType().Assembly).Where(each => each.Version <= 20))
            {
                await connection.ExecuteAsync(sql);
                await connection.ExecuteAsync("INSERT INTO schema_migrations (version, applied_at) VALUES (@version, '0.13.0')", new { version });
            }
            await connection.ExecuteAsync(
                "INSERT INTO reminder_snoozes (user_id, task_id, at, occurrence, first_at) VALUES ('u1', 't1', @at, @occurrence, @first), ('u1', 't2', @at, @occurrence, NULL)",
                new { at = at.ToUnixTimeMilliseconds(), occurrence, first = first.ToUnixTimeMilliseconds() });
        }

        await database.MigrateAsync(token);

        await using (var connection = await database.OpenAsync(token))
        {
            Assert.True(await connection.ExecuteScalarAsync<int>("SELECT MAX(version) FROM schema_migrations") >= 21);
        }
        var store = new SqlPushStore(database, TimeProvider.System);
        ReminderSnooze[] kept = [new("u1", "t1", at, occurrence, first), new("u1", "t2", at, occurrence)];
        Assert.Equal(kept, await store.SnoozesAsync(at.AddMinutes(-1), at.AddMinutes(1), cancellation: token));
        // Another reminder of t1 to the same minute: a row of its own, beside the one kept.
        var other = at.AddMinutes(-10);
        await store.SnoozeAsync("u1", "t1", at, occurrence, other, token);
        static (string, long) Key(ReminderSnooze each) => (each.TaskId, each.First?.ToUnixTimeMilliseconds() ?? -1);
        Assert.Equal(
            kept.Append(new ReminderSnooze("u1", "t1", at, occurrence, other)).OrderBy(Key),
            (await store.SnoozesAsync(at.AddMinutes(-1), at.AddMinutes(1), cancellation: token)).OrderBy(Key));
    }

    [Fact]
    public async Task A_database_from_before_0022_records_its_revoked_keys()
    {
        // 0022 keeps revocations for good. Keys revoked before it say so in their own rows until
        // they are pruned, so the migration copies those in; open keys are not revocations.
        var token = TestContext.Current.CancellationToken;
        var database = await CreateEmptyAsync();
        await using (var connection = await database.OpenAsync(token))
        {
            await connection.ExecuteAsync("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
            foreach (var (version, sql) in SqlMigrations.Load(database.GetType().Assembly).Where(each => each.Version <= 21))
            {
                await connection.ExecuteAsync(sql);
                await connection.ExecuteAsync("INSERT INTO schema_migrations (version, applied_at) VALUES (@version, '0.14.0-rc.1')", new { version });
            }
            await connection.ExecuteAsync(
                """
                INSERT INTO api_keys (id, user_id, name, secret_hash, scopes, created_at, revoked_at)
                VALUES ('k-revoked', 'u1', 'leaked', 'h1', 'tasks:read', 1000, 5000), ('k-open', 'u1', 'fine', 'h2', 'tasks:read', 1000, NULL)
                """);
        }

        await database.MigrateAsync(token);

        Assert.Equal(
            [new CredentialRevocation(CredentialRevocation.ApiKey, "k-revoked", "u1", DateTimeOffset.FromUnixTimeMilliseconds(5000))],
            await new SqlCredentialRevocationStore(database).AllAsync(token));
    }

    [Fact]
    public async Task A_database_from_before_0025_counts_every_attachments_owner_as_holding_its_file()
    {
        // 1.0: only attachments whose owner holds the file unlock its bytes. Everyone with an
        // attachment before then held its file when they added it, deleted ones too, so nobody who
        // reads a file today loses it; other kinds of rows count for nothing.
        var token = TestContext.Current.CancellationToken;
        var database = await CreateEmptyAsync();
        await using (var connection = await database.OpenAsync(token))
        {
            await connection.ExecuteAsync("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
            foreach (var (version, sql) in SqlMigrations.Load(database.GetType().Assembly).Where(each => each.Version <= 24))
            {
                await connection.ExecuteAsync(sql);
                await connection.ExecuteAsync("INSERT INTO schema_migrations (version, applied_at) VALUES (@version, '0.14.0')", new { version });
            }
            await connection.ExecuteAsync(
                """
                INSERT INTO entities (id, collection, owner_id, seq, hlc, deleted, doc) VALUES
                    ('a1', 'attachments', 'u1', 1, 'h', FALSE, '{"id":"a1","taskId":"t1","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}'),
                    ('a2', 'attachments', 'u1', 2, 'h', FALSE, '{"id":"a2","taskId":"t2","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}'),
                    ('a3', 'attachments', 'u2', 3, 'h', TRUE, '{"id":"a3","taskId":"t3","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","deletedAt":"2026-11-01T00:00:00.000Z"}'),
                    ('a4', 'attachments', 'u2', 4, 'h', FALSE, '{"id":"a4","taskId":"t3","sha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}'),
                    ('t1', 'tasks', 'u3', 5, 'h', FALSE, '{"id":"t1","title":"not a file","sha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}')
                """);
        }

        await database.MigrateAsync(token);

        Assert.Equal([("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "u1"), ("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "u2"), ("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "u2")], await new SqlFileHolderStore(database).AllAsync(token));
    }

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

    protected override Task<SqlDatabase> CreateEmptyAsync() => files.NewDatabaseAsync(migrate: false);
}

public sealed class PostgresMigrationTests(PostgresServer server) : MigrationContract, IClassFixture<PostgresServer>
{
    protected override Task<SqlDatabase> CreateAsync() => server.NewDatabaseAsync();

    protected override Task<SqlDatabase> CreateEmptyAsync() => server.NewDatabaseAsync(migrate: false);
}
