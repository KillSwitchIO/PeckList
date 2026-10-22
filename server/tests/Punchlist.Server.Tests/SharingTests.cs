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
