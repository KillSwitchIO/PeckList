using Punchlist.Core.Sharing;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Punchlist.Core;
using Punchlist.Core.Accounts;
using Punchlist.Core.Sync;

namespace Punchlist.Server.Tests;

/// <summary>Sharing through the sync API: lists, roles, making private, assignment.</summary>
public sealed class SharingTests(ServerFixture fixture) : IClassFixture<ServerFixture>, IDisposable
{
    private readonly WebApplicationFactory<Program> factory =
        fixture.Factory(("ADMIN_PASSWORD", "correct horse battery"), ("DB_PATH", fixture.NewDbPath()));

    private static CancellationToken Token => TestContext.Current.CancellationToken;

    public void Dispose() => factory.Dispose();

    private sealed class Device(HttpClient client, string userId)
    {
        public string UserId { get; } = userId;
        public HttpClient Client => client;

        public async Task<NotificationFeed> NotificationsAsync() =>
            (await client.GetFromJsonAsync<NotificationFeed>("/api/notifications", Token))!;
        public long? Cursor { get; private set; }
        public Dictionary<string, JsonObject> Seen { get; } = [];

        /// <summary>Push changes, pull until caught up; keep what arrives like a client would.</summary>
        public async Task<SyncResponse> SyncAsync(params (string Collection, JsonObject Entity)[] changes)
        {
            SyncResponse? last = null;
            var push = changes.Select(change => new { collection = change.Collection, entity = change.Entity }).ToArray();
            do
            {
                var response = await client.PostAsJsonAsync("/api/sync", new { schemaVersion = WorkspaceSchema.CurrentVersion, cursor = Cursor, changes = push }, Token);
                response.EnsureSuccessStatusCode();
                last = (await response.Content.ReadFromJsonAsync<SyncResponse>(Token))!;
                foreach (var change in last.Changes) Seen[(string)change.Entity["id"]!] = change.Entity;
                foreach (var id in last.Revoked) Seen.Remove(id);
                foreach (var correction in last.Corrections) Seen[(string)correction.Entity["id"]!] = correction.Entity;
                Cursor = last.Cursor;
                push = [];
            } while (last.More);
            return last;
        }
    }

    private async Task<Device> SignIn(string username)
    {
        var accounts = factory.Services.GetRequiredService<AccountService>();
        const string password = "a long enough password";
        var account = await accounts.CreateUserAsync(username, password, mustChangePassword: false, cancellation: Token);
        var client = factory.CreateClient();
        (await client.PostAsJsonAsync("/auth/login", new { username, password }, Token)).EnsureSuccessStatusCode();
        return new Device(client, account.Id);
    }

    private static int clock;

    /// <summary>Stamp every field with a fresh clock (later calls win).</summary>
    private static JsonObject Entity(string id, JsonObject fields)
    {
        var stamp = $"2026-10-21T10:{Interlocked.Increment(ref clock) / 60 % 60:D2}:{clock % 60:D2}.000Z-0000-dev1";
        fields["id"] = id;
        fields["deletedAt"] ??= null;
        var clocks = new JsonObject();
        foreach (var (field, _) in fields) if (field != "id") clocks[field] = stamp;
        fields["_hlc"] = clocks;
        return fields;
    }

    private static (string, JsonObject) List(string id, string visibility) =>
        ("lists", Entity(id, new JsonObject { ["name"] = id, ["visibility"] = visibility }));

    private static (string, JsonObject) Member(string id, string list, string user, string role) =>
        ("listMembers", Entity(id, new JsonObject { ["listId"] = list, ["principal"] = $"user:{user}", ["role"] = role }));

    private static (string, JsonObject) Task(string id, string list, string title, string? assignee = null) =>
        ("tasks", Entity(id, new JsonObject
        {
            ["listId"] = list,
            ["title"] = title,
            ["parentId"] = null,
            ["assignees"] = assignee is null ? new JsonObject() : new JsonObject
            {
                [$"user:{assignee}"] = new JsonObject { ["in"] = true, ["hlc"] = "2026-10-21T11:00:00.000Z-0000-dev1" },
            },
        }));

