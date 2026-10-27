using System.Text.Json.Nodes;
using Punchlist.Core.Accounts;
using Punchlist.Core.Storage;
using Punchlist.Core.Sync;

namespace Punchlist.Core.Sharing;

/// <summary>
/// Server groups "offered for sharing" in the app (spec: Roles and server groups): each becomes an
/// ordinary group with a membership per member, owned by the server, so the share and assignee
/// pickers and the sharing rules treat it like a group people make. Members cannot leave it or
/// change it (the server owns it), and it never passes to an heir. Run after anything that changes
/// server groups, their members or accounts; it writes only the difference.
/// </summary>
public sealed class ServerGroupProjection(IServerGroupStore store, IAccountStore accounts, SyncService sync, SharingState sharing, ServerClock clock)
{
    /// <summary>The owner of server groups in the app: an id no account has.</summary>
    public const string Owner = "00000000000000000000SERVER";

    /// <summary>Server groups show in a quiet grey.</summary>
    public const string Color = "#6B7280";

    /// <summary>Bring the app's copies in line with the server groups; how many entities changed.</summary>
    public async Task<int> ProjectAsync(CancellationToken cancellation = default)
    {
        var offered = (await store.ListAsync(cancellation)).Where(group => group.OfferedForSharing).ToDictionary(group => group.Id);
        var members = (await store.MembershipsAsync(cancellation))
            .GroupBy(membership => membership.GroupId)
            .ToDictionary(group => group.Key, group => group.Select(membership => membership.AccountId).ToHashSet(StringComparer.Ordinal));
        var people = (await accounts.ListAsync(cancellation))
            .Where(account => account.DeletedAt is null)
            .Select(account => account.Id)
            .ToHashSet(StringComparer.Ordinal);
        var index = sharing.Index;
        var writes = new List<IncomingEntity>();

        // Taken off sharing or deleted: the group and its memberships go.
        foreach (var (id, _) in index.GroupsOwnedBy(Owner))
        {
            if (offered.ContainsKey(id)) continue;
            writes.Add(Removed("groups", id));
            foreach (var (rowId, row) in index.MembershipRowsOf(id))
            {
                if (row["deletedAt"] is null) writes.Add(Removed("groupMembers", rowId));
            }
        }

        foreach (var group in offered.Values)
        {
            var existing = index.DocOf(group.Id);
            if (existing is null)
            {
                writes.Add(new IncomingEntity("groups", Entity(group.Id, new JsonObject
                {
                    ["name"] = group.Name,
                    ["color"] = Color,
                    ["ownerId"] = Owner,
                    ["archived"] = false,
                })));
            }
            else if (existing["deletedAt"] is not null || (string?)existing["name"] != group.Name || (string?)existing["ownerId"] != Owner)
            {
                writes.Add(Changed("groups", group.Id, new JsonObject { ["name"] = group.Name, ["deletedAt"] = null, ["archived"] = false }));
            }

            var wanted = members.GetValueOrDefault(group.Id) ?? [];
            wanted.IntersectWith(people);
            var rows = index.MembershipRowsOf(group.Id);
            foreach (var userId in wanted)
            {
                var mine = rows.Where(each => (string?)each.Doc["userId"] == userId).ToList();
                if (mine.Any(each => each.Doc["deletedAt"] is null && (string?)each.Doc["state"] == "active")) continue;
                if (mine.FirstOrDefault() is { Id: { } rowId })
                {
                    writes.Add(Changed("groupMembers", rowId, new JsonObject { ["deletedAt"] = null, ["state"] = "active" }));
                }
                else
                {
                    writes.Add(new IncomingEntity("groupMembers", Entity(Ids.NewUlid(), new JsonObject
                    {
                        ["groupId"] = group.Id,
                        ["userId"] = userId,
                        ["joinedAt"] = clock.Now(),
                        ["state"] = "active",
                    })));
                }
            }
            foreach (var (rowId, row) in rows)
            {
                if (row["deletedAt"] is null && !wanted.Contains((string?)row["userId"] ?? "")) writes.Add(Removed("groupMembers", rowId));
            }
        }

        if (writes.Count > 0) await sync.WriteAsServerAsync(Owner, writes, cancellation);
        return writes.Count;
    }

    private JsonObject Entity(string id, JsonObject fields) => ServerEntities.New(id, Owner, "server", clock.Now(), clock.Next(), fields);

    private IncomingEntity Changed(string collection, string id, JsonObject fields) =>
        new(collection, ServerEntities.Change(id, clock.Next(), fields)) { Owner = Owner };

    private IncomingEntity Removed(string collection, string id) => Changed(collection, id, new JsonObject { ["deletedAt"] = clock.Now() });
}
