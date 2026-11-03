using PeckList.Core.Accounts;

namespace PeckList.Storage.Tests;

/// <summary>What every <see cref="IServerGroupStore"/> adapter must do.</summary>
public abstract class ServerGroupStoreContract : IAsyncLifetime
{
    protected IServerGroupStore Groups { get; private set; } = null!;

    protected abstract Task<IServerGroupStore> CreateAsync();

    public async ValueTask InitializeAsync() => Groups = await CreateAsync();

    public ValueTask DisposeAsync() => ValueTask.CompletedTask;

    private static CancellationToken Token => TestContext.Current.CancellationToken;

    private static ServerGroup Sample(string id = "G1", string name = "Family") => new()
    {
        Id = id,
        Name = name,
        OfferedForSharing = true,
        CreatedAt = new DateTimeOffset(2026, 10, 22, 8, 0, 0, TimeSpan.Zero),
    };

    [Fact]
    public async Task Stores_finds_and_lists_groups_by_name()
    {
        await Groups.CreateAsync(Sample("G1", "zebra keepers"), Token);
        await Groups.CreateAsync(Sample("G2", "Family"), Token);
        Assert.Equal(["Family", "zebra keepers"], (await Groups.ListAsync(Token)).Select(group => group.Name));
        Assert.Equal(Sample("G2", "Family"), await Groups.FindAsync("G2", Token));
        Assert.Equal("G2", (await Groups.FindByNameAsync("  FAMILY ", Token))?.Id);
        Assert.Null(await Groups.FindAsync("G3", Token));
    }

    [Fact]
    public async Task Names_are_unique_ignoring_case()
    {
        await Groups.CreateAsync(Sample("G1", "Family"), Token);
        await Groups.CreateAsync(Sample("G2", "Friends"), Token);
        await Assert.ThrowsAsync<DuplicateGroupNameException>(() => Groups.CreateAsync(Sample("G3", "family"), Token));
        await Assert.ThrowsAsync<DuplicateGroupNameException>(() => Groups.UpdateAsync(Sample("G2", "FAMILY"), Token));

        await Groups.UpdateAsync(Sample("G2", "Neighbors") with { OfferedForSharing = false }, Token);
        Assert.Equal(Sample("G2", "Neighbors") with { OfferedForSharing = false }, await Groups.FindAsync("G2", Token));
        await Assert.ThrowsAsync<KeyNotFoundException>(() => Groups.UpdateAsync(Sample("G9"), Token));
    }

    [Fact]
    public async Task Memberships_are_kept_per_source()
    {
        await Groups.CreateAsync(Sample("G1", "Family"), Token);
        await Groups.CreateAsync(Sample("G2", "Admins"), Token);
        await Groups.AddMembershipAsync(new("G1", "U1", MembershipSource.Manual), Token);
        await Groups.AddMembershipAsync(new("G1", "U1", MembershipSource.Manual), Token);
        await Groups.SetMembershipsAsync("U1", MembershipSource.Oidc("pocket"), ["G1", "G2"], Token);
        Assert.Equal(
            [new("G1", "U1", "manual"), new("G1", "U1", "oidc:pocket"), new("G2", "U1", "oidc:pocket")],
            await Groups.MembershipsAsync(Token));

        // The provider's next sign-in replaces only its own rows.
        await Groups.SetMembershipsAsync("U1", MembershipSource.Oidc("pocket"), [], Token);
        Assert.Equal([new GroupMembership("G1", "U1", "manual")], await Groups.MembershipsAsync(Token));

        await Groups.RemoveMembershipAsync(new("G1", "U1", MembershipSource.Manual), Token);
        await Groups.RemoveMembershipAsync(new("G1", "U1", MembershipSource.Manual), Token);
        Assert.Empty(await Groups.MembershipsAsync(Token));
    }

    [Fact]
    public async Task Deleting_a_group_drops_its_memberships()
    {
        await Groups.CreateAsync(Sample("G1", "Family"), Token);
        await Groups.CreateAsync(Sample("G2", "Admins"), Token);
        await Groups.AddMembershipAsync(new("G1", "U1", MembershipSource.Manual), Token);
        await Groups.AddMembershipAsync(new("G2", "U1", MembershipSource.Manual), Token);

        Assert.True(await Groups.DeleteAsync("G1", Token));
        Assert.False(await Groups.DeleteAsync("G1", Token));
        Assert.Equal(["G2"], (await Groups.ListAsync(Token)).Select(group => group.Id));
        Assert.Equal([new GroupMembership("G2", "U1", "manual")], await Groups.MembershipsAsync(Token));
    }
}