    [Fact]
    public async Task Assigning_and_sharing_notify_the_other_person_who_can_read_and_clear_them()
    {
        var ben = await SignIn("ben-n");
        var sam = await SignIn("sam-n");
        await ben.SyncAsync(List("NL1", "shared"), Member("NM1", "NL1", sam.UserId, "editor"), Task("NT1", "NL1", "Mow", sam.UserId));

        var feed = await sam.NotificationsAsync();
        Assert.Equal(2, feed.Unread);
        Assert.Contains(feed.Items, each => each.Kind == "shared" && each.ListId == "NL1" && each.ActorId == ben.UserId);
        Assert.Contains(feed.Items, each => each.Kind == "assigned" && each.TaskId == "NT1" && each.ListId == "NL1");
        // Nobody hears about their own doing.
        Assert.Empty((await ben.NotificationsAsync()).Items);
        // The same assignment pushed again is no news.
        await ben.SyncAsync(Task("NT1", "NL1", "Mow the lawn", sam.UserId));
        Assert.Equal(2, (await sam.NotificationsAsync()).Items.Count);

        var assigned = feed.Items.Single(each => each.Kind == "assigned").Id;
        (await sam.Client.PostAsJsonAsync("/api/notifications/read", new { ids = new[] { assigned } }, Token)).EnsureSuccessStatusCode();
        feed = await sam.NotificationsAsync();
        Assert.Equal(1, feed.Unread);
        Assert.True(feed.Items.Single(each => each.Id == assigned).Read);
        (await sam.Client.PostAsJsonAsync("/api/notifications/clear", new { ids = (string[]?)null }, Token)).EnsureSuccessStatusCode();
        Assert.Empty((await sam.NotificationsAsync()).Items);
    }

    [Fact]
    public async Task An_at_mention_notifies_people_who_can_see_the_task_only()
    {
        var ben = await SignIn("ben-m");
        var sam = await SignIn("sam-m");
        var lee = await SignIn("lee-m");
        await ben.SyncAsync(List("ML1", "shared"), Member("MM1", "ML1", sam.UserId, "editor"), Task("MT1", "ML1", "Paint"));
        await sam.SyncAsync(("comments", Entity("MC1", new JsonObject
        {
            ["taskId"] = "MT1",
            ["body"] = "Which color, @ben-m? Ask @lee-m too",
            ["editedAt"] = null,
        })));

        var mention = Assert.Single((await ben.NotificationsAsync()).Items, each => each.Kind == "mentioned");
        Assert.Equal(("MT1", "MC1", sam.UserId), (mention.TaskId, mention.CommentId, mention.ActorId));
        // Lee cannot see the task, so the mention tells them nothing (and shows nothing of it).
        Assert.Empty((await lee.NotificationsAsync()).Items);
    }

    [Fact]
    public async Task A_comment_tells_everyone_else_who_can_see_the_task_and_so_does_an_edit()
    {
        var ben = await SignIn("ben-c");
        var sam = await SignIn("sam-c");
        var lee = await SignIn("lee-c");
        await ben.SyncAsync(List("CL1", "shared"), Member("CM1", "CL1", sam.UserId, "editor"), Task("CT1", "CL1", "Paint"));
        await sam.SyncAsync(("comments", Entity("CC1", new JsonObject
        {
            ["taskId"] = "CT1",
            ["body"] = "Blue?",
            ["editedAt"] = null,
        })));

        var comment = Assert.Single((await ben.NotificationsAsync()).Items, each => each.Kind == "commented");
        Assert.Equal(("CT1", "CC1", sam.UserId), (comment.TaskId, comment.CommentId, comment.ActorId));
        Assert.DoesNotContain((await sam.NotificationsAsync()).Items, each => each.Kind == "commented");
        Assert.Empty((await lee.NotificationsAsync()).Items);

        // Changing the words tells them again; pushing it unchanged does not.
        await sam.SyncAsync(("comments", Entity("CC1", new JsonObject
        {
            ["taskId"] = "CT1",
            ["body"] = "Green, actually",
            ["editedAt"] = "2026-10-21T12:00:00.000Z",
        })));
        Assert.Single((await ben.NotificationsAsync()).Items, each => each.Kind == "commentEdited");
    }

