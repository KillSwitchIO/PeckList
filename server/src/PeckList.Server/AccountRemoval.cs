using System.Text.Json.Nodes;
using PeckList.Core.Accounts;
using PeckList.Core.Configuration;
using PeckList.Core.Sharing;
using PeckList.Core.Storage;
using PeckList.Core.Sync;
using PeckList.Server.Audit;

namespace PeckList.Server;

/// <summary>
/// Removes deleted accounts for good once their grace period is over (spec: Users, delete with grace
/// period and restore), checking every hour: friendships end; everything the person owns is deleted
/// (devices hear of it like any deletion), and so is their place on lists and in groups others own;
/// provider links and server group memberships go; then the account itself. Shared lists and groups go to the next person in them first (audit B4), and
/// what is inside them stays: removing one person must not take the others' work with it.
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
    Core.Notifications.INotificationStore notifications,
    Core.History.ITaskHistoryStore history,
    Core.Accounts.IApiKeyStore apiKeys,
    Core.Accounts.IPasskeyStore passkeys,
    Core.Push.IPushStore push,
    Core.Supporters.SupporterKeys supporterKeys,
    LiveSettings live,
    TimeProvider time,
    ILogger<AccountRemoval> logger)
    : PeriodicService("Removing deleted accounts", TimeSpan.FromSeconds(30), TimeSpan.FromHours(1), time, logger)
{
    // One removal at a time: the hourly sweep and an admin's "delete now" may meet.
    private readonly SemaphoreSlim removing = new(1, 1);

    /// <summary>When a deleted account goes for good.</summary>
    public DateTimeOffset RemovedAt(Account account) => account.DeletedAt!.Value.AddDays(live.Current.AccountDeleteGraceDays);

    protected override Task RunAsync(CancellationToken stopping) => RemoveDueAsync(stopping);

    /// <summary>Remove every deleted account whose grace period is over; how many went.</summary>
    public async Task<int> RemoveDueAsync(CancellationToken cancellation = default)
    {
        await sharing.Loaded.WaitAsync(cancellation);
        await removing.WaitAsync(cancellation);
        try
        {
            var now = Time.GetUtcNow();
            var due = (await accounts.ListAsync(cancellation)).Where(account => account.DeletedAt is not null && RemovedAt(account) <= now).ToList();
            foreach (var account in due) await RemoveAsync(account, cancellation);
            return due.Count;
        }
        finally
        {
            removing.Release();
        }
    }

    /// <summary>
    /// Remove one deleted account for good now, without waiting out its grace period (an admin's
    /// "delete now"). False when it is gone already or was never deleted.
    /// </summary>
    public async Task<bool> RemoveNowAsync(string accountId, CancellationToken cancellation = default)
    {
        await sharing.Loaded.WaitAsync(cancellation);
        await removing.WaitAsync(cancellation);
        try
        {
            if (await accounts.FindByIdAsync(accountId, cancellation) is not { DeletedAt: not null } account) return false;
            await RemoveAsync(account, cancellation);
            return true;
        }
        finally
        {
            removing.Release();
        }
    }

    private async Task RemoveAsync(Account account, CancellationToken cancellation)
    {
        foreach (var (_, other, _) in sharing.Index.FriendshipsOf(account.Id))
        {
            await friends.EndFriendshipAsync(account.Id, other, cancellation);
        }
        var handed = await HandOnAsync(account, cancellation);
        var index = sharing.Index;
        var keptLists = index.LiveOf("lists").Where(list => list.Owner != account.Id).Select(list => list.Id).ToHashSet(StringComparer.Ordinal);
        var keptGroups = index.LiveOf("groups").Where(group => (string?)group.Doc["ownerId"] != account.Id).Select(group => group.Id).ToHashSet(StringComparer.Ordinal);
        string? ListOfTask(JsonNode? taskId) => (string?)taskId is { } id ? (string?)index.DocOf(id)?["listId"] : null;
        // What this person made inside a list or group someone else has now stays theirs to keep;
        // only the person's own place in it goes.
        bool Kept(StoredEntity entity) => entity.Collection switch
        {
            "tasks" or "sections" => (string?)entity.Doc["listId"] is { } list && keptLists.Contains(list),
            "comments" or "attachments" => ListOfTask(entity.Doc["taskId"]) is { } list && keptLists.Contains(list),
            "listMembers" => (string?)entity.Doc["listId"] is { } list && keptLists.Contains(list) && (string?)entity.Doc["principal"] != $"user:{account.Id}",
            "groupMembers" => (string?)entity.Doc["groupId"] is { } group && keptGroups.Contains(group) && (string?)entity.Doc["userId"] != account.Id,
            _ => false,
        };
        // The person's place on lists and in groups others own: the row belongs to whoever added
        // them, so it would stay behind, still naming them to everyone else there (QA pass 6).
        bool Theirs(StoredEntity entity) => entity.OwnerId == account.Id || entity.Collection switch
        {
            "listMembers" => (string?)entity.Doc["principal"] == $"user:{account.Id}",
            "groupMembers" => (string?)entity.Doc["userId"] == account.Id,
            _ => false,
        };
        var writes = new List<IncomingEntity>();
        await foreach (var entity in entities.AllAsync(cancellation))
        {
            if (!Theirs(entity) || entity.Doc["deletedAt"] is not null || Kept(entity)) continue;
            writes.Add(new IncomingEntity(entity.Collection, ServerEntities.Tombstone(entity.Id, clock)));
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
        await notifications.DeleteAsync(account.Id, null, cancellation);
        await history.ForgetActorAsync(account.Id, cancellation);
        await apiKeys.DeleteForUserAsync(account.Id, cancellation);
        await passkeys.DeleteAllAsync(account.Id, cancellation);
        await push.RemoveUserAsync(account.Id, cancellation);
        await supporterKeys.RemoveAsync(account.Id, cancellation);
        await accounts.DeleteAsync(account.Id, cancellation);
        // Who sees what, groups whose owner left, and invites are worked out again without them.
        await sharing.LoadAsync(entities, (await accounts.ListAsync(cancellation)).Select(each => each.Id), cancellation);
        await groups.SettleAsync(cancellation);
        await invites.SettleAsync(cancellation);
        await serverGroupProjection.ProjectAsync(cancellation);
        audit.RecordSystem("admin.user-removed", detail: $"{account.Username}, {writes.Count} things deleted, {handed} shared lists and groups handed on");
        Logger.LogWarning("Removed the deleted account {Username} for good ({Count} things deleted, {Handed} handed on)", account.Username, writes.Count, handed);
    }

    /// <summary>
    /// Shared lists and groups the person owns go to the next person in each (see
    /// <see cref="SharingIndex.ListHeir"/>); ones nobody else is in are deleted with the rest.
    /// </summary>
    private async Task<int> HandOnAsync(Account account, CancellationToken cancellation)
    {
        var others = (await accounts.ListAsync(cancellation))
            .Where(each => each.Id != account.Id && each.DeletedAt is null)
            .Select(each => each.Id)
            .ToHashSet(StringComparer.Ordinal);
        var handed = 0;
        foreach (var share in sharing.Index.SharedOwnedBy(account.Id))
        {
            var heir = share.Kind == "list"
                ? sharing.Index.ListHeir(share.Id, account.Id, others)
                : sharing.Index.GroupHeir(share.Id, account.Id, others);
            if (heir is null) continue;
            var changed = ServerEntities.Changed(share.Doc, clock.Next(), new JsonObject { ["ownerId"] = heir });
            await sync.WriteAsServerAsync(heir, [new IncomingEntity(share.Kind == "list" ? "lists" : "groups", changed) { Owner = heir }], cancellation);
            handed++;
        }
        return handed;
    }
}
