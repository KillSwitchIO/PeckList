using PeckList.Core.Accounts;
using PeckList.Storage.Sql;

namespace PeckList.Storage.Tests;

/// <summary>Revoking a key or removing a passkey is kept for good (0022), on each database.</summary>
public abstract class CredentialRevocationContract
{
    protected abstract Task<SqlDatabase> CreateAsync();

    private static CancellationToken Token => TestContext.Current.CancellationToken;

    private static readonly DateTimeOffset Monday = new(2026, 10, 19, 8, 0, 0, TimeSpan.Zero);

    private sealed class Clock(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }

    private static ApiKey Key(string id, string user) => new()
    {
        Id = id,
        UserId = user,
        Name = $"key {id}",
        SecretHash = new string('a', 64),
        Scopes = [ApiScopes.TasksRead],
        CreatedAt = Monday,
    };

    private static Passkey Phone(string id, string account) => new()
    {
        Id = id,
        AccountId = account,
        Name = $"phone {id}",
        PublicKey = $"public-{id}",
        CreatedAt = Monday,
    };

    [Fact]
    public async Task Revoking_a_key_is_kept_after_its_row_is_pruned_with_the_first_time()
    {
        var database = await CreateAsync();
        var keys = new SqlApiKeyStore(database);
        var revocations = new SqlCredentialRevocationStore(database);
        await keys.AddAsync(Key("k1", "sam"), Token);
        await keys.AddAsync(Key("k2", "sam"), Token);

        await keys.RevokeAsync("k1", Monday.AddHours(1), Token);
        await keys.RevokeAsync("k1", Monday.AddHours(5), Token);
        await keys.PruneRevokedAsync(Monday.AddDays(30), Token);

        Assert.Null(await keys.FindAsync("k1", Token));
        Assert.Equal([new CredentialRevocation(CredentialRevocation.ApiKey, "k1", "sam", Monday.AddHours(1))], await revocations.AllAsync(Token));
    }

    [Fact]
    public async Task Removing_a_passkey_is_kept_but_an_accounts_removal_is_not()
    {
        var database = await CreateAsync();
        var passkeys = new SqlPasskeyStore(database, new Clock(Monday.AddHours(2)));
        var revocations = new SqlCredentialRevocationStore(database);
        await passkeys.AddAsync(Phone("p1", "sam"), Token);
        await passkeys.AddAsync(Phone("p2", "sam"), Token);
        await passkeys.AddAsync(Phone("p3", "jo"), Token);

        Assert.True(await passkeys.DeleteAsync("p1", Token));
        Assert.False(await passkeys.DeleteAsync("not-there", Token));
        // Every passkey at once goes only with an account removed for good: not a revocation.
        await passkeys.DeleteAllAsync("jo", Token);

        Assert.Equal([new CredentialRevocation(CredentialRevocation.Passkey, "p1", "sam", Monday.AddHours(2))], await revocations.AllAsync(Token));
    }

    [Fact]
    public async Task Keeps_the_first_time_and_forgets_only_the_removed_accounts()
    {
        var database = await CreateAsync();
        var revocations = new SqlCredentialRevocationStore(database);
        await revocations.AddAsync(new(CredentialRevocation.ApiKey, "k1", "sam", Monday), Token);
        await revocations.AddAsync(new(CredentialRevocation.ApiKey, "k1", "sam", Monday.AddDays(1)), Token);
        // The same id as another kind is its own record.
        await revocations.AddAsync(new(CredentialRevocation.Passkey, "k1", "sam", Monday.AddHours(1)), Token);
        await revocations.AddAsync(new(CredentialRevocation.Passkey, "p9", "jo", Monday.AddHours(2)), Token);

        await revocations.DeleteForAccountAsync("jo", Token);

        Assert.Equal(
            [new(CredentialRevocation.ApiKey, "k1", "sam", Monday), new CredentialRevocation(CredentialRevocation.Passkey, "k1", "sam", Monday.AddHours(1))],
            await revocations.AllAsync(Token));
    }
}

public sealed class SqliteCredentialRevocationTests(SqliteFiles files) : CredentialRevocationContract, IClassFixture<SqliteFiles>
{
    protected override Task<SqlDatabase> CreateAsync() => files.NewDatabaseAsync();
}

public sealed class PostgresCredentialRevocationTests(PostgresServer server) : CredentialRevocationContract, IClassFixture<PostgresServer>
{
    protected override Task<SqlDatabase> CreateAsync() => server.NewDatabaseAsync();
}
