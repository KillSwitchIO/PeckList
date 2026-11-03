using PeckList.Core.Accounts;

namespace PeckList.Core.Tests;

/// <summary>Keys in memory, for the rules above the store.</summary>
public sealed class MemoryApiKeyStore : IApiKeyStore
{
    public Dictionary<string, ApiKey> ById { get; } = [];

    public Task AddAsync(ApiKey key, CancellationToken cancellation = default)
    {
        ById[key.Id] = key;
        return Task.CompletedTask;
    }

    public Task<ApiKey?> FindAsync(string id, CancellationToken cancellation = default) => Task.FromResult(ById.GetValueOrDefault(id));

    public Task<IReadOnlyList<ApiKey>> ListAsync(string userId, CancellationToken cancellation = default) =>
        Task.FromResult<IReadOnlyList<ApiKey>>([.. ById.Values.Where(key => key.UserId == userId).OrderByDescending(key => key.CreatedAt)]);

    public Task RevokeAsync(string id, DateTimeOffset at, CancellationToken cancellation = default)
    {
        ById[id] = ById[id] with { RevokedAt = ById[id].RevokedAt ?? at };
        return Task.CompletedTask;
    }

    public Task TouchAsync(string id, DateTimeOffset at, CancellationToken cancellation = default)
    {
        ById[id] = ById[id] with { LastUsedAt = at };
        return Task.CompletedTask;
    }

    public Task DeleteForUserAsync(string userId, CancellationToken cancellation = default)
    {
        foreach (var id in ById.Values.Where(key => key.UserId == userId).Select(key => key.Id).ToList()) ById.Remove(id);
        return Task.CompletedTask;
    }
}

public sealed class ApiKeyServiceTests
{
    private static CancellationToken Token => TestContext.Current.CancellationToken;

    private static readonly DateTimeOffset Monday = new(2026, 10, 19, 8, 0, 0, TimeSpan.Zero);

    private readonly TestClock clock = new(Monday);
    private readonly MemoryApiKeyStore store = new();

    private ApiKeyService Keys => new(store, clock);

    [Fact]
    public async Task A_token_works_until_it_expires_or_is_revoked_and_its_secret_is_never_kept()
    {
        var (key, token) = await Keys.CreateAsync("sam", Role.User, "  Home Assistant  ", [ApiScopes.TasksRead], Monday.AddDays(7), Token);
        Assert.StartsWith($"pl_{key.Id}_", token);
        Assert.Equal("Home Assistant", key.Name);
        var secret = token[$"pl_{key.Id}_".Length..];
        Assert.NotEqual(secret, key.SecretHash);
        Assert.Equal(ApiKeyService.Hash(secret), key.SecretHash);
        Assert.Equal(key.Id, (await Keys.CheckAsync(token, Token))?.Id);

        // A wrong secret, a made-up id, not a key at all.
        var wrong = token[..^1] + (token[^1] == 'A' ? "B" : "A");
        Assert.Null(await Keys.CheckAsync(wrong, Token));
        Assert.Null(await Keys.CheckAsync("pl_0000000000000000_abc", Token));
        Assert.Null(await Keys.CheckAsync("Bearer nothing", Token));

        clock.Now = Monday.AddDays(7);
        Assert.Null(await Keys.CheckAsync(token, Token));

        clock.Now = Monday;
        var (other, second) = await Keys.CreateAsync("sam", Role.User, "Script", [ApiScopes.TasksRead], null, Token);
        Assert.False(await Keys.RevokeAsync("jo", other.Id, Token));
        Assert.NotNull(await Keys.CheckAsync(second, Token));
        Assert.True(await Keys.RevokeAsync("sam", other.Id, Token));
        Assert.Null(await Keys.CheckAsync(second, Token));
    }

    [Fact]
    public async Task Writing_brings_reading_and_only_admins_give_the_admin_permission()
    {
        var (key, _) = await Keys.CreateAsync("sam", Role.User, "Sync", [ApiScopes.TasksWrite, ApiScopes.FilesWrite], null, Token);
        Assert.Equal([ApiScopes.TasksRead, ApiScopes.TasksWrite, ApiScopes.FilesRead, ApiScopes.FilesWrite], key.Scopes);

        await Assert.ThrowsAsync<ApiKeyRejected>(() => Keys.CreateAsync("sam", Role.User, "x", [ApiScopes.Admin], null, Token));
        await Assert.ThrowsAsync<ApiKeyRejected>(() => Keys.CreateAsync("sam", Role.User, "x", [], null, Token));
        await Assert.ThrowsAsync<ApiKeyRejected>(() => Keys.CreateAsync("sam", Role.User, "x", ["everything"], null, Token));
        await Assert.ThrowsAsync<ApiKeyRejected>(() => Keys.CreateAsync("sam", Role.User, " ", [ApiScopes.TasksRead], null, Token));
        await Assert.ThrowsAsync<ApiKeyRejected>(() => Keys.CreateAsync("sam", Role.User, "x", [ApiScopes.TasksRead], Monday, Token));
        var (admin, _) = await Keys.CreateAsync("root", Role.Admin, "Backups", [ApiScopes.Admin], null, Token);
        Assert.Equal([ApiScopes.Admin], admin.Scopes);
    }
}
