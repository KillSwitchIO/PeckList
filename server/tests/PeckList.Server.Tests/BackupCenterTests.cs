using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using PeckList.Core;
using PeckList.Core.Accounts;
using PeckList.Core.Backup;
using PeckList.Core.Sync;

namespace PeckList.Server.Tests;

/// <summary>Admin > Backup & Data over HTTP: backups, exports, and restoring one person.</summary>
public sealed class BackupCenterTests(ServerFixture fixture) : IClassFixture<ServerFixture>
{
    private const string AdminPassword = "correct horse battery";
    private const string Password = "a long enough password";

    private static CancellationToken Token => TestContext.Current.CancellationToken;

    /// <summary>A server with its own database and backup folder (tests run side by side).</summary>
    private WebApplicationFactory<Program> Server(string? db = null)
    {
        db ??= fixture.NewDbPath();
        return fixture.Factory(("ADMIN_PASSWORD", AdminPassword), ("DB_PATH", db), ("SNAPSHOT_SCHEDULE", "off"),
            ("SNAPSHOT_DIR", Path.ChangeExtension(db, ".backups")));
    }

    /// <summary>The session and one-time secret kinds a key-made export leaves out.</summary>
    private static readonly string[] SessionAndOneTimeKinds =
    [
        "dataprotection", "login-link", "impersonation", "app-handoff", "signup-invite",
        "password-reset", "email-confirm", "app-link", "passkey-enroll",
    ];

