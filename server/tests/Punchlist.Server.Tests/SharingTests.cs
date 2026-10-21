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
}