    [Fact]
    public async Task A_task_keeps_its_history_for_those_who_can_see_it()
    {
        var ben = await SignIn("ben-h");
        var sam = await SignIn("sam-h");
        var lee = await SignIn("lee-h");
        await ben.SyncAsync(List("HL1", "shared"), Member("HM1", "HL1", sam.UserId, "editor"), Task("HT1", "HL1", "Paint"));
        // Two quick renames by Sam fold into one change; then Ben raises its priority.
        await sam.SyncAsync(Task("HT1", "HL1", "Paint the"));
        await sam.SyncAsync(Task("HT1", "HL1", "Paint the shed"));
        var withPriority = Task("HT1", "HL1", "Paint the shed");
        withPriority.Item2["priority"] = 3;
        ((JsonObject)withPriority.Item2["_hlc"]!)["priority"] = "2026-10-21T13:00:00.000Z-0000-dev1";
        await ben.SyncAsync(withPriority);

        var history = (await sam.Client.GetFromJsonAsync<List<HistoryView>>("/api/tasks/HT1/history", Token))!;
        Assert.Equal(["priority", "title", "created"], history.Select(each => each.Field));
        var title = history[1];
        Assert.Equal(("\"Paint\"", "\"Paint the shed\"", sam.UserId), (title.Before, title.After, title.ActorId));
        Assert.Equal(("3", ben.UserId), (history[0].After, history[0].ActorId));
        // Lee cannot see the task, so its history is not there for them either.
        Assert.Equal(System.Net.HttpStatusCode.NotFound, (await lee.Client.GetAsync("/api/tasks/HT1/history", Token)).StatusCode);
    }

    [Fact]
    public async Task A_task_for_a_group_tells_its_members_and_calling_dibs_tells_the_rest()
    {
        var ben = await SignIn("ben-g");
        var sam = await SignIn("sam-g");
        var kim = await SignIn("kim-g");
        var admin = factory.CreateClient();
        (await admin.PostAsJsonAsync("/auth/login", new { username = "admin", password = "correct horse battery" }, Token)).EnsureSuccessStatusCode();
        var made = await admin.PostAsJsonAsync("/api/admin/groups", new { name = "Chores", offeredForSharing = true }, Token);
        var groupId = (string)(await made.Content.ReadFromJsonAsync<JsonObject>(Token))!["id"]!;
        foreach (var member in new[] { sam, kim })
        {
            (await admin.PutAsync($"/api/admin/groups/{groupId}/members/{member.UserId}", null, Token)).EnsureSuccessStatusCode();
        }
        JsonObject Assigned(params (string Principal, bool In, string Clock)[] states)
        {
            var assignees = new JsonObject();
            foreach (var (principal, isIn, at) in states) assignees[principal] = new JsonObject { ["in"] = isIn, ["hlc"] = at };
            return assignees;
        }
        var task = Entity("GT1", new JsonObject
        {
            ["listId"] = "GL1",
            ["title"] = "Take out the bins",
            ["parentId"] = null,
            ["assignees"] = Assigned(($"group:{groupId}", true, "2026-10-21T11:00:00.000Z-0000-dev1")),
        });
        await ben.SyncAsync(
            List("GL1", "shared"),
            ("listMembers", Entity("GM1", new JsonObject { ["listId"] = "GL1", ["principal"] = $"group:{groupId}", ["role"] = "editor" })),
            ("tasks", task));
        Assert.Contains((await sam.NotificationsAsync()).Items, each => each.Kind == "groupAssigned" && each.TaskId == "GT1");
        Assert.Contains((await kim.NotificationsAsync()).Items, each => each.Kind == "groupAssigned" && each.TaskId == "GT1");

        // Kim calls dibs: the group comes off, Kim goes on. Sam hears; Kim does not.
        await kim.SyncAsync();
        var claimed = Entity("GT1", new JsonObject
        {
            ["listId"] = "GL1",
            ["title"] = "Take out the bins",
            ["parentId"] = null,
            ["assignees"] = Assigned(
                ($"group:{groupId}", false, "2026-10-21T12:00:00.000Z-0000-dev2"),
                ($"user:{kim.UserId}", true, "2026-10-21T12:00:00.000Z-0000-dev2")),
        });
        await kim.SyncAsync(("tasks", claimed));
        Assert.Contains((await sam.NotificationsAsync()).Items, each => each.Kind == "claimed" && each.ActorId == kim.UserId);
        Assert.DoesNotContain((await kim.NotificationsAsync()).Items, each => each.Kind == "claimed");
    }

