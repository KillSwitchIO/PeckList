namespace Punchlist.Core.Accounts;

/// <summary>
/// A group an admin manages (spec: Accounts &amp; Admin, Roles and server groups). Unlike the
/// friend groups users make, it has no owner and members cannot leave it. Never synced.
/// </summary>
public sealed record ServerGroup
{
    public required string Id { get; init; }

    /// <summary>Unique ignoring case.</summary>
    public required string Name { get; init; }

    /// <summary>Shown in its members' share and assignee pickers.</summary>
    public bool OfferedForSharing { get; init; }

    public required DateTimeOffset CreatedAt { get; init; }
}

/// <summary>
/// One reason an account is in a group: added by hand (<see cref="MembershipSource.Manual"/>) or
/// by an identity provider's groups claim. An account is a member while any reason remains, and a
/// provider's sign-in only ever changes its own memberships.
/// </summary>
public sealed record GroupMembership(string GroupId, string AccountId, string Source);

public static class MembershipSource
{
    public const string Manual = "manual";

    public static string Oidc(string provider) => $"oidc:{provider.ToLowerInvariant()}";
}

/// <summary>Server groups and memberships (never synced). Every adapter passes the same contract suite.</summary>
public interface IServerGroupStore
{
    /// <summary>By name, ignoring case.</summary>
    Task<IReadOnlyList<ServerGroup>> ListAsync(CancellationToken cancellation = default);

    Task<ServerGroup?> FindAsync(string id, CancellationToken cancellation = default);

    /// <summary>Case-insensitive.</summary>
    Task<ServerGroup?> FindByNameAsync(string name, CancellationToken cancellation = default);

    /// <exception cref="DuplicateGroupNameException">The name is taken.</exception>
    Task CreateAsync(ServerGroup group, CancellationToken cancellation = default);

    /// <exception cref="DuplicateGroupNameException">The new name is taken.</exception>
    Task UpdateAsync(ServerGroup group, CancellationToken cancellation = default);

    /// <summary>The group and its memberships; false when there was no such group.</summary>
    Task<bool> DeleteAsync(string id, CancellationToken cancellation = default);

    /// <summary>Every membership, by group then account then source.</summary>
    Task<IReadOnlyList<GroupMembership>> MembershipsAsync(CancellationToken cancellation = default);

    /// <summary>Adding one that exists does nothing.</summary>
    Task AddMembershipAsync(GroupMembership membership, CancellationToken cancellation = default);

    /// <summary>Removing one that does not exist does nothing.</summary>
    Task RemoveMembershipAsync(GroupMembership membership, CancellationToken cancellation = default);

    /// <summary>
    /// Make <paramref name="groupIds"/> exactly the account's memberships from <paramref name="source"/>,
    /// leaving other sources alone (an identity provider's sign-in).
    /// </summary>
    Task SetMembershipsAsync(string accountId, string source, IReadOnlyCollection<string> groupIds, CancellationToken cancellation = default);
}

public sealed class DuplicateGroupNameException(string name) : Exception($"a group named '{name}' exists");

/// <summary>A group with who is in it and why.</summary>
public sealed record ServerGroupView(ServerGroup Group, IReadOnlyList<(string AccountId, IReadOnlyList<string> Sources)> Members);

/// <summary>Admin operations on server groups.</summary>
public sealed class ServerGroupService(IServerGroupStore store, IAccountStore accounts, TimeProvider time)
{
    public const int MaxNameLength = 64;

    public async Task<IReadOnlyList<ServerGroupView>> ListAsync(CancellationToken cancellation = default)
    {
        var groups = await store.ListAsync(cancellation);
        var memberships = await store.MembershipsAsync(cancellation);
        return groups.Select(group => new ServerGroupView(group, memberships
            .Where(membership => membership.GroupId == group.Id)
            .GroupBy(membership => membership.AccountId)
            .Select(each => (each.Key, (IReadOnlyList<string>)each.Select(membership => membership.Source).ToList()))
            .ToList())).ToList();
    }

    /// <exception cref="ArgumentException">The name is empty or too long.</exception>
    /// <exception cref="DuplicateGroupNameException">The name is taken.</exception>
    public async Task<ServerGroup> CreateAsync(string name, bool offeredForSharing = false, CancellationToken cancellation = default)
    {
        var group = new ServerGroup
        {
            Id = Ids.NewUlid(time),
            Name = CheckName(name),
            OfferedForSharing = offeredForSharing,
            CreatedAt = time.GetUtcNow(),
        };
        await store.CreateAsync(group, cancellation);
        return group;
    }

    /// <summary>Rename and/or change sharing; null leaves a value as it is.</summary>
    public async Task<ServerGroup> UpdateAsync(string id, string? name, bool? offeredForSharing, CancellationToken cancellation = default)
    {
        var group = await store.FindAsync(id, cancellation) ?? throw new KeyNotFoundException($"no group {id}");
        var updated = group with
        {
            Name = name is null ? group.Name : CheckName(name),
            OfferedForSharing = offeredForSharing ?? group.OfferedForSharing,
        };
        if (updated != group) await store.UpdateAsync(updated, cancellation);
        return updated;
    }

    public Task<bool> DeleteAsync(string id, CancellationToken cancellation = default) => store.DeleteAsync(id, cancellation);

    /// <summary>Add or remove a member by hand. Memberships from an identity provider are left alone.</summary>
    public async Task SetManualMemberAsync(string groupId, string accountId, bool member, CancellationToken cancellation = default)
    {
        _ = await store.FindAsync(groupId, cancellation) ?? throw new KeyNotFoundException($"no group {groupId}");
        _ = await accounts.FindByIdAsync(accountId, cancellation) ?? throw new KeyNotFoundException($"no account {accountId}");
        var membership = new GroupMembership(groupId, accountId, MembershipSource.Manual);
        if (member) await store.AddMembershipAsync(membership, cancellation);
        else await store.RemoveMembershipAsync(membership, cancellation);
    }

    /// <summary>The ids of the groups an account is in, for any reason.</summary>
    public async Task<IReadOnlyList<string>> GroupsOfAsync(string accountId, CancellationToken cancellation = default) =>
        (await store.MembershipsAsync(cancellation))
            .Where(membership => membership.AccountId == accountId)
            .Select(membership => membership.GroupId)
            .Distinct()
            .ToList();

    private static string CheckName(string name)
    {
        var trimmed = name.Trim();
        if (trimmed.Length == 0) throw new ArgumentException("a group needs a name");
        if (trimmed.Length > MaxNameLength) throw new ArgumentException($"group names are at most {MaxNameLength} characters");
        return trimmed;
    }
}
