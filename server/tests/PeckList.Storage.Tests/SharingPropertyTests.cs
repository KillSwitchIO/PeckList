using System.Text.Json.Nodes;
using PeckList.Core;
using PeckList.Core.Sharing;
using PeckList.Core.Storage;
using PeckList.Core.Sync;
using PeckList.Storage.Sql;

namespace PeckList.Storage.Tests;

/// <summary>
/// PL-044's acceptance test: whatever people do, every device ends up holding exactly what its user
/// may see. Random sharing moves (some of them not allowed) by three users go through the real sync
/// service on SQLite; each user keeps a replica built only from the change feed.
/// </summary>
public sealed class SharingPropertyTests(SqliteFiles files) : IClassFixture<SqliteFiles>
{
    private static readonly string[] Users = ["UA", "UB", "UC"];

    private sealed class Replica
    {
        public long? Cursor;
        public readonly Dictionary<string, (string Collection, JsonObject Doc)> Entities = [];
    }

    private sealed class Rig(SyncService sync, SharingState sharing)
    {
        public readonly Dictionary<string, Replica> Replicas = Users.ToDictionary(user => user, _ => new Replica());
        private int clock;

        public string Stamp() => $"2026-10-21T10:00:00.{++clock / 10000 % 1000:D3}Z-{clock % 10000:D4}-n1";

        public async Task SyncAsync(string user, params (string Collection, JsonObject Doc)[] changes)
        {
            var replica = Replicas[user];
            var push = changes.Select(change => new SyncEntity(change.Collection, change.Doc)).ToList();
            SyncResponse response;
            do
            {
                response = await sync.SyncAsync(user, new SyncRequest(WorkspaceSchema.CurrentVersion, replica.Cursor, push), cancellation: TestContext.Current.CancellationToken);
                foreach (var change in response.Changes) replica.Entities[(string)change.Entity["id"]!] = (change.Collection, change.Entity);
                foreach (var id in response.Revoked) replica.Entities.Remove(id);
                foreach (var id in response.Rejected) replica.Entities.Remove(id);
                foreach (var correction in response.Corrections) replica.Entities[(string)correction.Entity["id"]!] = (correction.Collection, correction.Entity);
                replica.Cursor = response.Cursor;
                push = [];
            } while (response.More);
        }

        public SharingIndex Index => sharing.Index;
    }

    private static JsonObject Doc(string id, string stamp, JsonObject fields)
    {
        fields["id"] = id;
        fields["deletedAt"] ??= null;
        var clocks = new JsonObject();
        foreach (var (field, _) in fields) if (field != "id") clocks[field] = stamp;
        fields["_hlc"] = clocks;
        return fields;
    }

    [Fact]
    public async Task Every_device_holds_exactly_what_its_user_may_see()
    {
        var database = await files.NewDatabaseAsync();
        var store = new SqlEntityStore(database);
        var sharing = new SharingState();
        await sharing.LoadAsync(store, Users, TestContext.Current.CancellationToken);
        var rig = new Rig(new SyncService(store, TimeProvider.System, new InProcessChangeNotifier(), sharing), sharing);
        var random = new Random(4401);
        var ids = new List<(string Collection, string Id)>();
        string Pick(params string[] options) => options[random.Next(options.Length)];
        string? Any(string collection)
        {
            var found = ids.Where(each => each.Collection == collection).ToList();
            return found.Count == 0 ? null : found[random.Next(found.Count)].Id;
        }
        var next = 0;
        string NewId(string prefix) => $"{prefix}{++next:D4}";

        for (var step = 0; step < 300; step++)
        {
            var actor = Pick(Users);
            var stamp = rig.Stamp();
            (string, JsonObject)? change = random.Next(9) switch
            {
                0 => ("lists", Doc(NewId("L"), stamp, new JsonObject { ["name"] = "list", ["visibility"] = Pick("private", "shared") })),
                1 when Any("lists") is { } list => ("lists", Doc(list, stamp, new JsonObject { ["visibility"] = Pick("private", "shared") })),
                2 when Any("lists") is { } list => ("listMembers", Doc(NewId("M"), stamp, new JsonObject
                {
                    ["listId"] = list,
                    ["principal"] = random.Next(5) == 0 && Any("groups") is { } group ? $"group:{group}" : $"user:{Pick(Users)}",
                    ["role"] = Pick("owner", "editor", "viewer"),
                })),
                3 when Any("listMembers") is { } member => ("listMembers", Doc(member, stamp, new JsonObject { ["deletedAt"] = "2026-10-21T12:00:00.000Z" })),
                4 when Any("lists") is { } list => ("tasks", Doc(NewId("T"), stamp, new JsonObject
                {
                    ["title"] = "task",
                    ["listId"] = list,
                    ["parentId"] = random.Next(3) == 0 ? Any("tasks") : null,
                    ["assignees"] = new JsonObject(),
                })),
                5 when Any("tasks") is { } task => ("tasks", Doc(task, stamp, new JsonObject
                {
                    ["assignees"] = new JsonObject
                    {
                        [random.Next(4) == 0 && Any("groups") is { } group ? $"group:{group}" : $"user:{Pick(Users)}"] =
                            new JsonObject { ["in"] = random.Next(3) > 0, ["hlc"] = stamp },
                    },
                })),
                6 => ("groups", Doc(NewId("G"), stamp, new JsonObject { ["name"] = "group", ["ownerId"] = actor })),
                7 when Any("groups") is { } group => ("groupMembers", Doc(NewId("GM"), stamp, new JsonObject
                {
                    ["groupId"] = group, ["userId"] = Pick(Users), ["state"] = Pick("invited", "active"),
                })),
                8 when Any("tasks") is { } task => ("tasks", Doc(task, stamp, new JsonObject { ["listId"] = Any("lists"), ["title"] = "moved" })),
                _ => null,
            };
            if (change is not { } made) continue;
            // Partial documents for existing ids: start from what the actor's device holds, if anything.
            if (rig.Replicas[actor].Entities.TryGetValue((string)made.Item2["id"]!, out var known))
            {
                var merged = (JsonObject)known.Doc.DeepClone();
                foreach (var (field, value) in made.Item2) if (field != "_hlc") merged[field] = value?.DeepClone();
                var clocks = (JsonObject)(merged["_hlc"] ?? new JsonObject());
                foreach (var (field, value) in (JsonObject)made.Item2["_hlc"]!) clocks[field] = value?.DeepClone();
                merged["_hlc"] = clocks;
                made = (made.Item1, merged);
            }
            if (!ids.Any(each => each.Id == (string)made.Item2["id"]!)) ids.Add((made.Item1, (string)made.Item2["id"]!));

            await rig.SyncAsync(actor, made);
            foreach (var user in Users) await rig.SyncAsync(user);
            foreach (var user in Users)
            {
                var expected = rig.Index.VisibleTo(user);
                var held = rig.Replicas[user].Entities.Keys.ToHashSet();
                Assert.True(expected.SetEquals(held),
                    $"step {step} ({actor} wrote {made.Item1} {made.Item2["id"]}): {user} holds [{string.Join(", ", held.Except(expected))}] it may not see, misses [{string.Join(", ", expected.Except(held))}]");
            }
        }
        // The run really shared things.
        Assert.Contains(Users, user => rig.Replicas[user].Entities.Values.Any(entity => entity.Collection == "tasks"));
    }
}
