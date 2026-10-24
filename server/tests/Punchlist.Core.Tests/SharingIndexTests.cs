using System.Text.Json.Nodes;
using Punchlist.Core.Sharing;
using Punchlist.Core.Storage;

namespace Punchlist.Core.Tests;

public sealed class SharingIndexTests
{
    private const string Ben = "UBEN", Sam = "USAM", Jo = "UJO", Kim = "UKIM";
    private readonly SharingIndex index = new();

    private StoredEntity Put(string collection, string id, string owner, JsonObject fields)
    {
        fields["id"] = id;
        fields["deletedAt"] ??= null;
        fields["_hlc"] = new JsonObject();
        var entity = new StoredEntity(collection, id, owner, 0, fields);
        index.Apply(entity);
        return entity;
    }

    private StoredEntity List(string id, string owner, string visibility = "private") =>
        Put("lists", id, owner, new JsonObject { ["name"] = id, ["visibility"] = visibility });

    private StoredEntity Member(string id, string owner, string list, string principal, string role) =>
        Put("listMembers", id, owner, new JsonObject { ["listId"] = list, ["principal"] = principal, ["role"] = role });

    private static JsonObject Set(params string[] members)
    {
        var set = new JsonObject();
        foreach (var member in members) set[member] = new JsonObject { ["in"] = true, ["hlc"] = "2026-10-21T10:00:00.000Z-0000-a" };
        return set;
    }

    private StoredEntity Task(string id, string owner, string list, string? parent = null, JsonObject? assignees = null) =>
        Put("tasks", id, owner, new JsonObject
        {
            ["title"] = id,
            ["listId"] = list,
            ["parentId"] = parent,
            ["assignees"] = assignees ?? new JsonObject(),
        });

    private StoredEntity Group(string id, string owner) => Put("groups", id, owner, new JsonObject { ["name"] = id, ["ownerId"] = owner });

    private StoredEntity GroupMember(string id, string owner, string group, string user, string state) =>
        Put("groupMembers", id, owner, new JsonObject { ["groupId"] = group, ["userId"] = user, ["state"] = state });

    private StoredEntity Friendship(string id, string a, string b, string state) =>
        Put("friendships", id, a, new JsonObject { ["userA"] = a, ["userB"] = b, ["state"] = state });

    private static StoredEntity With(StoredEntity entity, Action<JsonObject> change)
    {
        var doc = (JsonObject)entity.Doc.DeepClone();
        change(doc);
        return entity with { Doc = doc };
    }

    /// <summary>Would <paramref name="user"/> be allowed to write <paramref name="after"/>?</summary>
    private bool May(string user, StoredEntity? before, StoredEntity after)
    {
        var trial = index.Clone();
        trial.Apply(after);
        return trial.MayWrite(user, before, after, index);
    }

    [Fact]
    public void A_private_list_is_its_owners_alone()
    {
        List("L1", Ben);
        Task("T1", Ben, "L1");
        Put("sections", "S1", Ben, new JsonObject { ["listId"] = "L1" });
        Put("tags", "G1", Ben, new JsonObject { ["name"] = "home" });
        Assert.Equal(["G1", "L1", "S1", "T1"], index.VisibleTo(Ben).Order());
        Assert.Empty(index.VisibleTo(Sam));
    }

    [Fact]
    public void A_shared_list_reaches_its_members_with_their_roles()
    {
        List("L1", Ben, "shared");
        Member("M1", Ben, "L1", $"user:{Sam}", "editor");
        Member("M2", Ben, "L1", $"user:{Jo}", "viewer");
        var task = Task("T1", Ben, "L1");

        Assert.Contains("T1", index.VisibleTo(Sam));
        Assert.Contains("M2", index.VisibleTo(Sam));
        Assert.Contains("T1", index.VisibleTo(Jo));
        Assert.DoesNotContain("T1", index.VisibleTo(Kim));

        var renamed = With(task, doc => doc["title"] = "Renamed");
        Assert.True(May(Sam, task, renamed));
        Assert.False(May(Jo, task, renamed));
        Assert.True(May(Sam, null, Task("T2", Sam, "L1")));
        Assert.False(May(Jo, null, Task("T3", Jo, "L1")));
    }

    [Fact]
    public void Making_a_list_private_shuts_members_out()
    {
        var list = List("L1", Ben, "shared");
        Member("M1", Ben, "L1", $"user:{Sam}", "editor");
        Task("T1", Ben, "L1");
        Assert.Contains("T1", index.VisibleTo(Sam));

        var made = With(list, doc => doc["visibility"] = "private");
        Assert.False(May(Sam, list, made));
        Assert.True(May(Ben, list, made));
        index.Apply(made);
        Assert.DoesNotContain("T1", index.VisibleTo(Sam));
        Assert.DoesNotContain("L1", index.VisibleTo(Sam));
    }

    [Fact]
    public void Only_list_owners_add_members_and_anyone_may_leave()
    {
        List("L1", Ben, "shared");
        var sam = Member("M1", Ben, "L1", $"user:{Sam}", "editor");
        Assert.False(May(Sam, null, new StoredEntity("listMembers", "M2", Sam, 0, new JsonObject
        {
            ["id"] = "M2", ["listId"] = "L1", ["principal"] = $"user:{Kim}", ["role"] = "editor", ["deletedAt"] = null, ["_hlc"] = new JsonObject(),
        })));
        Assert.False(May(Sam, sam, With(sam, doc => doc["role"] = "owner")));
        Assert.True(May(Sam, sam, With(sam, doc => doc["deletedAt"] = "2026-10-21T12:00:00.000Z")));
        Assert.True(May(Ben, sam, With(sam, doc => doc["role"] = "viewer")));
    }

