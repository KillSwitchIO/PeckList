using System.Text.Json.Nodes;
using Punchlist.Core.Accounts;
using Punchlist.Core.Configuration;
using Punchlist.Core.Sharing;
using Punchlist.Core.Storage;
using Punchlist.Core.Sync;
using Punchlist.Server.Audit;

namespace Punchlist.Server;

/// <summary>
/// Removes deleted accounts for good once their grace period is over (spec: Users, delete with grace
/// period and restore), checking every hour: friendships end, everything the person owns is deleted
/// (devices hear of it like any deletion), provider links and server group memberships go, then
/// the account itself. Shared lists and groups an admin wants kept are handed over before deleting.
/// </summary>
public sealed class AccountRemoval(
    IAccountStore accounts,
    IEntityStore entities,
    SyncService sync,
    SharingState sharing,
    Friends friends,
    Groups groups,
    Invites invites,
    ServerGroupProjection serverGroupProjection,
    IIdentityStore identities,
    IServerGroupStore serverGroups,
    ServerClock clock,
    AuditLog audit,
    LiveSettings live,
    TimeProvider time,
    ILogger<AccountRemoval> logger) : BackgroundService
{
    /// <summary>When a deleted account goes for good.</summary>
    public DateTimeOffset RemovedAt(Account account) => account.DeletedAt!.Value.AddDays(live.Current.AccountDeleteGraceDays);

    protected override async Task ExecuteAsync(CancellationToken stopping)
    {
        await Task.Delay(TimeSpan.FromSeconds(30), time, stopping).ConfigureAwait(ConfigureAwaitOptions.SuppressThrowing);
        while (!stopping.IsCancellationRequested)
        {
            try
            {
                await RemoveDueAsync(stopping);
            }
            catch (Exception error) when (error is not OperationCanceledException)
            {
                logger.LogError(error, "Removing deleted accounts failed; trying again in an hour");
            }
            await Task.Delay(TimeSpan.FromHours(1), time, stopping).ConfigureAwait(ConfigureAwaitOptions.SuppressThrowing);
        }
    }

    /// <summary>Remove every deleted account whose grace period is over; how many went.</summary>
    public async Task<int> RemoveDueAsync(CancellationToken cancellation = default)
    {
        var now = time.GetUtcNow();
        var due = (await accounts.ListAsync(cancellation)).Where(account => account.DeletedAt is not null && RemovedAt(account) <= now).ToList();
        foreach (var account in due) await RemoveAsync(account, cancellation);
        return due.Count;
    }

    private async Task RemoveAsync(Account account, CancellationToken cancellation)
    {
        foreach (var (_, other, _) in sharing.Index.FriendshipsOf(account.Id))
        {
            await friends.EndFriendshipAsync(account.Id, other, cancellation);
        }
        var writes = new List<IncomingEntity>();
        await foreach (var entity in entities.AllAsync(cancellation))
        {
            if (entity.OwnerId != account.Id || entity.Doc["deletedAt"] is not null) continue;
            writes.Add(new IncomingEntity(entity.Collection, new JsonObject
            {
                ["id"] = entity.Id,
                ["deletedAt"] = clock.Now(),
                ["_hlc"] = new JsonObject { ["deletedAt"] = clock.Next() },
            }));
        }
        if (writes.Count > 0) await sync.WriteAsServerAsync(account.Id, writes, cancellation);
        foreach (var identity in (await identities.ListAsync(cancellation)).Where(each => each.AccountId == account.Id))
        {
            await identities.UnlinkAsync(identity.Provider, identity.Subject, cancellation);
        }
        foreach (var mapping in (await identities.ListMappingsAsync(cancellation)).Where(each => each.AccountId == account.Id))
        {
            await identities.RemoveMappingAsync(mapping.Provider, mapping.ProviderUsername, cancellation);
        }
        foreach (var membership in (await serverGroups.MembershipsAsync(cancellation)).Where(each => each.AccountId == account.Id))
        {
            await serverGroups.RemoveMembershipAsync(membership, cancellation);
        }
        await accounts.DeleteAsync(account.Id, cancellation);
        // Who sees what, groups whose owner left, and invites are worked out again without them.
        await sharing.LoadAsync(entities, (await accounts.ListAsync(cancellation)).Select(each => each.Id), cancellation);
        await groups.SettleAsync(cancellation);
        await invites.SettleAsync(cancellation);
        await serverGroupProjection.ProjectAsync(cancellation);
        audit.RecordSystem("admin.user-removed", detail: $"{account.Username}, {writes.Count} things deleted");
        logger.LogWarning("Removed the deleted account {Username} for good ({Count} things deleted)", account.Username, writes.Count);
    }
}
