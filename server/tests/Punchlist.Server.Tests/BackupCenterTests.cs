using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Punchlist.Core;
using Punchlist.Core.Accounts;
using Punchlist.Core.Backup;
using Punchlist.Core.Sync;

namespace Punchlist.Server.Tests;

/// <summary>Admin > Backup & Data over HTTP: backups, exports, and restoring one person.</summary>
public sealed class BackupCenterTests(ServerFixture fixture) : IClassFixture<ServerFixture>
{
    private const string AdminPassword = "correct horse battery";
    private const string Password = "a long enough password";

    private static CancellationToken Token => TestContext.Current.CancellationToken;

    private WebApplicationFactory<Program> Server() =>
        fixture.Factory(("ADMIN_PASSWORD", AdminPassword), ("DB_PATH", fixture.NewDbPath()), ("SNAPSHOT_SCHEDULE", "off"));

    private static async Task<HttpClient> LogIn(WebApplicationFactory<Program> server, string username, string password)
    {
        var client = server.CreateClient();
        (await client.PostAsJsonAsync("/auth/login", new { username, password }, Token)).EnsureSuccessStatusCode();
        return client;
    }

    private static async Task<(HttpClient Client, string Id)> NewUser(WebApplicationFactory<Program> server, string username)
    {
        var account = await server.Services.GetRequiredService<AccountService>()
            .CreateUserAsync(username, Password, mustChangePassword: false, cancellation: Token);
        return (await LogIn(server, username, Password), account.Id);
    }

    private static int clock;

    private static JsonObject Entity(string id, JsonObject fields)
    {
        var stamp = $"2026-10-22T10:{Interlocked.Increment(ref clock) / 60 % 60:D2}:{clock % 60:D2}.000Z-0000-dev1";
        fields["id"] = id;
        fields["deletedAt"] ??= null;
        var clocks = new JsonObject();
        foreach (var (field, _) in fields) if (field != "id") clocks[field] = stamp;
        fields["_hlc"] = clocks;
        return fields;
    }

    /// <summary>Push changes, then pull everything; what the device holds afterwards.</summary>
    private static async Task<Dictionary<string, JsonObject>> Sync(HttpClient client, params (string Collection, JsonObject Entity)[] changes)
    {
        var seen = new Dictionary<string, JsonObject>();
        long? cursor = null;
        var push = changes.Select(change => new { collection = change.Collection, entity = change.Entity }).ToArray();
        SyncResponse page;
        do
        {
            var response = await client.PostAsJsonAsync("/api/sync", new { schemaVersion = WorkspaceSchema.CurrentVersion, cursor, changes = push }, Token);
            response.EnsureSuccessStatusCode();
            page = (await response.Content.ReadFromJsonAsync<SyncResponse>(Token))!;
            foreach (var change in page.Changes) seen[(string)change.Entity["id"]!] = change.Entity;
            cursor = page.Cursor;
            push = [];
        } while (page.More);
        return seen;
    }

    private static (string, JsonObject) Task(string id, string list, string title) =>
        ("tasks", Entity(id, new JsonObject { ["listId"] = list, ["title"] = title, ["parentId"] = null, ["assignees"] = new JsonObject() }));

