using PeckList.Core.Accounts;

namespace PeckList.Storage.Tests;

/// <summary>What every <see cref="IIdentityStore"/> adapter must do.</summary>
public abstract class IdentityStoreContract : IAsyncLifetime
{
    protected IIdentityStore Identities { get; private set; } = null!;

    protected abstract Task<IIdentityStore> CreateAsync();

    public async ValueTask InitializeAsync() => Identities = await CreateAsync();

    public ValueTask DisposeAsync() => ValueTask.CompletedTask;

    private static CancellationToken Token => TestContext.Current.CancellationToken;

    private static readonly DateTimeOffset Monday = new(2026, 10, 19, 8, 0, 0, TimeSpan.Zero);

    private static LinkedIdentity Link(string provider, string subject, string account) => new()
    {
        Provider = provider,
        Subject = subject,
        AccountId = account,
        Email = $"{subject}@example.com",
        Username = $"name-{subject}",
        LinkedAt = Monday,
        LastUsedAt = Monday,
    };

    [Fact]
    public async Task Links_finds_updates_and_unlinks()
    {
        await Identities.LinkAsync(Link("pocket", "s1", "U1"), Token);
        await Identities.LinkAsync(Link("keycloak", "s1", "U2"), Token);
        Assert.Equal(Link("pocket", "s1", "U1"), await Identities.FindAsync("pocket", "s1", Token));
        Assert.Null(await Identities.FindAsync("pocket", "s2", Token));
        await Assert.ThrowsAsync<IdentityTakenException>(() => Identities.LinkAsync(Link("pocket", "s1", "U3"), Token));

        var later = Link("pocket", "s1", "U1") with { AccountId = "U9", Email = null, Username = "renamed", LastUsedAt = Monday.AddDays(1) };
        await Identities.UpdateAsync(later, Token);
        Assert.Equal(later, await Identities.FindAsync("pocket", "s1", Token));
        await Assert.ThrowsAsync<KeyNotFoundException>(() => Identities.UpdateAsync(Link("pocket", "nobody", "U1"), Token));

        Assert.Equal(["keycloak", "pocket"], (await Identities.ListAsync(Token)).Select(each => each.Provider));
        Assert.True(await Identities.UnlinkAsync("pocket", "s1", Token));
        Assert.False(await Identities.UnlinkAsync("pocket", "s1", Token));
    }

    [Fact]
    public async Task Unbinds_a_whole_provider()
    {
        await Identities.LinkAsync(Link("pocket", "s1", "U1"), Token);
        await Identities.LinkAsync(Link("pocket", "s2", "U2"), Token);
        await Identities.LinkAsync(Link("keycloak", "s3", "U3"), Token);
        Assert.Equal(2, await Identities.UnlinkProviderAsync("pocket", Token));
        Assert.Equal(["s3"], (await Identities.ListAsync(Token)).Select(each => each.Subject));
    }

    [Fact]
    public async Task Keeps_waiting_sign_ins_until_removed()
    {
        var kim = new PendingSignIn
        {
            Provider = "pocket",
            Subject = "s9",
            Username = "kim",
            DisplayName = "Kim Lee",
            Email = "kim@example.com",
            Groups = ["family", "punchlist"],
            FirstSeen = Monday,
            LastSeen = Monday,
        };
        await Identities.PutPendingAsync(kim, Token);
        await Identities.PutPendingAsync(kim with { LastSeen = Monday.AddHours(2), Groups = [] }, Token);
        Assert.Equal([kim with { LastSeen = Monday.AddHours(2), Groups = [] }], await Identities.ListPendingAsync(Token));
        Assert.True(await Identities.RemovePendingAsync("pocket", "s9", Token));
        Assert.False(await Identities.RemovePendingAsync("pocket", "s9", Token));
        Assert.Empty(await Identities.ListPendingAsync(Token));
    }

    [Fact]
    public async Task Keeps_one_mapping_per_provider_username_whatever_its_case()
    {
        var kim = new IdentityMapping { Provider = "pocket", ProviderUsername = "Kim", AccountId = "U1", CreatedAt = Monday };
        await Identities.PutMappingAsync(kim, Token);
        await Identities.PutMappingAsync(kim with { ProviderUsername = "kim", AccountId = "U2" }, Token);
        await Identities.PutMappingAsync(kim with { Provider = "keycloak" }, Token);
        Assert.Equal(
            [("keycloak", "kim", "U1"), ("pocket", "kim", "U2")],
            (await Identities.ListMappingsAsync(Token)).Select(each => (each.Provider, each.ProviderUsername, each.AccountId)));
        Assert.True(await Identities.RemoveMappingAsync("pocket", "KIM", Token));
        Assert.False(await Identities.RemoveMappingAsync("pocket", "kim", Token));
        Assert.Single(await Identities.ListMappingsAsync(Token));
    }
}
