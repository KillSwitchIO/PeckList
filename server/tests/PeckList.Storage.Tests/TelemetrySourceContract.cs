using System.Text.Json.Nodes;
using PeckList.Core.Accounts;
using PeckList.Core.Push;
using PeckList.Core.Storage;
using PeckList.Core.Telemetry;
using PeckList.Storage.Sql;

namespace PeckList.Storage.Tests;

/// <summary>What every <see cref="ITelemetrySource"/> adapter must count (PL-116).</summary>
public abstract class TelemetrySourceContract : IAsyncLifetime
{
    private SqlDatabase database = null!;

    protected abstract Task<SqlDatabase> CreateAsync();

    public async ValueTask InitializeAsync() => database = await CreateAsync();

    public ValueTask DisposeAsync() => ValueTask.CompletedTask;

    private static CancellationToken Token => TestContext.Current.CancellationToken;

    private static readonly DateTimeOffset Now = new(2026, 10, 30, 12, 0, 0, TimeSpan.Zero);

    [Fact]
    public async Task Counts_working_keys_notices_push_and_measures_the_database()
    {
        var source = new SqlTelemetrySource(database);
        Assert.Equal(0, await source.ActiveApiKeysAsync(Now, Token));
        Assert.False(await source.AnyPushSubscriptionAsync(Token));

        var keys = new SqlApiKeyStore(database);
        await keys.AddAsync(Key("works", null), Token);
        await keys.AddAsync(Key("works-a-while", Now.AddDays(1)), Token);
        await keys.AddAsync(Key("expired", Now.AddDays(-1)), Token);
        await keys.AddAsync(Key("revoked", null), Token);
        await keys.RevokeAsync("revoked", Now.AddHours(-1), Token);
        await new SqlPushStore(database, TimeProvider.System)
            .SaveAsync(new PushSubscription("sam", "https://push.example/1", "p256dh", "auth"), Token);

        Assert.Equal(2, await source.ActiveApiKeysAsync(Now, Token));
        Assert.True(await source.AnyPushSubscriptionAsync(Token));
        Assert.True(await source.DatabaseBytesAsync(Token) > 0);
    }

    [Fact]
    public async Task Counts_rows_by_collection_without_the_deleted_and_the_servers_tables()
    {
        static IncomingEntity Entity(string collection, string id, string? deletedAt = null) =>
            new(collection, new JsonObject { ["id"] = id, ["title"] = "Feed the zebra finches", ["deletedAt"] = deletedAt });
        static JsonObject Take(StoredEntity? _, IncomingEntity incoming) => (JsonObject)incoming.Doc.DeepClone();
        await new SqlEntityStore(database).WriteAsync("01JBACCT000000000000000001",
            [Entity("tasks", "T1"), Entity("tasks", "T2"), Entity("tasks", "T3", "2026-10-21T11:00:00.000Z"), Entity("lists", "L1"),
             Entity("zebraNotes", "Z1")],
            Take, cancellation: Token);
        await new SqlApiKeyStore(database).AddAsync(Key("works", null), Token);

        var rows = await new SqlTelemetrySource(database).RowCountsAsync(Token);
        Assert.Equal((2, 1, 1), (rows["tasks"], rows["lists"], rows["apiKeys"]));
        // Only names off the report's list: never a collection it does not know.
        Assert.True(rows.Keys.All(TelemetryRows.Names.Contains));
        Assert.Equal(TelemetryRows.Tables.Count, rows.Keys.Count(TelemetryRows.Tables.ContainsKey));
    }

    private static ApiKey Key(string id, DateTimeOffset? expires) => new()
    {
        Id = id,
        UserId = "sam",
        Name = id,
        SecretHash = new string('a', 64),
        Scopes = [ApiScopes.TasksRead],
        CreatedAt = Now.AddDays(-7),
        ExpiresAt = expires,
    };
}

public sealed class SqliteTelemetrySourceTests(SqliteFiles files) : TelemetrySourceContract, IClassFixture<SqliteFiles>
{
    protected override Task<SqlDatabase> CreateAsync() => files.NewDatabaseAsync();
}

public sealed class PostgresTelemetrySourceTests(PostgresServer server) : TelemetrySourceContract, IClassFixture<PostgresServer>
{
    protected override Task<SqlDatabase> CreateAsync() => server.NewDatabaseAsync();
}
