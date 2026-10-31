using System.Text.Json.Nodes;
using Punchlist.Core.Sharing;
using Punchlist.Core.Storage;

namespace Punchlist.Core.Tests;

/// <summary>
/// A write's visibility plan comes from the entities that depend on what it wrote (audit P2), not
/// from comparing every person's whole view. Whatever is written, it must give exactly the grants
/// and revocations that comparing whole views gives.
/// </summary>
public sealed class SharingPlanTests
{
    private static readonly string[] Users = ["UA", "UB", "UC", "UD"];

    private static StoredEntity Entity(string collection, string id, string owner, JsonObject fields, bool deleted = false)
    {
        fields["id"] = id;
        fields["deletedAt"] = deleted ? "2026-10-21T12:00:00.000Z" : null;
        fields["_hlc"] = new JsonObject();
        return new StoredEntity(collection, id, owner, 0, fields);
    }

    /// <summary>The plan as whole views see it: every person's view before and after, compared.</summary>
    private static HashSet<(string, string)> Brute(SharingIndex before, SharingIndex after, IEnumerable<string> people, bool grants)
    {
        var found = new HashSet<(string, string)>();
        foreach (var user in people)
        {
            var had = before.VisibleTo(user);
            var has = after.VisibleTo(user);
            foreach (var id in grants ? has.Except(had) : had.Except(has)) found.Add((user, id));
        }
        return found;
    }

    [Theory]
    [InlineData(1)]
    [InlineData(2)]
    [InlineData(3)]
    [InlineData(4)]
    public void A_plan_from_dependents_matches_comparing_whole_views(int seed)
    {
        var random = new Random(seed);
        var index = new SharingIndex();
        var ids = new List<(string Collection, string Id)>();
        string Pick(params string[] options) => options[random.Next(options.Length)];
        string? Any(string collection)
        {
            var found = ids.Where(each => each.Collection == collection).ToList();
            return found.Count == 0 ? null : found[random.Next(found.Count)].Id;
        }
        var next = 0;
        string NewId(string prefix) => $"{prefix}{++next:D4}";
        JsonObject Set(string principal) => new() { [principal] = new JsonObject { ["in"] = random.Next(4) > 0, ["hlc"] = "x" } };
        string Principal() => random.Next(4) == 0 && Any("groups") is { } group ? $"group:{group}" : $"user:{Pick(Users)}";
        foreach (var user in Users) index.Apply(Entity("users", user, user, new JsonObject { ["displayName"] = user }));

        for (var step = 0; step < 400; step++)
        {
            var owner = Pick(Users);
            var gone = random.Next(10) == 0;
            StoredEntity? written = random.Next(14) switch
            {
                0 => Entity("lists", Any("lists") is { } list && random.Next(2) == 0 ? list : NewId("L"), owner,
                    new JsonObject { ["name"] = "l", ["visibility"] = Pick("private", "shared") }, gone),
                1 when Any("lists") is { } list => Entity("listMembers", Any("listMembers") is { } row && random.Next(3) == 0 ? row : NewId("M"), owner,
                    new JsonObject { ["listId"] = list, ["principal"] = Principal(), ["role"] = Pick("owner", "editor", "viewer") }, gone),
                2 or 3 => Entity("tasks", Any("tasks") is { } task && random.Next(2) == 0 ? task : NewId("T"), owner, new JsonObject
                {
                    ["listId"] = random.Next(5) == 0 ? null : Any("lists") ?? "LMISSING",
                    ["parentId"] = random.Next(3) == 0 ? Any("tasks") : null,
                    ["assignees"] = random.Next(2) == 0 ? Set(Principal()) : new JsonObject(),
                }, gone),
                4 when Any("tasks") is { } task => Entity(Pick("comments", "attachments"), NewId("C"), owner,
                    new JsonObject { ["taskId"] = random.Next(6) == 0 ? "TMISSING" : task, ["sha256"] = "abc" }, gone),
                5 => Entity("groups", Any("groups") is { } group && random.Next(2) == 0 ? group : NewId("G"), owner,
                    new JsonObject { ["ownerId"] = Pick(Users), ["archived"] = random.Next(5) == 0 }, gone),
                6 or 7 when Any("groups") is { } group => Entity("groupMembers", Any("groupMembers") is { } row && random.Next(3) == 0 ? row : NewId("GM"), owner,
                    new JsonObject { ["groupId"] = group, ["userId"] = Pick(Users), ["state"] = Pick("invited", "active", "invited") }, gone),
                8 => Entity("friendships", Any("friendships") is { } friendship && random.Next(2) == 0 ? friendship : NewId("F"), owner,
                    new JsonObject { ["userA"] = Pick(Users), ["userB"] = Pick(Users), ["state"] = Pick("pending", "accepted") }, gone),
                9 when Any("lists") is { } list => Entity("sections", NewId("S"), owner, new JsonObject { ["listId"] = list }, gone),
                10 => Entity("tags", NewId("TG"), owner, new JsonObject { ["name"] = "t" }, gone),
                11 when Any("tasks") is { } task => Entity("tasks", task, owner, new JsonObject
                {
                    ["listId"] = Any("lists"), ["parentId"] = Any("tasks"), ["assignees"] = Set(Principal()),
                }),
                12 => Entity("users", Pick(Users), owner, new JsonObject { ["displayName"] = "renamed" }),
                _ => null,
            };
            if (written is null) continue;
            if (!ids.Any(each => each.Id == written.Id)) ids.Add((written.Collection, written.Id));
            var before = index;
            var after = before.Clone();
            after.Apply(written);

            var plan = SharingState.Plan(before, after, [written]);
            Assert.True(Brute(before, after, Users, grants: true).SetEquals(plan.Grants),
                $"step {step}, {written.Collection} {written.Id}: grants differ");
            Assert.True(Brute(before, after, Users, grants: false).SetEquals(plan.Revokes),
                $"step {step}, {written.Collection} {written.Id}: revocations differ");
            // The copy took the change; the index it came from did not.
            Assert.True(before.DocOf(written.Id) is null || !ReferenceEquals(before.DocOf(written.Id), written.Doc));
            index = after;
        }
        Assert.Contains(Users, user => index.VisibleTo(user).Any(id => id.StartsWith('T')));
    }

