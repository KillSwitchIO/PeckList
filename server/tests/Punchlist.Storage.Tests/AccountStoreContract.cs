using Punchlist.Core.Accounts;

namespace Punchlist.Storage.Tests;

/// <summary>What every <see cref="IAccountStore"/> and <see cref="ISecretStore"/> adapter must do.</summary>
public abstract class AccountStoreContract : IAsyncLifetime
{
    protected IAccountStore Accounts { get; private set; } = null!;
    protected ISecretStore Secrets { get; private set; } = null!;

    protected abstract Task<(IAccountStore, ISecretStore)> CreateAsync();

    public async ValueTask InitializeAsync() => (Accounts, Secrets) = await CreateAsync();

    public ValueTask DisposeAsync() => ValueTask.CompletedTask;

    private static CancellationToken Token => TestContext.Current.CancellationToken;

    private static Account Sample(string id = "U1", string username = "Ben") => new()
    {
        Id = id,
        Username = username,
        PasswordHash = "hash",
        Role = Role.Admin,
        MustChangePassword = true,
        SecurityStamp = "stamp1",
        CreatedAt = new DateTimeOffset(2026, 10, 21, 9, 30, 0, TimeSpan.Zero),
    };

    [Fact]
    public async Task Stores_and_finds_an_account()
    {
        Assert.Equal(0, await Accounts.CountAsync(Token));
        await Accounts.CreateAsync(Sample(), Token);
        Assert.Equal(1, await Accounts.CountAsync(Token));

        var found = await Accounts.FindByIdAsync("U1", Token);
        Assert.Equal(Sample() with { Username = "ben" }, found);
        Assert.Equal("U1", (await Accounts.FindByUsernameAsync("BEN", Token))?.Id);
        Assert.Null(await Accounts.FindByUsernameAsync("someone", Token));
        Assert.Null(await Accounts.FindByIdAsync("U2", Token));
    }

    [Fact]
    public async Task Usernames_are_unique_ignoring_case()
    {
        await Accounts.CreateAsync(Sample(), Token);
        await Assert.ThrowsAsync<DuplicateUsernameException>(() => Accounts.CreateAsync(Sample("U2", "BEN"), Token));
    }

    [Fact]
    public async Task Updates_every_field()
    {
        await Accounts.CreateAsync(Sample(), Token);
        var changed = Sample() with
        {
            Username = "benjamin",
            PasswordHash = null,
            Role = Role.User,
            MustChangePassword = false,
            FailedLogins = 3,
            LockedUntil = new DateTimeOffset(2026, 10, 21, 10, 0, 0, TimeSpan.Zero),
            SecurityStamp = "stamp2",
            Disabled = true,
        };
        await Accounts.UpdateAsync(changed, Token);
        Assert.Equal(changed, await Accounts.FindByIdAsync("U1", Token));
        await Assert.ThrowsAsync<KeyNotFoundException>(() => Accounts.UpdateAsync(Sample("U9"), Token));
    }

    [Fact]
    public async Task Keeps_secrets_by_kind_and_name()
    {
        await Secrets.PutAsync("keys", "b", "two", Token);
        await Secrets.PutAsync("keys", "a", "one", Token);
        await Secrets.PutAsync("other", "a", "elsewhere", Token);
        await Secrets.PutAsync("keys", "a", "one again", Token);
        Assert.Equal([("a", "one again"), ("b", "two")], await Secrets.ListAsync("keys", Token));
        Assert.Empty(await Secrets.ListAsync("none", Token));
    }
}
