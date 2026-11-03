using System.Text.Json.Nodes;
using PeckList.Core.Storage;
using PeckList.Core.Sync;

namespace PeckList.Core.Sharing;

/// <summary>
/// An admin hands someone's shared lists and groups to another person (spec: Account management,
/// ownership), e.g. before an account is turned off. Members, tasks and assignments stay; the old
/// owner stays in as an editor (lists) or an active member (groups).
/// </summary>
public sealed class Ownership(SyncService sync, SharingState sharing, ServerClock clock)
{
    public IReadOnlyList<OwnedShare> SharedBy(string userId) => sharing.Index.SharedOwnedBy(userId);

    /// <summary>
    /// Hand over what <paramref name="from"/> owns and shares (only the ids in <paramref name="only"/>
    /// when given) to <paramref name="to"/>. Returns how many lists and groups moved.
    /// </summary>
    public async Task<int> HandOverAsync(string from, string to, IReadOnlyCollection<string>? only, CancellationToken cancellation = default)
    {
        if (from == to) return 0;
        var moved = 0;
        foreach (var share in sharing.Index.SharedOwnedBy(from))
        {
            if (only is not null && !only.Contains(share.Id)) continue;
            var stamp = clock.Next();
            var writes = new List<IncomingEntity>();
            if (share.Kind == "list")
            {
                writes.Add(new IncomingEntity("lists", ServerEntities.Changed(share.Doc, stamp, new JsonObject { ["ownerId"] = to })) { Owner = to });
                writes.Add(new IncomingEntity("listMembers", New(from, stamp, new JsonObject
                {
                    ["listId"] = share.Id,
                    ["principal"] = $"user:{from}",
                    ["role"] = "editor",
                })));
            }
            else
            {
                writes.Add(new IncomingEntity("groups", ServerEntities.Changed(share.Doc, stamp, new JsonObject { ["ownerId"] = to })));
                // The old owner was a member by ownership: now by a membership of their own.
                if (sharing.Index.GroupMembership(share.Id, from) is { } row)
                {
                    var active = ServerEntities.Changed(row.Doc, stamp, new JsonObject { ["state"] = "active", ["deletedAt"] = null });
                    writes.Add(new IncomingEntity("groupMembers", active));
                }
                else
                {
                    writes.Add(new IncomingEntity("groupMembers", New(from, stamp, new JsonObject
                    {
                        ["groupId"] = share.Id,
                        ["userId"] = from,
                        ["joinedAt"] = clock.Now(),
                        ["state"] = "active",
                    })));
                }
            }
            await sync.WriteAsServerAsync(to, writes, cancellation);
            moved++;
        }
        return moved;
    }

    private JsonObject New(string createdBy, string stamp, JsonObject fields) =>
        ServerEntities.New(Ids.NewUlid(), createdBy, "local", clock.Now(), stamp, fields);
}
