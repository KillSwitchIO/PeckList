using System.Text.Json.Nodes;
using Punchlist.Core.Storage;
using Punchlist.Core.Sync;

namespace Punchlist.Core.Sharing;

/// <summary>
/// Group succession (spec: Sharing &amp; Permissions, Groups). Only a group's owner may change it, so
/// when the owner leaves the server hands it on: to the longest-standing member, or, with nobody
/// left, it archives the group and takes it off the tasks assigned to it.
/// </summary>
public sealed class Groups(SyncService sync, SharingState sharing, ServerClock clock)
{
    /// <summary>Settle every group whose owner has left. Returns how many were settled.</summary>
    public async Task<int> SettleAsync(CancellationToken cancellation = default)
    {
        var settled = 0;
        foreach (var succession in sharing.Index.PendingSuccessions())
        {
            var stamp = clock.Next();
            var change = succession.NewOwner is { } heir ? new JsonObject { ["ownerId"] = heir } : new JsonObject { ["archived"] = true };
            var writes = new List<IncomingEntity>
            {
                new("groups", ServerEntities.Changed(succession.Group, stamp, change)),
            };
            foreach (var (id, doc) in succession.AssignedTasks)
            {
                var removal = new JsonObject
                {
                    ["id"] = id,
                    ["assignees"] = new JsonObject
                    {
                        [$"group:{succession.GroupId}"] = new JsonObject { ["in"] = false, ["hlc"] = stamp },
                    },
                    ["_hlc"] = new JsonObject(),
                };
                writes.Add(new IncomingEntity("tasks", Merge.Entity((JsonObject)doc.DeepClone(), removal, WorkspaceSchema.ElementSetFields("tasks"))));
            }
            // The group stays its creator's entity; the server only changes fields on it.
            await sync.WriteAsServerAsync((string?)succession.Group["createdBy"] ?? succession.NewOwner ?? "", writes, cancellation);
            settled++;
        }
        return settled;
    }
}
