using System.Text.Json.Nodes;
using Punchlist.Core.Storage;
using Punchlist.Core.Sync;

namespace Punchlist.Core.Sharing;

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
                writes.Add(new IncomingEntity("lists", Change(share.Doc, share.Id, "ownerId", to, stamp)) { Owner = to });
                writes.Add(new IncomingEntity("listMembers", New(from, stamp, new JsonObject
                {
                    ["listId"] = share.Id,
                    ["principal"] = $"user:{from}",
                    ["role"] = "editor",
                })));
            }
            else
            {
                writes.Add(new IncomingEntity("groups", Change(share.Doc, share.Id, "ownerId", to, stamp)));
                // The old owner was a member by ownership: now by a membership of their own.
                if (sharing.Index.GroupMembership(share.Id, from) is { } row)
                {
                    var active = Merge.Entity((JsonObject)row.Doc.DeepClone(), new JsonObject
                    {
                        ["id"] = row.Id,
                        ["state"] = "active",
                        ["deletedAt"] = null,
                        ["_hlc"] = new JsonObject { ["state"] = stamp, ["deletedAt"] = stamp },
                    }, []);
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

    private static JsonObject Change(JsonObject doc, string id, string field, string value, string stamp) =>
        Merge.Entity((JsonObject)doc.DeepClone(), new JsonObject
        {
            ["id"] = id,
            [field] = value,
            ["_hlc"] = new JsonObject { [field] = stamp },
        }, []);

    private JsonObject New(string createdBy, string stamp, JsonObject fields)
    {
        var entity = new JsonObject
        {
            ["id"] = Ids.NewUlid(),
            ["createdAt"] = clock.Now(),
            ["createdBy"] = createdBy,
            ["deletedAt"] = null,
            ["origin"] = "local",
        };
        foreach (var (field, value) in fields) entity[field] = value?.DeepClone();
        var clocks = new JsonObject();
        foreach (var (field, _) in entity) if (field != "id") clocks[field] = stamp;
        entity["_hlc"] = clocks;
        return entity;
    }
}