    [Fact]
    public async Task A_server_group_offered_for_sharing_is_a_group_members_share_with_but_cannot_leave()
    {
        var sam = await SignIn("sam");
        var kim = await SignIn("kim");
        var lee = await SignIn("lee");
        var admin = factory.CreateClient();
        (await admin.PostAsJsonAsync("/auth/login", new { username = "admin", password = "correct horse battery" }, Token)).EnsureSuccessStatusCode();
        var made = await admin.PostAsJsonAsync("/api/admin/groups", new { name = "Family", offeredForSharing = true }, Token);
        var groupId = (string)(await made.Content.ReadFromJsonAsync<JsonObject>(Token))!["id"]!;
        (await admin.PutAsync($"/api/admin/groups/{groupId}/members/{sam.UserId}", null, Token)).EnsureSuccessStatusCode();
        (await admin.PutAsync($"/api/admin/groups/{groupId}/members/{kim.UserId}", null, Token)).EnsureSuccessStatusCode();

        // Its members see it like a group someone made, owned by the server.
        await sam.SyncAsync();
        Assert.Equal(("Family", ServerGroupProjection.Owner), ((string?)sam.Seen[groupId]["name"], (string?)sam.Seen[groupId]["ownerId"]));
        var samRow = sam.Seen.Values.Single(each => (string?)each["groupId"] == groupId && (string?)each["userId"] == sam.UserId);
        await lee.SyncAsync();
        Assert.False(lee.Seen.ContainsKey(groupId));

        // Sam shares a list with it: Kim works on it, Lee does not see it.
        await sam.SyncAsync(
            List("L1", "shared"),
            ("listMembers", Entity("M1", new JsonObject { ["listId"] = "L1", ["principal"] = $"group:{groupId}", ["role"] = "editor" })),
            Task("T1", "L1", "Plan the trip"));
        await kim.SyncAsync();
        Assert.True(kim.Seen.ContainsKey("T1"));
        await lee.SyncAsync();
        Assert.False(lee.Seen.ContainsKey("T1"));

        // Nobody leaves a server group in the app.
        var soon = DateTime.UtcNow.AddSeconds(5).ToString("yyyy-MM-ddTHH:mm:ss.fffZ", System.Globalization.CultureInfo.InvariantCulture);
        var leave = new JsonObject
        {
            ["id"] = (string)samRow["id"]!,
            ["deletedAt"] = soon,
            ["_hlc"] = new JsonObject { ["deletedAt"] = soon + "-0000-dev1" },
        };
        var left = await sam.SyncAsync(("groupMembers", leave));
        Assert.Contains((string)samRow["id"]!, left.Rejected);

        // The admin takes Kim out: Kim loses the list.
        (await admin.DeleteAsync($"/api/admin/groups/{groupId}/members/{kim.UserId}", Token)).EnsureSuccessStatusCode();
        await kim.SyncAsync();
        Assert.False(kim.Seen.ContainsKey("T1"));

        // Renamed, it follows; taken off sharing, it goes.
        (await admin.PatchAsJsonAsync($"/api/admin/groups/{groupId}", new { name = "Household" }, Token)).EnsureSuccessStatusCode();
        await sam.SyncAsync();
        Assert.Equal("Household", (string?)sam.Seen[groupId]["name"]);
        (await admin.PatchAsJsonAsync($"/api/admin/groups/{groupId}", new { offeredForSharing = false }, Token)).EnsureSuccessStatusCode();
        await sam.SyncAsync();
        Assert.True(!sam.Seen.TryGetValue(groupId, out var gone) || gone["deletedAt"] is not null);
    }