    /// <summary>
    /// A server with the admin signed in (and a bare session cookie of theirs for later), a row of
    /// each one-time kind, and a scheduled backup's folder of its own.
    /// </summary>
    private async Task<(WebApplicationFactory<Program> Server, HttpClient Admin, string Cookie)> ServerWithSecrets(string db)
    {
        var server = Server(db);
        var admin = await LogIn(server, "admin", AdminPassword);
        var bare = server.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = false });
        var login = await bare.PostAsJsonAsync("/auth/login", new { username = "admin", password = AdminPassword }, Token);
        login.EnsureSuccessStatusCode();
        var cookie = Assert.Single(login.Headers.GetValues("Set-Cookie"), each => each.StartsWith("pecklist_session=", StringComparison.Ordinal)).Split(';')[0];
        var secrets = server.Services.GetRequiredService<ISecretStore>();
        foreach (var kind in SessionAndOneTimeKinds.Where(kind => kind != "dataprotection"))
        {
            await secrets.PutAsync(kind, $"test-{kind}", "unused", Token);
        }
        return (server, admin, cookie);
    }

    private static async Task<JsonObject> ExportWith(HttpClient client)
    {
        var export = await client.GetAsync("/api/admin/export", Token);
        Assert.Equal(HttpStatusCode.OK, export.StatusCode);
        return JsonNode.Parse(await export.Content.ReadAsStringAsync(Token))!.AsObject();
    }

    private static HashSet<string> KindsIn(JsonObject backup) =>
        [.. backup["secrets"]!.AsArray().Select(secret => (string)secret!["kind"]!)];

    /// <summary>Restores a whole-server backup at a restart; then whether the old cookie still signs in.</summary>
    private async Task<HttpStatusCode> CookieAfterRestore(string db, WebApplicationFactory<Program> server, HttpClient admin, string cookie, JsonObject backup)
    {
        using (server)
        {
            using var form = new MultipartFormDataContent { { new StringContent(backup.ToJsonString()), "file", "backup.json" } };
            Assert.Equal(HttpStatusCode.Accepted, (await admin.PostAsync("/api/admin/restore", form, Token)).StatusCode);
        }
        using var restarted = Server(db);
        var request = new HttpRequestMessage(HttpMethod.Get, "/auth/me");
        request.Headers.Add("Cookie", cookie);
        var client = restarted.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = false });
        return (await client.SendAsync(request, Token)).StatusCode;
    }

    [Fact]
    public async Task An_export_made_signed_in_holds_every_secret_and_keeps_sessions_when_restored()
    {
        var db = fixture.NewDbPath();
        var (server, admin, cookie) = await ServerWithSecrets(db);

        var backup = await ExportWith(admin);

        Assert.Empty(SessionAndOneTimeKinds.Except(KindsIn(backup)));
        Assert.Equal(HttpStatusCode.OK, await CookieAfterRestore(db, server, admin, cookie, backup));
    }

    [Fact]
    public async Task An_export_made_with_an_api_key_leaves_out_the_session_and_one_time_secrets()
    {
        var db = fixture.NewDbPath();
        var (server, admin, cookie) = await ServerWithSecrets(db);
        var made = await admin.PostAsJsonAsync("/api/account/api-keys", new { name = "Backups", scopes = new[] { ApiScopes.Admin } }, Token);
        made.EnsureSuccessStatusCode();
        var key = server.CreateClient();
        key.DefaultRequestHeaders.Authorization = new("Bearer", (await made.Content.ReadFromJsonAsync<Auth.ApiKeyAuth.CreatedKey>(Token))!.Token);

        var whole = await ExportWith(admin);
        var byKey = await ExportWith(key);

        Assert.Empty(KindsIn(byKey).Intersect(SessionAndOneTimeKinds));
        // Everything else is there as it is in an export made signed in.
        Assert.Equal(KindsIn(whole).Except(SessionAndOneTimeKinds).ToHashSet(), KindsIn(byKey));
        Assert.Equal(whole["accounts"]!.AsArray().Count, byKey["accounts"]!.AsArray().Count);
        // Restoring it signs everyone out: the keys that signed their sessions are gone.
        Assert.Equal(HttpStatusCode.Unauthorized, await CookieAfterRestore(db, server, admin, cookie, byKey));
    }

    [Fact]
    public async Task An_export_made_with_an_api_key_leaves_out_the_settings_passwords_but_keeps_the_plain_settings()
    {
        var db = fixture.NewDbPath();
        var (server, admin, _) = await ServerWithSecrets(db);
        var saved = await admin.PutAsJsonAsync("/api/admin/settings", new
        {
            values = new Dictionary<string, string?>
            {
                ["SMTP_PROVIDER"] = "gmail",
                ["SMTP_USER"] = "ben@gmail.com",
                ["SMTP_PASSWORD"] = "abcd efgh ijkl mnop",
            },
        }, Token);
        Assert.Equal(HttpStatusCode.OK, saved.StatusCode);
        var made = await admin.PostAsJsonAsync("/api/account/api-keys", new { name = "Backups", scopes = new[] { ApiScopes.Admin } }, Token);
        made.EnsureSuccessStatusCode();
        var key = server.CreateClient();
        key.DefaultRequestHeaders.Authorization = new("Bearer", (await made.Content.ReadFromJsonAsync<Auth.ApiKeyAuth.CreatedKey>(Token))!.Token);

        var whole = await ExportWith(admin);
        var byKey = await ExportWith(key);

        Assert.NotNull(Secret(whole, "settings-key"));
        Assert.StartsWith("page:", Secret(whole, "setting", "SMTP_PASSWORD"));
        Assert.Null(Secret(byKey, "settings-key"));
        Assert.Null(Secret(byKey, "setting", "SMTP_PASSWORD"));
        Assert.Equal("ben@gmail.com", Secret(byKey, "setting", "SMTP_USER"));
        Assert.Equal("gmail", Secret(byKey, "setting", "SMTP_PROVIDER"));

        // Restored, the saved settings keep the plain values and have no password until it is entered again.
        using (server)
        {
            using var form = new MultipartFormDataContent { { new StringContent(byKey.ToJsonString()), "file", "backup.json" } };
            Assert.Equal(HttpStatusCode.Accepted, (await admin.PostAsync("/api/admin/restore", form, Token)).StatusCode);
        }
        using var restarted = Server(db);
        await LogIn(restarted, "admin", AdminPassword);
        var page = await SettingsLoader.ReadPageAsync(restarted.Services.GetRequiredService<ISecretStore>(), null, Token);
        Assert.Equal("ben@gmail.com", page["SMTP_USER"]);
        Assert.False(page.ContainsKey("SMTP_PASSWORD"));
    }

    /// <summary>A server secret's value in a backup file: the first of its kind, or the one with that name.</summary>
    private static string? Secret(JsonObject backup, string kind, string? name = null) =>
        (string?)backup["secrets"]!.AsArray()
            .FirstOrDefault(secret => (string?)secret!["kind"] == kind && (name is null || (string?)secret["name"] == name))?["value"];

    [Fact]
    public async Task A_key_cannot_download_a_snapshot_but_a_signed_in_super_admin_can()
    {
        var (server, admin, _) = await ServerWithSecrets(fixture.NewDbPath());
        using var _s = server;
        var made = await admin.PostAsJsonAsync("/api/account/api-keys", new { name = "Backups", scopes = new[] { ApiScopes.Admin } }, Token);
        made.EnsureSuccessStatusCode();
        var key = server.CreateClient();
        key.DefaultRequestHeaders.Authorization = new("Bearer", (await made.Content.ReadFromJsonAsync<Auth.ApiKeyAuth.CreatedKey>(Token))!.Token);
        // A key may still take one and see the list.
        var taken = await key.PostAsync("/api/admin/backups", null, Token);
        Assert.Equal(HttpStatusCode.OK, taken.StatusCode);
        var name = (string)(await taken.Content.ReadFromJsonAsync<JsonObject>(Token))!["name"]!;
        Assert.Equal(name, Assert.Single((await key.GetFromJsonAsync<BackupFile[]>("/api/admin/backups", Token))!).Name);

        var refused = await key.GetAsync($"/api/admin/backups/{name}", Token);

        Assert.Equal(HttpStatusCode.Forbidden, refused.StatusCode);
        var problem = (await refused.Content.ReadFromJsonAsync<JsonObject>(Token))!;
        Assert.Equal("not_with_a_key", (string?)problem["error"]);
        Assert.Contains("export", (string?)problem["message"]);
        Assert.Equal(HttpStatusCode.OK, (await admin.GetAsync($"/api/admin/backups/{name}", Token)).StatusCode);
    }

    [Fact]
    public async Task A_key_cannot_restore_the_whole_server()
    {
        var db = fixture.NewDbPath();
        var (server, admin, _) = await ServerWithSecrets(db);
        using var _s = server;
        var made = await admin.PostAsJsonAsync("/api/account/api-keys", new { name = "Backups", scopes = new[] { ApiScopes.Admin } }, Token);
        made.EnsureSuccessStatusCode();
        var key = server.CreateClient();
        key.DefaultRequestHeaders.Authorization = new("Bearer", (await made.Content.ReadFromJsonAsync<Auth.ApiKeyAuth.CreatedKey>(Token))!.Token);
        var backup = await ExportWith(admin);
        var (_, samId) = await NewUser(server, "sam");

        using var form = new MultipartFormDataContent { { new StringContent(backup.ToJsonString()), "file", "backup.json" } };
        var refused = await key.PostAsync("/api/admin/restore", form, Token);

        Assert.Equal(HttpStatusCode.Forbidden, refused.StatusCode);
        Assert.Equal("not_with_a_key", (string?)(await refused.Content.ReadFromJsonAsync<JsonObject>(Token))!["error"]);
        // Nothing was parked, and no safety backup taken: the server still runs as it was.
        Assert.Empty((await admin.GetFromJsonAsync<BackupFile[]>("/api/admin/backups", Token))!);
        Assert.Equal(HttpStatusCode.OK, (await admin.GetAsync("/auth/me", Token)).StatusCode);
        Assert.NotNull(await server.Services.GetRequiredService<IAccountStore>().FindByIdAsync(samId, Token));
    }

    private static async Task<string> EpochOf(HttpClient client)
    {
        var response = await client.PostAsJsonAsync("/api/sync", new { schemaVersion = WorkspaceSchema.CurrentVersion, cursor = (long?)null }, Token);
        return (await response.Content.ReadFromJsonAsync<SyncResponse>(Token))!.Epoch!;
    }

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

        // Snapshots are written gzip-compressed and handed out as they are.
        Assert.EndsWith(".json.gz", name);
        var download = await admin.GetAsync($"/api/admin/backups/{name}", Token);
        Assert.Equal("application/gzip", download.Content.Headers.ContentType!.MediaType);
        await using (var unpacked = new System.IO.Compression.GZipStream(await download.Content.ReadAsStreamAsync(Token),
            System.IO.Compression.CompressionMode.Decompress))
        {
            Assert.Contains(BackupService.Format, await new StreamReader(unpacked).ReadToEndAsync(Token));
        }
        Assert.Equal(HttpStatusCode.NotFound, (await admin.GetAsync("/api/admin/backups/..%2Fpunchlist.db", Token)).StatusCode);

        var export = await admin.GetAsync("/api/admin/export", Token);
        Assert.StartsWith("attachment; filename=\"pecklist-", export.Content.Headers.ContentDisposition!.ToString());
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
            var (sam, samId) = await NewUser(old, "sam");
            var (_, kimId) = await NewUser(old, "kim");
            await old.BefriendAsync(samId, kimId);
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
        // Kim is not on this server: the share with Kim and their friendship are left out.
        Assert.Equal(("sam", true, 2), (result.Username, result.Created, result.Dropped));

        // Same password, same data.
        var sam2 = await LogIn(fresh, "sam", Password);
        var held = await Sync(sam2);
        Assert.Equal("Mow", (string?)held["T1"]["title"]);
        Assert.DoesNotContain("M1", held.Keys);
    }

    [Fact]
    public async Task A_downloaded_snapshot_uploads_back_as_it_was()
    {
        byte[] snapshot;
        using (var old = Server())
        {
            var admin = await LogIn(old, "admin", AdminPassword);
            var (sam, _) = await NewUser(old, "sam");
            await Sync(sam, ("lists", Entity("L1", new JsonObject { ["name"] = "Chores", ["visibility"] = "private" })), Task("T1", "L1", "Mow"));
            var taken = await admin.PostAsync("/api/admin/backups", null, Token);
            var name = (string)(await taken.Content.ReadFromJsonAsync<JsonObject>(Token))!["name"]!;
            snapshot = await (await admin.GetAsync($"/api/admin/backups/{name}", Token)).Content.ReadAsByteArrayAsync(Token);
        }
        Assert.Equal([0x1f, 0x8b], snapshot[..2]);
        using var fresh = Server();
        var newAdmin = await LogIn(fresh, "admin", AdminPassword);
        var result = await Restore(newAdmin, snapshot, "sam");
        Assert.Equal(("sam", true), (result.Username, result.Created));
        var held = await Sync(await LogIn(fresh, "sam", Password));
        Assert.Equal("Mow", (string?)held["T1"]["title"]);
    }

    [Fact]
    public async Task The_whole_server_comes_back_from_a_backup_at_a_restart_and_devices_start_over()
    {
        var db = fixture.NewDbPath();
        string name, before;
        using (var server = Server(db))
        {
            var admin = await LogIn(server, "admin", AdminPassword);
            var (sam, _) = await NewUser(server, "sam");
            await Sync(sam, ("lists", Entity("L1", new JsonObject { ["name"] = "Chores", ["visibility"] = "private" })), Task("T1", "L1", "Mow"));
            before = await EpochOf(sam);
            Assert.Equal(before, await EpochOf(sam));
            name = (string)(await (await admin.PostAsync("/api/admin/backups", null, Token)).Content.ReadFromJsonAsync<JsonObject>(Token))!["name"]!;
            // After the backup: a task the restore will take away.
            await Sync(sam, Task("T2", "L1", "After the backup"));

            using var bad = new MultipartFormDataContent { { new ByteArrayContent("{}"u8.ToArray()), "file", "x.json" } };
            Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsync("/api/admin/restore", bad, Token)).StatusCode);
            using var form = new MultipartFormDataContent { { new StringContent(name), "backup" } };
            Assert.Equal(HttpStatusCode.Accepted, (await admin.PostAsync("/api/admin/restore", form, Token)).StatusCode);
        }
        using var restarted = Server(db);
        var samAgain = await LogIn(restarted, "sam", Password);
        var held = await Sync(samAgain);
        Assert.Equal("Mow", (string?)held["T1"]["title"]);
        Assert.DoesNotContain("T2", held.Keys);
        Assert.NotEqual(before, await EpochOf(samAgain));
    }
}