    [Fact]
    public void An_assignee_sees_only_that_task_and_its_subtasks()
    {
        List("L1", Ben);
        var assigned = Task("T1", Ben, "L1", assignees: Set($"user:{Sam}"));
        Task("T2", Ben, "L1", parent: "T1");
        Task("T3", Ben, "L1");
        Assert.Equal(["T1", "T2"], index.VisibleTo(Sam).Order());
        Assert.True(May(Sam, assigned, With(assigned, doc => doc["title"] = "Done by Sam")));
        // Moving it into the private list of someone else is not Sam's to do.
        List("L2", Kim);
        Assert.False(May(Sam, assigned, With(assigned, doc => doc["listId"] = "L2")));
    }

    [Fact]
    public void Groups_share_with_active_members_and_show_invites()
    {
        Group("G1", Ben);
        GroupMember("GM1", Ben, "G1", Sam, "active");
        var jo = GroupMember("GM2", Ben, "G1", Jo, "invited");
        List("L1", Ben, "shared");
        Member("M1", Ben, "L1", "group:G1", "editor");
        Task("T1", Ben, "L1");
        List("L2", Ben);
        Task("T2", Ben, "L2", assignees: Set("group:G1"));

        Assert.Contains("T1", index.VisibleTo(Sam));
        Assert.Contains("T2", index.VisibleTo(Sam));
        // The invited see the group (to accept it), not its lists or tasks yet.
        Assert.Contains("G1", index.VisibleTo(Jo));
        Assert.DoesNotContain("T1", index.VisibleTo(Jo));
        Assert.DoesNotContain("T2", index.VisibleTo(Jo));

        Assert.True(May(Jo, jo, With(jo, doc => doc["state"] = "active")));
        Assert.False(May(Sam, jo, With(jo, doc => doc["state"] = "active")));
    }

    [Fact]
    public void Only_the_group_owner_runs_the_group()
    {
        var group = Group("G1", Ben);
        GroupMember("GM1", Ben, "G1", Sam, "active");
        Assert.False(May(Sam, group, With(group, doc => doc["name"] = "Mine now")));
        Assert.True(May(Ben, group, With(group, doc => doc["ownerId"] = Sam)));
        Assert.False(May(Sam, null, new StoredEntity("groupMembers", "GM2", Sam, 0, new JsonObject
        {
            ["id"] = "GM2", ["groupId"] = "G1", ["userId"] = Kim, ["state"] = "invited", ["deletedAt"] = null, ["_hlc"] = new JsonObject(),
        })));
    }

    [Fact]
    public void Friend_requests_go_one_way()
    {
        var request = new StoredEntity("friendships", "F1", Ben, 0, new JsonObject
        {
            ["id"] = "F1", ["userA"] = Ben, ["userB"] = Sam, ["state"] = "pending", ["deletedAt"] = null, ["_hlc"] = new JsonObject(),
        });
        Assert.True(May(Ben, null, request));
        Assert.False(May(Sam, null, request));
        Assert.False(May(Ben, null, With(request, doc => doc["state"] = "accepted")));
        index.Apply(request);

        Assert.Contains("F1", index.VisibleTo(Sam));
        Assert.DoesNotContain("F1", index.VisibleTo(Kim));
        var accepted = With(request, doc => doc["state"] = "accepted");
        Assert.False(May(Ben, request, accepted));
        Assert.True(May(Sam, request, accepted));
        Assert.True(May(Ben, request, With(request, doc => doc["deletedAt"] = "2026-10-21T12:00:00.000Z")));
        Assert.False(May(Kim, request, With(request, doc => doc["deletedAt"] = "2026-10-21T12:00:00.000Z")));
    }

    [Fact]
    public void Profiles_reach_friends_and_mates_only()
    {
        Put("users", Ben, Ben, new JsonObject { ["displayName"] = "Ben" });
        Friendship("F1", Ben, Sam, "pending");
        Group("G1", Jo);
        GroupMember("GM1", Jo, "G1", Ben, "active");
        Assert.Contains(Ben, index.VisibleTo(Sam));
        Assert.Contains(Ben, index.VisibleTo(Jo));
        Assert.DoesNotContain(Ben, index.VisibleTo(Kim));
        var profile = new StoredEntity("users", Ben, Ben, 0, new JsonObject { ["id"] = Ben, ["_hlc"] = new JsonObject() });
        Assert.True(May(Ben, profile, profile));
        Assert.False(May(Sam, profile, profile));
    }

    [Fact]
    public void Personal_things_stay_personal()
    {
        var tag = Put("tags", "G1", Ben, new JsonObject { ["name"] = "home" });
        Put("settings", "ST1", Ben, new JsonObject { ["userId"] = Ben });
        List("L1", Ben, "shared");
        Member("M1", Ben, "L1", $"user:{Sam}", "owner");
        Assert.DoesNotContain("G1", index.VisibleTo(Sam));
        Assert.DoesNotContain("ST1", index.VisibleTo(Sam));
        Assert.False(May(Sam, tag, With(tag, doc => doc["name"] = "mine")));
    }

    [Fact]
    public void Tombstones_still_reach_the_people_who_saw_them()
    {
        List("L1", Ben, "shared");
        Member("M1", Ben, "L1", $"user:{Sam}", "editor");
        var task = Task("T1", Ben, "L1");
        index.Apply(With(task, doc => doc["deletedAt"] = "2026-10-21T12:00:00.000Z"));
        Assert.Contains("T1", index.VisibleTo(Sam));
    }
}
