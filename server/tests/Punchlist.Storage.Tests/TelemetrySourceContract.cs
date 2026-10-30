using Punchlist.Core.Accounts;
using Punchlist.Core.Push;
using Punchlist.Core.Telemetry;
using Punchlist.Storage.Sql;

namespace Punchlist.Storage.Tests;

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
