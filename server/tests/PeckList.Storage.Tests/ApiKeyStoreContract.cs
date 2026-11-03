using PeckList.Core.Accounts;

namespace PeckList.Storage.Tests;

/// <summary>What every <see cref="IApiKeyStore"/> adapter must do (R-FB-157).</summary>
public abstract class ApiKeyStoreContract : IAsyncLifetime
{
    protected IApiKeyStore Keys { get; private set; } = null!;

    protected abstract Task<IApiKeyStore> CreateAsync();

    public async ValueTask InitializeAsync() => Keys = await CreateAsync();

    public ValueTask DisposeAsync() => ValueTask.CompletedTask;

    private static CancellationToken Token => TestContext.Current.CancellationToken;

    private static readonly DateTimeOffset Monday = new(2026, 10, 19, 8, 0, 0, TimeSpan.Zero);

    private static ApiKey Key(string id, string user, int day, DateTimeOffset? expires = null) => new()
    {
        Id = id,
        UserId = user,
        Name = $"key {id}",
        SecretHash = new string('a', 64),
        Scopes = [ApiScopes.TasksRead, ApiScopes.FilesRead],
        CreatedAt = Monday.AddDays(day),
        ExpiresAt = expires,
    };

    [Fact]
    public async Task Keeps_a_key_as_given_and_lists_a_persons_newest_first()
    {
        await Keys.AddAsync(Key("k1", "sam", 0, Monday.AddDays(30)), Token);
        await Keys.AddAsync(Key("k2", "sam", 1), Token);
        await Keys.AddAsync(Key("k3", "jo", 2), Token);
        var found = await Keys.FindAsync("k1", Token);
        Assert.NotNull(found);
        Assert.Equal(("sam", "key k1", Monday, Monday.AddDays(30)), (found.UserId, found.Name, found.CreatedAt, found.ExpiresAt));
        Assert.Equal([ApiScopes.TasksRead, ApiScopes.FilesRead], found.Scopes);
        Assert.Null(found.LastUsedAt);
        Assert.Equal(["k2", "k1"], (await Keys.ListAsync("sam", Token)).Select(key => key.Id));
        Assert.Null(await Keys.FindAsync("nope", Token));
    }

    [Fact]
    public async Task Records_use_and_revocation_and_forgets_a_persons_keys()
    {
        await Keys.AddAsync(Key("k1", "sam", 0), Token);
        await Keys.AddAsync(Key("k2", "jo", 0), Token);
        await Keys.TouchAsync("k1", Monday.AddHours(3), Token);
        await Keys.RevokeAsync("k1", Monday.AddHours(4), Token);
        // A second revoke keeps the first time.
        await Keys.RevokeAsync("k1", Monday.AddHours(9), Token);
        var key = await Keys.FindAsync("k1", Token);
        Assert.Equal((Monday.AddHours(3), Monday.AddHours(4)), (key!.LastUsedAt, key.RevokedAt));
        Assert.False(key.WorksAt(Monday.AddHours(5)));

        await Keys.DeleteForUserAsync("sam", Token);
        Assert.Empty(await Keys.ListAsync("sam", Token));
        Assert.Single(await Keys.ListAsync("jo", Token));
    }
}