    [Fact]
    public async Task A_shared_list_is_worked_on_together_and_leaves_when_made_private()
    {
        var ben = await SignIn("ben");
        var sam = await SignIn("sam");
        await ben.SyncAsync(List("L1", "shared"), Member("M1", "L1", sam.UserId, "editor"), Task("T1", "L1", "Mow"));

        await sam.SyncAsync();
        Assert.Contains("L1", sam.Seen.Keys);
        Assert.Equal("Mow", (string?)sam.Seen["T1"]["title"]);

        // Sam renames it; Ben sees the change.
        await sam.SyncAsync(Task("T1", "L1", "Mow the lawn"));
        await ben.SyncAsync();
        Assert.Equal("Mow the lawn", (string?)ben.Seen["T1"]["title"]);

        // Ben makes it private: Sam loses the list and its tasks.
        await ben.SyncAsync(List("L1", "private"));
        var revoked = await sam.SyncAsync();
        Assert.DoesNotContain("L1", sam.Seen.Keys);
        Assert.DoesNotContain("T1", sam.Seen.Keys);
        Assert.Contains("T1", revoked.Revoked);
    }

    private static (string, JsonObject) Comment(string id, string task, string body, bool deleted = false) =>
        ("comments", Entity(id, new JsonObject
        {
            ["taskId"] = task,
            ["body"] = body,
            ["editedAt"] = null,
            ["deletedAt"] = deleted ? "2026-10-21T12:00:00.000Z" : null,
        }));

    [Fact]
    public async Task Comments_follow_their_task_and_only_their_author_changes_them()
    {
        var ben = await SignIn("ben");
        var sam = await SignIn("sam");
        var kim = await SignIn("kim");
        await ben.SyncAsync(List("L1", "shared"), Member("O1", "L1", ben.UserId, "owner"), Member("M1", "L1", sam.UserId, "editor"),
            Member("M2", "L1", kim.UserId, "viewer"), Task("T1", "L1", "Paint the shed"), Comment("C1", "T1", "Blue?"));

        // Editors comment; everyone on the list sees it.
        Assert.Empty((await sam.SyncAsync(Comment("C2", "T1", "Green, @ben"))).Rejected);
        await kim.SyncAsync();
        Assert.Equal("Green, @ben", (string?)kim.Seen["C2"]["body"]);
        Assert.Contains("C1", kim.Seen.Keys);

        // Viewers read only; nobody edits another's comment.
        Assert.Equal(["C3"], (await kim.SyncAsync(Comment("C3", "T1", "Red"))).Rejected);
        Assert.Equal(["C2"], (await kim.SyncAsync(Comment("C2", "T1", "Red"))).Rejected);
        Assert.Equal(["C2"], (await ben.SyncAsync(Comment("C2", "T1", "Purple"))).Rejected);
        // The author edits; the list's owner may delete it.
        Assert.Empty((await sam.SyncAsync(Comment("C2", "T1", "Green, or grey"))).Rejected);
        Assert.Empty((await ben.SyncAsync(Comment("C2", "T1", "Green, or grey", deleted: true))).Rejected);

        // A comment pushed with its brand-new task is fine.
        Assert.Empty((await sam.SyncAsync(Task("T2", "L1", "Buy brushes"), Comment("C4", "T2", "Two of them"))).Rejected);

        // Made private: the comments leave with the tasks.
        await ben.SyncAsync(List("L1", "private"));
        var gone = await sam.SyncAsync();
        Assert.Contains("C1", gone.Revoked);
        Assert.DoesNotContain("C4", sam.Seen.Keys);
    }

