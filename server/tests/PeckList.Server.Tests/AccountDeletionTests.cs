using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using PeckList.Core;
using PeckList.Core.Accounts;
using PeckList.Core.Audit;
using PeckList.Server.Audit;

namespace PeckList.Server.Tests;

/// <summary>Deleting accounts (spec: Users, delete with grace period and restore).</summary>
public sealed class AccountDeletionTests(ServerFixture fixture) : IClassFixture<ServerFixture>
{
    private const string AdminPassword = "correct horse battery";
    private const string Password = "a long enough password";
    private const string Clock = "2026-10-22T10:00:00.000Z-0000-dev1";

    private static CancellationToken Token => TestContext.Current.CancellationToken;

    private static async Task<HttpClient> LogIn(WebApplicationFactory<Program> server, string username, string password)
    {
        var client = server.CreateClient();
        (await client.PostAsJsonAsync("/auth/login", new { username, password }, Token)).EnsureSuccessStatusCode();
        return client;
    }

    private static async Task<(HttpClient Client, string Id)> NewUser(WebApplicationFactory<Program> server, string username)
    {
        var id = (await server.Services.GetRequiredService<AccountService>()
            .CreateUserAsync(username, Password, mustChangePassword: false, cancellation: Token)).Id;
        return (await LogIn(server, username, Password), id);
    }

    private static Task<HttpResponseMessage> Pull(HttpClient client) =>
        client.PostAsJsonAsync("/api/sync", new { schemaVersion = WorkspaceSchema.CurrentVersion, cursor = (long?)null }, Token);

