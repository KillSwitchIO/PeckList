using System.Text.Json.Nodes;
using PeckList.Core.Accounts;
using PeckList.Core.Sharing;
using PeckList.Core.Storage;
using PeckList.Core.Sync;

namespace PeckList.Server;

/// <summary>What starting over did: how many things it erased, and how many shared lists went on to the next person in each.</summary>
public sealed record StartedOver(int Erased, int HandedOn);

/// <summary>
/// Start over (spec: PL-147): a clean slate without a new account. The person's own tasks, lists,
/// sections, tags, folders, saved filters, comments and attachments are erased (tombstoned, so
/// every device hears of it), and their place on lists others own goes. Their account, sign-ins,
/// settings, profile, friends and groups stay, and so does their Inbox, emptied.
/// </summary>
/// <remarks>
/// Shared lists they own go to the next person in each first, as account removal does (audit B4),
/// with what is in them: someone else's list now, it is not the person's to erase. What they added
/// to lists others own stays there too, apart from their comments, which go everywhere. Then their
/// own epoch is renewed (<see cref="ServerEpoch.RenewForAsync"/>), so each of their devices drops
/// its copy and starts over from the server, and one that was offline cannot bring anything back.
/// </remarks>
public sealed class StartOver(
    IAccountStore accounts,
    IEntityStore entities,
    SyncService sync,
    SharingState sharing,
    ServerClock clock,
    ServerEpoch epoch,
    ILogger<StartOver> logger)
{
    /// <summary>What starting over erases of what the person owns.</summary>
    private static readonly HashSet<string> Erased = new(StringComparer.Ordinal)
    {
        "folders", "lists", "sections", "tags", "tasks", "comments", "attachments", "savedFilters", "listMembers",
    };

    // One at a time: two devices pressing it at once would hand on and erase twice over.
    private readonly SemaphoreSlim gate = new(1, 1);

    public async Task<StartedOver> RunAsync(Account account, CancellationToken cancellation)
    {
        await gate.WaitAsync(cancellation);
        try
        {
            // A new life first, so a device that has not heard yet pushes nothing more into what goes.
            await epoch.RenewForAsync(account.Id, cancellation);
            var handed = await HandOnAsync(account, cancellation);
            var index = sharing.Index;
            var othersLists = index.LiveOf("lists").Where(list => list.Owner != account.Id).Select(list => list.Id).ToHashSet(StringComparer.Ordinal);
            string? ListOfTask(JsonNode? taskId) => (string?)taskId is { } id ? (string?)index.DocOf(id)?["listId"] : null;
            var me = $"user:{account.Id}";
            // In a list someone else owns (theirs all along, or just handed on): stays there.
            bool InOthersList(StoredEntity entity) => entity.Collection switch
            {
                "tasks" or "sections" => (string?)entity.Doc["listId"] is { } list && othersLists.Contains(list),
                "attachments" => ListOfTask(entity.Doc["taskId"]) is { } list && othersLists.Contains(list),
                // Others' places on a list handed on stay; the person's own place goes.
                "listMembers" => (string?)entity.Doc["listId"] is { } list && othersLists.Contains(list) && (string?)entity.Doc["principal"] != me,
                _ => false,
            };
            bool Goes(StoredEntity entity) =>
                Erased.Contains(entity.Collection)
                // Their place on a list belongs to whoever added them, so it is not theirs by owner.
                && (entity.OwnerId == account.Id || (entity.Collection == "listMembers" && (string?)entity.Doc["principal"] == me))
                && !(entity.Collection == "lists" && entity.Doc["isInbox"] is JsonValue inbox && inbox.TryGetValue<bool>(out var isInbox) && isInbox)
                && !InOthersList(entity);
            var writes = new List<IncomingEntity>();
            await foreach (var entity in entities.AllAsync(cancellation))
            {
                if (entity.Doc["deletedAt"] is not null || !Goes(entity)) continue;
                writes.Add(new IncomingEntity(entity.Collection, ServerEntities.Tombstone(entity.Id, clock)));
            }
            if (writes.Count > 0) await sync.WriteAsServerAsync(account.Id, writes, cancellation);
            // Who sees what is worked out again: lists handed on, places left.
            await sharing.LoadAsync(entities, (await accounts.ListAsync(cancellation)).Select(each => each.Id), cancellation);
            // And again after, for a device that started over while this ran: it pulls the result.
            await epoch.RenewForAsync(account.Id, cancellation);
            logger.LogInformation("{Username} started over ({Count} things erased, {Handed} shared lists handed on)", account.Username, writes.Count, handed);
            return new StartedOver(writes.Count, handed);
        }
        finally
        {
            gate.Release();
        }
    }

    /// <summary>
    /// Shared lists the person owns go to the next person in each (<see cref="SharingIndex.ListHeir"/>),
    /// as when an account is removed; ones nobody else is in are erased with the rest. Groups stay theirs.
    /// </summary>
    private async Task<int> HandOnAsync(Account account, CancellationToken cancellation)
    {
        var others = (await accounts.ListAsync(cancellation))
            .Where(each => each.Id != account.Id && each.DeletedAt is null)
            .Select(each => each.Id)
            .ToHashSet(StringComparer.Ordinal);
        var handed = 0;
        foreach (var share in sharing.Index.SharedOwnedBy(account.Id).Where(share => share.Kind == "list"))
        {
            if (sharing.Index.ListHeir(share.Id, account.Id, others) is not { } heir) continue;
            var changed = ServerEntities.Changed(share.Doc, clock.Next(), new JsonObject { ["ownerId"] = heir });
            await sync.WriteAsServerAsync(heir, [new IncomingEntity("lists", changed) { Owner = heir }], cancellation);
            handed++;
        }
        return handed;
    }
}