    [Fact]
    public async Task Sharing_through_sync_is_in_the_event_log()
    {
        var ben = await SignIn("ben");
        var sam = await SignIn("sam");
        await ben.SyncAsync(List("L1", "shared"), Member("O1", "L1", ben.UserId, "owner"), Member("M1", "L1", sam.UserId, "editor"));
        await ben.SyncAsync(Member("M1", "L1", sam.UserId, "viewer"));
        var gone = Member("M1", "L1", sam.UserId, "viewer");
        gone.Item2["deletedAt"] = "2026-10-21T12:00:00.000Z";
        await ben.SyncAsync(gone);
        await ben.SyncAsync(List("L1", "private"));

        await System.Threading.Tasks.Task.Delay(100, Token);
        await factory.Services.GetRequiredService<Audit.AuditLog>().FlushAsync(Token);
        var events = (await factory.Services.GetRequiredService<Core.Audit.IAuditStore>()
                .QueryAsync(new Core.Audit.AuditQuery { Ascending = true, Type = "sharing." }, Token)).Entries
            .Select(entry => $"{entry.Type} by {entry.ActorName} on {entry.TargetName}: {entry.Detail}")
            .ToList();
        Assert.Equal([
            "sharing.list-shared by ben on L1: ",
            "sharing.member-added by ben on sam: L1 as editor",
            "sharing.member-role-changed by ben on sam: L1: editor to viewer",
            "sharing.member-removed by ben on sam: L1",
            "sharing.list-unshared by ben on L1: ",
        ], events);
    }

    [Fact]
    public async Task A_viewer_cannot_edit_and_gets_the_server_copy_back()
    {
        var ben = await SignIn("ben2");
        var jo = await SignIn("jo2");
        await ben.SyncAsync(List("L1", "shared"), Member("M1", "L1", jo.UserId, "viewer"), Task("T1", "L1", "Mow"));
        await jo.SyncAsync();

        var attempt = await jo.SyncAsync(Task("T1", "L1", "Jo was here"));
        Assert.Equal(["T1"], attempt.Rejected);
        Assert.Equal("Mow", (string?)attempt.Corrections.Single().Entity["title"]);
        await ben.SyncAsync();
        Assert.Equal("Mow", (string?)ben.Seen["T1"]["title"]);
    }

    [Fact]
    public async Task An_assignee_sees_just_that_task()
    {
        var ben = await SignIn("ben3");
        var sam = await SignIn("sam3");
        await ben.SyncAsync(List("L1", "private"), Task("T1", "L1", "Fix fence", sam.UserId), Task("T2", "L1", "Private stuff"));
        await sam.SyncAsync();
        Assert.Contains("T1", sam.Seen.Keys);
        Assert.DoesNotContain("T2", sam.Seen.Keys);
        Assert.DoesNotContain("L1", sam.Seen.Keys);

        // Unassigned: gone again.
        var unassign = Task("T1", "L1", "Fix fence");
        unassign.Item2["assignees"] = new JsonObject
        {
            [$"user:{sam.UserId}"] = new JsonObject { ["in"] = false, ["hlc"] = "2026-10-21T12:00:00.000Z-0000-dev1" },
        };
        await ben.SyncAsync(unassign);
        await sam.SyncAsync();
        Assert.DoesNotContain("T1", sam.Seen.Keys);
    }

    [Fact]
    public async Task Strangers_cannot_join_a_list_by_themselves()
    {
        var ben = await SignIn("ben4");
        var kim = await SignIn("kim4");
        await ben.SyncAsync(List("L1", "shared"), Task("T1", "L1", "Mow"));
        var attempt = await kim.SyncAsync(Member("M9", "L1", kim.UserId, "owner"));
        Assert.Equal(["M9"], attempt.Rejected);
        Assert.Empty(attempt.Corrections);
        await kim.SyncAsync();
        Assert.DoesNotContain("T1", kim.Seen.Keys);
    }

    private static (string, JsonObject) GroupMember(string id, string group, string user, string joinedAt, string state, bool left = false) =>
        ("groupMembers", Entity(id, new JsonObject
        {
            ["groupId"] = group,
            ["userId"] = user,
            ["joinedAt"] = joinedAt,
            ["state"] = state,
            ["deletedAt"] = left ? "2026-10-21T12:00:00.000Z" : null,
        }));

