using PeckList.Core.Accounts;

namespace PeckList.Storage.Tests;

/// <summary>What every <see cref="IPasskeyStore"/> adapter must do (PL-123).</summary>
public abstract class PasskeyStoreContract : IAsyncLifetime
{
    protected IPasskeyStore Passkeys { get; private set; } = null!;

    protected abstract Task<IPasskeyStore> CreateAsync();

    public async ValueTask InitializeAsync() => Passkeys = await CreateAsync();

    public ValueTask DisposeAsync() => ValueTask.CompletedTask;

    private static CancellationToken Token => TestContext.Current.CancellationToken;

    private static readonly DateTimeOffset Monday = new(2026, 11, 2, 8, 0, 0, TimeSpan.Zero);

    private static Passkey Key(string id, string account, int day) => new()
    {
        Id = id,
        AccountId = account,
        Name = $"key {id}",
        PublicKey = "pQECAyYgASFYIA",
        SignCount = 3,
        Transports = "internal,hybrid",
        BackedUp = true,
        CreatedAt = Monday.AddDays(day),
    };

    [Fact]
    public async Task Keeps_finds_and_lists_passkeys_by_account_oldest_first()
    {
        await Passkeys.AddAsync(Key("k2", "U1", 1), Token);
        await Passkeys.AddAsync(Key("k1", "U1", 0), Token);
        await Passkeys.AddAsync(Key("k3", "U2", 2), Token);
        Assert.Equal(Key("k1", "U1", 0), await Passkeys.FindAsync("k1", Token));
        Assert.Null(await Passkeys.FindAsync("nope", Token));
        Assert.Equal(["k1", "k2"], (await Passkeys.ListAsync("U1", Token)).Select(each => each.Id));
        Assert.Equal(["k1", "k2", "k3"], (await Passkeys.AllAsync(Token)).Select(each => each.Id));
        await Assert.ThrowsAsync<InvalidOperationException>(() => Passkeys.AddAsync(Key("k1", "U2", 3), Token));
    }

    [Fact]
    public async Task Updates_the_name_counter_and_last_use_and_deletes()
    {
        await Passkeys.AddAsync(Key("k1", "U1", 0), Token);
        await Passkeys.AddAsync(Key("k2", "U1", 1), Token);
        var used = Key("k1", "U1", 0) with { Name = "Pixel", SignCount = 9, BackedUp = false, LastUsedAt = Monday.AddDays(5) };
        Assert.True(await Passkeys.UpdateAsync(used, Token));
        Assert.Equal(used, await Passkeys.FindAsync("k1", Token));
        Assert.False(await Passkeys.UpdateAsync(Key("nope", "U1", 0), Token));
        Assert.True(await Passkeys.DeleteAsync("k1", Token));
        Assert.False(await Passkeys.DeleteAsync("k1", Token));
        await Passkeys.AddAsync(Key("k3", "U2", 2), Token);
        Assert.Equal(1, await Passkeys.DeleteAllAsync("U1", Token));
        Assert.Equal(["k3"], (await Passkeys.AllAsync(Token)).Select(each => each.Id));
    }
}