    [Fact]
    public async Task A_deleted_account_is_off_at_once_and_can_be_restored_within_the_grace_period()
    {
        using var server = fixture.Factory(("ADMIN_PASSWORD", AdminPassword));
        var admin = await LogIn(server, "admin", AdminPassword);
        var (sam, samId) = await NewUser(server, "sam");
        var adminId = (await server.Services.GetRequiredService<IAccountStore>().FindByUsernameAsync("admin", Token))!.Id;

        Assert.Equal(HttpStatusCode.Conflict, (await admin.DeleteAsync($"/api/admin/users/{adminId}", Token)).StatusCode);
        var deleted = await admin.DeleteAsync($"/api/admin/users/{samId}", Token);
        Assert.Equal(HttpStatusCode.OK, deleted.StatusCode);
        var removedAt = (DateTimeOffset)(await deleted.Content.ReadFromJsonAsync<JsonObject>(Token))!["removedAt"]!;
        Assert.InRange(removedAt - DateTimeOffset.UtcNow, TimeSpan.FromDays(6.9), TimeSpan.FromDays(7.1));

        // Their session ends and they cannot sign in.
        Assert.Equal(HttpStatusCode.Unauthorized, (await Pull(sam)).StatusCode);
        Assert.NotEqual(HttpStatusCode.OK, (await server.CreateClient().PostAsJsonAsync("/auth/login", new { username = "sam", password = Password }, Token)).StatusCode);
        var row = (await admin.GetFromJsonAsync<AdminUser[]>("/api/admin/users", Token))!.Single(user => user.Id == samId);
        Assert.True(row.Disabled);
        Assert.NotNull(row.DeletedAt);
        // Turning it back on is not the way: restoring is.
        Assert.Equal(HttpStatusCode.Conflict, (await admin.PutAsJsonAsync($"/api/admin/users/{samId}/disabled", new { disabled = false }, Token)).StatusCode);

        Assert.Equal(HttpStatusCode.NoContent, (await admin.PostAsync($"/api/admin/users/{samId}/restore", null, Token)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Pull(await LogIn(server, "sam", Password))).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await admin.PostAsync($"/api/admin/users/{samId}/restore", null, Token)).StatusCode);
    }

    [Fact]
    public async Task An_admin_removes_a_deleted_account_now_without_waiting_out_the_grace_period()
    {
        using var server = fixture.Factory(("ADMIN_PASSWORD", AdminPassword));
        var admin = await LogIn(server, "admin", AdminPassword);
        var (_, samId) = await NewUser(server, "sam");

        // Only a deleted account can go now.
        Assert.Equal(HttpStatusCode.Conflict, (await admin.PostAsync($"/api/admin/users/{samId}/remove-now", null, Token)).StatusCode);
        (await admin.DeleteAsync($"/api/admin/users/{samId}", Token)).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.NoContent, (await admin.PostAsync($"/api/admin/users/{samId}/remove-now", null, Token)).StatusCode);

        Assert.Null(await server.Services.GetRequiredService<IAccountStore>().FindByIdAsync(samId, Token));
        Assert.Equal(HttpStatusCode.NotFound, (await admin.PostAsync($"/api/admin/users/{samId}/remove-now", null, Token)).StatusCode);
        // The name is free again.
        await NewUser(server, "sam");
        await server.Services.GetRequiredService<AuditLog>().FlushAsync(Token);
        var events = (await server.Services.GetRequiredService<IAuditStore>().QueryAsync(new AuditQuery { Ascending = true }, Token)).Entries;
        Assert.Contains(events, entry => entry.Type == "admin.user-removed-now");
    }

    [Fact]
    public async Task After_the_grace_period_the_account_and_everything_it_owns_go_and_friends_hear_of_it()
    {
        using var server = fixture.Factory(("ADMIN_PASSWORD", AdminPassword), ("ACCOUNT_DELETE_GRACE_DAYS", "0"));
        var admin = await LogIn(server, "admin", AdminPassword);
        var (sam, samId) = await NewUser(server, "sam");
        var (kim, kimId) = await NewUser(server, "kim");
        (await admin.PostAsJsonAsync("/api/admin/friendships", new { userA = samId, userB = kimId }, Token)).EnsureSuccessStatusCode();
        (await sam.PostAsJsonAsync("/api/sync", new
        {
            schemaVersion = WorkspaceSchema.CurrentVersion,
            cursor = (long?)null,
            changes = new[]
            {
                new
                {
                    collection = "tasks",
                    entity = new JsonObject
                    {
                        ["id"] = "T1", ["title"] = "Sam's task", ["deletedAt"] = null,
                        ["_hlc"] = new JsonObject { ["title"] = Clock, ["deletedAt"] = Clock },
                    },
                },
            },
        }, Token)).EnsureSuccessStatusCode();

        (await admin.DeleteAsync($"/api/admin/users/{samId}", Token)).EnsureSuccessStatusCode();
        // The hourly sweep's first run (30 seconds in) may get there first on a slow machine.
        await server.Services.GetRequiredService<AccountRemoval>().RemoveDueAsync(Token);

        Assert.Null(await server.Services.GetRequiredService<IAccountStore>().FindByIdAsync(samId, Token));
        Assert.DoesNotContain((await admin.GetFromJsonAsync<AdminUser[]>("/api/admin/users", Token))!, user => user.Id == samId);
        Assert.Empty((await admin.GetFromJsonAsync<AdminFriend[]>($"/api/admin/users/{kimId}/friends", Token))!);
        var task = await server.Services.GetRequiredService<Core.Storage.IEntityStore>().GetAsync("T1", Token);
        Assert.NotNull(task!.Doc["deletedAt"]);
        Assert.Equal(HttpStatusCode.OK, (await Pull(kim)).StatusCode);

        await server.Services.GetRequiredService<AuditLog>().FlushAsync(Token);
        var events = (await server.Services.GetRequiredService<IAuditStore>().QueryAsync(new AuditQuery { Ascending = true }, Token)).Entries;
        Assert.Contains(events, entry => entry.Type == "admin.user-deleted" && entry.TargetName == "sam");
        Assert.Contains(events, entry => entry.Type == "admin.user-removed" && entry.Detail!.StartsWith("sam,", StringComparison.Ordinal));
    }

    [Fact]
    public async Task What_a_removed_account_owned_goes_even_when_its_device_clock_ran_ahead()
    {
        // Devices' clocks are not the server's: one ten minutes fast stamps its changes after
        // anything the server would stamp now. The removal still wins.
        using var server = fixture.Factory(("ADMIN_PASSWORD", AdminPassword));
        var admin = await LogIn(server, "admin", AdminPassword);
        var (sam, samId) = await NewUser(server, "sam");
        var ahead = DateTimeOffset.UtcNow.AddMinutes(10).UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", System.Globalization.CultureInfo.InvariantCulture) + "-0000-fastclock";
        (await sam.PostAsJsonAsync("/api/sync", new
        {
            schemaVersion = WorkspaceSchema.CurrentVersion,
            cursor = (long?)null,
            changes = new[]
            {
                new
                {
                    collection = "tasks",
                    entity = new JsonObject
                    {
                        ["id"] = "T9", ["title"] = "Fast clock task", ["deletedAt"] = null,
                        ["_hlc"] = new JsonObject { ["title"] = ahead, ["deletedAt"] = ahead },
                    },
                },
            },
        }, Token)).EnsureSuccessStatusCode();

        (await admin.DeleteAsync($"/api/admin/users/{samId}", Token)).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.NoContent, (await admin.PostAsync($"/api/admin/users/{samId}/remove-now", null, Token)).StatusCode);

        var task = await server.Services.GetRequiredService<Core.Storage.IEntityStore>().GetAsync("T9", Token);
        Assert.NotNull(task!.Doc["deletedAt"]);
        Assert.True(Core.Sync.Hlc.Compare((string?)task.Doc["_hlc"]!["deletedAt"], ahead) > 0);
    }

    private static int clock;

    private static object Change(string collection, JsonObject fields)
    {
        var stamp = $"2026-10-22T11:{Interlocked.Increment(ref clock) / 60 % 60:D2}:{clock % 60:D2}.000Z-0000-dev1";
        fields["deletedAt"] ??= null;
        var clocks = new JsonObject();
        foreach (var (field, _) in fields) if (field != "id") clocks[field] = stamp;
        fields["_hlc"] = clocks;
        return new { collection, entity = fields };
    }

    private static async Task<Dictionary<string, JsonObject>> Push(HttpClient client, params object[] changes)
    {
        var response = await client.PostAsJsonAsync("/api/sync", new { schemaVersion = WorkspaceSchema.CurrentVersion, cursor = (long?)null, changes }, Token);
        response.EnsureSuccessStatusCode();
        var body = (await response.Content.ReadFromJsonAsync<JsonObject>(Token))!;
        Assert.Empty(body["rejected"]!.AsArray());
        return body["changes"]!.AsArray().Select(each => each!["entity"]!.AsObject()).ToDictionary(each => (string)each["id"]!);
    }

    [Fact]
    public async Task Removing_an_account_hands_its_shared_lists_and_groups_on_and_keeps_what_others_work_on()
    {
        using var server = fixture.Factory(("ADMIN_PASSWORD", AdminPassword), ("ACCOUNT_DELETE_GRACE_DAYS", "0"));
        var admin = await LogIn(server, "admin", AdminPassword);
        var (sam, samId) = await NewUser(server, "sam");
        var (kim, kimId) = await NewUser(server, "kim");
        var (lee, leeId) = await NewUser(server, "lee");
        foreach (var other in new[] { kimId, leeId })
        {
            (await admin.PostAsJsonAsync("/api/admin/friendships", new { userA = samId, userB = other }, Token)).EnsureSuccessStatusCode();
        }
        // Sam's shared list (Lee joined first as a viewer, Kim edits), a private list, and a group.
        await Push(sam,
            Change("lists", new JsonObject { ["id"] = "L1", ["name"] = "House", ["visibility"] = "shared", ["createdBy"] = samId }),
            Change("listMembers", new JsonObject { ["id"] = "M1", ["listId"] = "L1", ["principal"] = $"user:{leeId}", ["role"] = "viewer", ["createdBy"] = samId, ["createdAt"] = "2026-10-01T00:00:00.000Z" }),
            Change("listMembers", new JsonObject { ["id"] = "M2", ["listId"] = "L1", ["principal"] = $"user:{kimId}", ["role"] = "editor", ["createdBy"] = samId, ["createdAt"] = "2026-10-02T00:00:00.000Z" }),
            Change("tasks", new JsonObject { ["id"] = "T1", ["listId"] = "L1", ["title"] = "Sam's chore in the shared list", ["parentId"] = null, ["createdBy"] = samId }),
            Change("lists", new JsonObject { ["id"] = "L2", ["name"] = "Diary", ["visibility"] = "private", ["createdBy"] = samId }),
            Change("tasks", new JsonObject { ["id"] = "T2", ["listId"] = "L2", ["title"] = "Private", ["parentId"] = null, ["createdBy"] = samId }),
            Change("groups", new JsonObject { ["id"] = "G1", ["name"] = "Family", ["color"] = "#A7C7E7", ["ownerId"] = samId, ["archived"] = false, ["createdBy"] = samId }),
            Change("groupMembers", new JsonObject { ["id"] = "GS", ["groupId"] = "G1", ["userId"] = samId, ["joinedAt"] = "2026-10-01T00:00:00.000Z", ["state"] = "active", ["createdBy"] = samId }),
            Change("groupMembers", new JsonObject { ["id"] = "GK", ["groupId"] = "G1", ["userId"] = kimId, ["joinedAt"] = "2026-10-02T00:00:00.000Z", ["state"] = "invited", ["createdBy"] = samId }));
        await Push(kim,
            Change("groupMembers", new JsonObject { ["id"] = "GK", ["groupId"] = "G1", ["userId"] = kimId, ["joinedAt"] = "2026-10-02T00:00:00.000Z", ["state"] = "active", ["createdBy"] = samId }),
            Change("tasks", new JsonObject { ["id"] = "T3", ["listId"] = "L1", ["title"] = "Kim's chore", ["parentId"] = null, ["createdBy"] = kimId }));

        (await admin.DeleteAsync($"/api/admin/users/{samId}", Token)).EnsureSuccessStatusCode();
        // The hourly sweep's first run (30 seconds in) may get there first on a slow machine.
        await server.Services.GetRequiredService<AccountRemoval>().RemoveDueAsync(Token);
        Assert.Null(await server.Services.GetRequiredService<IAccountStore>().FindByIdAsync(samId, Token));

        // Kim edits, so Kim owns the list now (the higher role wins over Lee's longer stay), with
        // everything in it; the group is Kim's too. Sam's private list went with Sam.
        var seen = await Push(kim);
        Assert.Equal(kimId, (string?)seen["L1"]["ownerId"]);
        Assert.Null(seen["L1"]["deletedAt"]);
        Assert.Null(seen["T1"]["deletedAt"]);
        Assert.Null(seen["T3"]["deletedAt"]);
        Assert.Equal(kimId, (string?)seen["G1"]["ownerId"]);
        Assert.Null(seen["GK"]["deletedAt"]);
        Assert.False(seen.ContainsKey("T2"));
        var store = server.Services.GetRequiredService<Core.Storage.IEntityStore>();
        Assert.NotNull((await store.GetAsync("T2", Token))!.Doc["deletedAt"]);
        // Lee still sees the list.
        var leeSees = await Push(lee);
        Assert.Null(leeSees["T3"]["deletedAt"]);
        Assert.Null(leeSees["M1"]["deletedAt"]);
    }
}