    [Fact]
    public async Task A_group_passes_to_its_longest_standing_member_and_is_archived_when_empty()
    {
        var ben = await SignIn("ben5");
        var sam = await SignIn("sam5");
        var jo = await SignIn("jo5");
        var group = ("groups", Entity("G1", new JsonObject { ["name"] = "Household", ["color"] = "#A7C7E7", ["ownerId"] = ben.UserId, ["archived"] = false }));
        var assigned = Task("T1", "L1", "Take out bins");
        assigned.Item2["assignees"] = new JsonObject
        {
            ["group:G1"] = new JsonObject { ["in"] = true, ["hlc"] = "2026-10-21T11:00:00.000Z-0000-dev1" },
        };
        await ben.SyncAsync(
            group,
            GroupMember("GB", "G1", ben.UserId, "2026-10-21T09:00:00.000Z", "active"),
            GroupMember("GJ", "G1", jo.UserId, "2026-10-21T09:05:00.000Z", "invited"),
            GroupMember("GS", "G1", sam.UserId, "2026-10-21T09:10:00.000Z", "invited"),
            List("L1", "private"),
            assigned);
        // Jo was invited first, so Jo stands longest once both accept.
        await sam.SyncAsync(GroupMember("GS", "G1", sam.UserId, "2026-10-21T09:10:00.000Z", "active"));
        await jo.SyncAsync(GroupMember("GJ", "G1", jo.UserId, "2026-10-21T09:05:00.000Z", "active"));
        await sam.SyncAsync();
        Assert.Contains("T1", sam.Seen.Keys);

        // Ben leaves: Jo owns the group now.
        await ben.SyncAsync(GroupMember("GB", "G1", ben.UserId, "2026-10-21T09:00:00.000Z", "active", left: true));
        await sam.SyncAsync();
        Assert.Equal(jo.UserId, (string?)sam.Seen["G1"]["ownerId"]);

        // Then Jo and Sam leave: archived, and the task is no longer the group's.
        await jo.SyncAsync(GroupMember("GJ", "G1", jo.UserId, "2026-10-21T09:05:00.000Z", "active", left: true));
        await sam.SyncAsync();
        Assert.Equal(sam.UserId, (string?)sam.Seen["G1"]["ownerId"]);
        await sam.SyncAsync(GroupMember("GS", "G1", sam.UserId, "2026-10-21T09:10:00.000Z", "active", left: true));
        await ben.SyncAsync();
        Assert.True((bool?)ben.Seen["G1"]["archived"]);
        Assert.False((bool?)ben.Seen["T1"]["assignees"]!["group:G1"]!["in"]);
        await sam.SyncAsync();
        Assert.DoesNotContain("T1", sam.Seen.Keys);
    }

    private static (string, JsonObject) Friendship(string id, string a, string b, string state, bool ended = false) =>
        ("friendships", Entity(id, new JsonObject
        {
            ["userA"] = a,
            ["userB"] = b,
            ["state"] = state,
            ["deletedAt"] = ended ? "2026-10-21T12:00:00.000Z" : null,
        }));

    private static (string, JsonObject) Invited(string id, string list, string title, string user, string inviter)
    {
        var task = Task(id, list, title);
        task.Item2["assignees"] = new JsonObject
        {
            [$"invite:{user}:{inviter}"] = new JsonObject { ["in"] = true, ["hlc"] = "2026-10-21T11:00:00.000Z-0000-dev1" },
        };
        return task;
    }

