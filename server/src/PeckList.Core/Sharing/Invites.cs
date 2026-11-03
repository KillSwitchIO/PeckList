using System.Text.Json.Nodes;
using PeckList.Core.Storage;
using PeckList.Core.Sync;

namespace PeckList.Core.Sharing;

/// <summary>
/// Invite on assign (spec: Sharing &amp; Permissions, Friends): a task assigned to someone who is not a
/// friend yet waits as <c>invite:&lt;user&gt;:&lt;inviter&gt;</c>, which reaches nobody. When they accept
/// the friend request the server turns it into the real assignment; when they decline, it goes.
/// </summary>
public sealed class Invites(SyncService sync, SharingState sharing, ServerClock clock)
{
    public async Task<int> SettleAsync(CancellationToken cancellation = default)
    {
        var pending = sharing.Index.PendingInvites();
        if (pending.Count == 0) return 0;
        var stamp = clock.Next();
        var writes = new List<IncomingEntity>();
        foreach (var task in pending.GroupBy(each => each.TaskId))
        {
            var set = new JsonObject();
            foreach (var each in task)
            {
                set[each.Invite] = new JsonObject { ["in"] = false, ["hlc"] = stamp };
                if (each.Assignee is { } assignee) set[assignee] = new JsonObject { ["in"] = true, ["hlc"] = stamp };
            }
            var change = new JsonObject { ["id"] = task.Key, ["assignees"] = set, ["_hlc"] = new JsonObject() };
            writes.Add(new IncomingEntity("tasks", Merge.Entity((JsonObject)task.First().Task.DeepClone(), change, WorkspaceSchema.ElementSetFields("tasks"))));
        }
        foreach (var write in writes)
        {
            // Each task stays its creator's entity.
            await sync.WriteAsServerAsync((string?)write.Doc["createdBy"] ?? "", [write], cancellation);
        }
        return writes.Count;
    }
}