    private static async Task<UserRestoreResult> Restore(HttpClient admin, byte[] file, string? username = null)
    {
        using var form = new MultipartFormDataContent { { new ByteArrayContent(file), "file", "backup.json" } };
        if (username is not null) form.Add(new StringContent(username), "username");
        var response = await admin.PostAsync("/api/admin/users/restore", form, Token);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<UserRestoreResult>(Token))!;
    }

    [Fact]
    public async Task Takes_lists_and_hands_out_backups_and_exports()
    {
        using var server = Server();
        var admin = await LogIn(server, "admin", AdminPassword);
        var taken = await admin.PostAsync("/api/admin/backups", null, Token);
        var name = (string)(await taken.Content.ReadFromJsonAsync<JsonObject>(Token))!["name"]!;
        var listed = await admin.GetFromJsonAsync<BackupFile[]>("/api/admin/backups", Token);
        Assert.Equal(name, Assert.Single(listed!).Name);
        Assert.True(listed![0].Size > 0);

        var download = await admin.GetAsync($"/api/admin/backups/{name}", Token);
        Assert.Contains(BackupService.Format, await download.Content.ReadAsStringAsync(Token));
        Assert.Equal(HttpStatusCode.NotFound, (await admin.GetAsync("/api/admin/backups/..%2Fpunchlist.db", Token)).StatusCode);

        var export = await admin.GetAsync("/api/admin/export", Token);
        Assert.StartsWith("attachment; filename=\"punchlist-", export.Content.Headers.ContentDisposition!.ToString());
        Assert.Contains(BackupService.Format, await export.Content.ReadAsStringAsync(Token));
    }

    [Fact]
    public async Task Restoring_someone_brings_back_their_data_as_it_was_on_every_device()
    {
        using var server = Server();
        var admin = await LogIn(server, "admin", AdminPassword);
        var (sam, samId) = await NewUser(server, "sam");
        await Sync(sam, ("lists", Entity("L1", new JsonObject { ["name"] = "Chores", ["visibility"] = "private" })), Task("T1", "L1", "Mow"));
        var backup = await (await admin.GetAsync($"/api/admin/users/{samId}/export", Token)).Content.ReadAsByteArrayAsync(Token);
        Assert.Contains(UserBackups.Format, System.Text.Encoding.UTF8.GetString(backup));

        // Later: Sam's phone renames the task and adds another.
        var phone = await LogIn(server, "sam", Password);
        await Sync(phone, Task("T1", "L1", "Mow the lawn, badly"), Task("T2", "L1", "Oops"));

        var result = await Restore(admin, backup);
        Assert.Equal(("sam", false, 1), (result.Username, result.Created, result.Removed));
        var after = await Sync(phone);
        Assert.Equal("Mow", (string?)after["T1"]["title"]);
        Assert.NotNull(after["T2"]["deletedAt"]);
        // A safety backup was taken first.
        Assert.NotEmpty((await admin.GetFromJsonAsync<BackupFile[]>("/api/admin/backups", Token))!);
    }

    [Fact]
    public async Task Someone_moves_to_another_server_from_a_whole_server_backup()
    {
        byte[] whole;
        using (var old = Server())
        {
            var admin = await LogIn(old, "admin", AdminPassword);
            var (sam, _) = await NewUser(old, "sam");
            var (_, kimId) = await NewUser(old, "kim");
            await Sync(sam,
                ("lists", Entity("L1", new JsonObject { ["name"] = "Chores", ["visibility"] = "shared" })),
                ("listMembers", Entity("M1", new JsonObject { ["listId"] = "L1", ["principal"] = $"user:{kimId}", ["role"] = "editor" })),
                Task("T1", "L1", "Mow"));
            whole = await (await admin.GetAsync("/api/admin/export", Token)).Content.ReadAsByteArrayAsync(Token);
        }
        using var fresh = Server();
        var newAdmin = await LogIn(fresh, "admin", AdminPassword);
        using (var missing = new MultipartFormDataContent { { new ByteArrayContent(whole), "file", "all.json" } })
        {
            var refused = await newAdmin.PostAsync("/api/admin/users/restore", missing, Token);
            Assert.Equal(HttpStatusCode.BadRequest, refused.StatusCode);
        }
        var result = await Restore(newAdmin, whole, "Sam");
        // Kim is not on this server: the share with Kim is left out.
        Assert.Equal(("sam", true, 1), (result.Username, result.Created, result.Dropped));

        // Same password, same data.
        var sam2 = await LogIn(fresh, "sam", Password);
        var held = await Sync(sam2);
        Assert.Equal("Mow", (string?)held["T1"]["title"]);
        Assert.DoesNotContain("M1", held.Keys);
    }
}