    [Fact]
    public async Task An_invite_assignment_waits_for_the_friend_request()
    {
        var ben = await SignIn("ben6");
        var sam = await SignIn("sam6");
        var kim = await SignIn("kim6");
        await ben.SyncAsync(
            List("L1", "private"),
            Friendship("F1", ben.UserId, sam.UserId, "pending"),
            Invited("T1", "L1", "Paint fence", sam.UserId, ben.UserId),
            Friendship("F2", ben.UserId, kim.UserId, "pending"),
            Invited("T2", "L1", "Mow", kim.UserId, ben.UserId));
        // Not friends yet: the task stays Ben's.
        await sam.SyncAsync();
        Assert.DoesNotContain("T1", sam.Seen.Keys);

        // Sam accepts: the invite becomes the assignment.
        await sam.SyncAsync(Friendship("F1", ben.UserId, sam.UserId, "accepted"));
        await sam.SyncAsync();
        Assert.Contains("T1", sam.Seen.Keys);
        var assignees = sam.Seen["T1"]["assignees"]!;
        Assert.True((bool?)assignees[$"user:{sam.UserId}"]!["in"]);
        Assert.False((bool?)assignees[$"invite:{sam.UserId}:{ben.UserId}"]!["in"]);

        // Kim declines: the invite goes, nothing reaches Kim.
        await kim.SyncAsync(Friendship("F2", ben.UserId, kim.UserId, "pending", ended: true));
        await ben.SyncAsync();
        Assert.False((bool?)ben.Seen["T2"]["assignees"]![$"invite:{kim.UserId}:{ben.UserId}"]!["in"]);
        Assert.Null(ben.Seen["T2"]["assignees"]![$"user:{kim.UserId}"]);
        await kim.SyncAsync();
        Assert.DoesNotContain("T2", kim.Seen.Keys);
    }

    [Fact]
    public async Task An_admin_hands_shared_lists_and_groups_to_someone_else()
    {
        var ben = await SignIn("ben9");
        var sam = await SignIn("sam9");
        await ben.SyncAsync(
            List("L1", "shared"), Member("M1", "L1", sam.UserId, "editor"), Task("T1", "L1", "Mow"),
            List("L2", "private"), Task("T2", "L2", "Diary"),
            ("groups", Entity("G1", new JsonObject { ["name"] = "Household", ["color"] = "#A7C7E7", ["ownerId"] = ben.UserId, ["archived"] = false })),
            GroupMember("GS", "G1", sam.UserId, "2026-10-21T09:10:00.000Z", "active"));

        var admin = factory.CreateClient();
        (await admin.PostAsJsonAsync("/auth/login", new { username = "admin", password = "correct horse battery" }, Token)).EnsureSuccessStatusCode();
        // Only what others share in: the private list is nobody's business.
        var shared = await admin.GetFromJsonAsync<AdminShare[]>($"/api/admin/users/{ben.UserId}/shared", Token);
        Assert.Equal([new AdminShare("list", "L1", "L1", 2), new AdminShare("group", "G1", "Household", 2)], shared!);

        var handed = await admin.PostAsJsonAsync($"/api/admin/users/{ben.UserId}/hand-over", new { to = sam.UserId }, Token);
        Assert.Equal(HttpStatusCode.OK, handed.StatusCode);
        Assert.Empty((await admin.GetFromJsonAsync<AdminShare[]>($"/api/admin/users/{ben.UserId}/shared", Token))!);

        await sam.SyncAsync();
        Assert.Equal(sam.UserId, (string?)sam.Seen["L1"]["ownerId"]);
        Assert.Equal(sam.UserId, (string?)sam.Seen["G1"]["ownerId"]);
        Assert.DoesNotContain("L2", sam.Seen.Keys);

        // Ben stays in as an editor and keeps working on the list.
        await ben.SyncAsync();
        Assert.Contains(ben.Seen.Values, each => (string?)each["listId"] == "L1" && (string?)each["principal"] == $"user:{ben.UserId}" && (string?)each["role"] == "editor");
        Assert.Empty((await ben.SyncAsync(Task("T1", "L1", "Mow the lawn"))).Rejected);
        Assert.Contains(ben.Seen.Values, each => (string?)each["groupId"] == "G1" && (string?)each["userId"] == ben.UserId && (string?)each["state"] == "active");

        // Sam owns it now: making it private is Sam's call, and Ben no longer can.
        Assert.NotEmpty((await ben.SyncAsync(List("L1", "private"))).Rejected);
        await sam.SyncAsync(List("L1", "private"));
        await ben.SyncAsync();
        Assert.DoesNotContain("T1", ben.Seen.Keys);
    }
}