    [Fact]
    public void An_index_built_at_once_answers_like_one_built_entity_by_entity()
    {
        var entities = new List<StoredEntity>
        {
            Entity("lists", "L1", "UA", new JsonObject { ["visibility"] = "shared" }),
            Entity("groups", "G1", "UB", new JsonObject { ["ownerId"] = "UB" }),
            Entity("groupMembers", "GM1", "UB", new JsonObject { ["groupId"] = "G1", ["userId"] = "UC", ["state"] = "active" }),
            Entity("listMembers", "M1", "UA", new JsonObject { ["listId"] = "L1", ["principal"] = "group:G1", ["role"] = "editor" }),
            Entity("tasks", "T1", "UA", new JsonObject { ["listId"] = "L1", ["assignees"] = new JsonObject() }),
            Entity("tasks", "T2", "UA", new JsonObject { ["listId"] = null, ["parentId"] = "T1", ["assignees"] = new JsonObject { ["user:UD"] = new JsonObject { ["in"] = true, ["hlc"] = "x" } } }),
            Entity("comments", "C1", "UC", new JsonObject { ["taskId"] = "T1" }),
        };
        var built = SharingIndex.Build(entities);
        var applied = new SharingIndex();
        foreach (var entity in entities) applied.Apply(entity);
        foreach (var user in Users)
        {
            Assert.Equal(applied.VisibleTo(user).Order(), built.VisibleTo(user).Order());
        }
        Assert.Equal(["UA", "UB", "UC"], built.Viewers("C1").Order());
    }
}
