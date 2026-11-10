using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using PeckList.Core;
using PeckList.Core.Accounts;
using PeckList.Core.Attachments;
using PeckList.Core.Sharing;
using PeckList.Server.Attachments;

namespace PeckList.Server.Tests;

/// <summary>Files on tasks (spec: Data Model, Attachments): upload by hash, download by sight.</summary>
public sealed class AttachmentTests(ServerFixture fixture) : IClassFixture<ServerFixture>, IDisposable
{
    private readonly WebApplicationFactory<Program> factory =
        fixture.Factory(("ADMIN_PASSWORD", "correct horse battery"), ("DB_PATH", fixture.NewDbPath()), ("ATTACHMENT_MAX_MB", "1"));

    private static CancellationToken Token => TestContext.Current.CancellationToken;

    public void Dispose() => factory.Dispose();

    private async Task<(HttpClient Client, string Id)> SignIn(string username)
    {
        const string password = "a long enough password";
        var account = await factory.Services.GetRequiredService<AccountService>()
            .CreateUserAsync(username, password, mustChangePassword: false, cancellation: Token);
        var client = factory.CreateClient();
        (await client.PostAsJsonAsync("/auth/login", new { username, password }, Token)).EnsureSuccessStatusCode();
        return (client, account.Id);
    }

    private static string Sha(byte[] bytes) => Convert.ToHexStringLower(SHA256.HashData(bytes));

    private static int clock;

    private static JsonObject Entity(string id, JsonObject fields)
    {
        var stamp = $"2026-10-21T11:{Interlocked.Increment(ref clock) / 60 % 60:D2}:{clock % 60:D2}.000Z-0000-dev1";
        fields["id"] = id;
        fields["deletedAt"] ??= null;
        var clocks = new JsonObject();
        foreach (var (field, _) in fields) if (field != "id") clocks[field] = stamp;
        fields["_hlc"] = clocks;
        return fields;
    }

    private static async Task<JsonObject> Sync(HttpClient client, params (string Collection, JsonObject Entity)[] changes)
    {
        var response = await client.PostAsJsonAsync("/api/sync", new
        {
            schemaVersion = WorkspaceSchema.CurrentVersion,
            cursor = (long?)null,
            changes = changes.Select(change => new { collection = change.Collection, entity = change.Entity }),
        }, Token);
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<JsonObject>(Token))!;
    }

    private static (string, JsonObject) Attachment(string id, string task, string name, byte[] bytes, string mime = "text/plain") =>
        ("attachments", Entity(id, new JsonObject
        {
            ["taskId"] = task,
            ["name"] = name,
            ["size"] = bytes.Length,
            ["mime"] = mime,
            ["sha256"] = Sha(bytes),
        }));

    [Fact]
    public async Task Each_person_uploads_up_to_the_daily_allowance_and_a_file_already_here_costs_nothing()
    {
        // Audit S5: one account cannot fill the disk.
        using var server = fixture.Factory(("ADMIN_PASSWORD", "correct horse battery"), ("DB_PATH", fixture.NewDbPath()),
            ("ATTACHMENT_MAX_MB", "1"), ("ATTACHMENT_DAILY_MB", "1"));
        async Task<HttpClient> Person(string username)
        {
            await server.Services.GetRequiredService<AccountService>()
                .CreateUserAsync(username, "a long enough password", mustChangePassword: false, cancellation: Token);
            var client = server.CreateClient();
            (await client.PostAsJsonAsync("/auth/login", new { username, password = "a long enough password" }, Token)).EnsureSuccessStatusCode();
            return client;
        }
        static Task<HttpResponseMessage> Put(HttpClient client, byte[] bytes) =>
            client.PutAsync($"/api/attachments/{Sha(bytes)}", new ByteArrayContent(bytes), Token);
        var sam = await Person("sam");
        var first = new byte[600 * 1024];
        var second = new byte[600 * 1024];
        first[0] = 1;
        second[0] = 2;

        Assert.Equal(HttpStatusCode.Created, (await Put(sam, first)).StatusCode);
        var over = await Put(sam, second);
        Assert.Equal(HttpStatusCode.TooManyRequests, over.StatusCode);
        Assert.Equal("daily_limit", (await over.Content.ReadFromJsonAsync<AttachmentError>(Token))!.Error);
        // A file the server has already costs nothing, and another person has their own allowance.
        Assert.Equal(HttpStatusCode.NoContent, (await Put(sam, first)).StatusCode);
        Assert.Equal(HttpStatusCode.Created, (await Put(await Person("alex"), second)).StatusCode);
    }

    [Fact]
    public void Uploads_are_limited_per_minute_and_the_day_rolls_over()
    {
        var time = new ManualTime(DateTimeOffset.UtcNow);
        using var allowance = new UploadAllowance(time);
        for (var i = 0; i < UploadAllowance.RequestsPerMinute; i++) Assert.True(allowance.TryRequest("sam"));
        Assert.False(allowance.TryRequest("sam"));
        Assert.True(allowance.TryRequest("alex"));

        allowance.Add("sam", 900);
        Assert.False(allowance.Fits("sam", 200, limitBytes: 1000));
        Assert.True(allowance.Fits("sam", 200, limitBytes: 0));
        time.Now = time.Now.Add(UploadAllowance.Window).AddSeconds(1);
        Assert.Equal(0, allowance.Used("sam"));
        Assert.True(allowance.Fits("sam", 200, limitBytes: 1000));
    }

    [Fact]
    public async Task Files_upload_under_their_hash_and_download_for_those_who_see_them()
    {
        var (ben, benId) = await SignIn("ben");
        var (sam, samId) = await SignIn("sam");
        var (kim, _) = await SignIn("kim");
        var bytes = Encoding.UTF8.GetBytes("the shed is 3m by 2m");
        var sha = Sha(bytes);

        // Wrong bytes for the name, and too big, are refused; the right ones stored once.
        Assert.Equal(HttpStatusCode.BadRequest, (await ben.PutAsync($"/api/attachments/{sha}", new ByteArrayContent([1, 2, 3]), Token)).StatusCode);
        Assert.Equal(HttpStatusCode.RequestEntityTooLarge,
            (await ben.PutAsync($"/api/attachments/{Sha(new byte[2_000_000])}", new ByteArrayContent(new byte[2_000_000]), Token)).StatusCode);
        Assert.Equal(HttpStatusCode.Created, (await ben.PutAsync($"/api/attachments/{sha}", new ByteArrayContent(bytes), Token)).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await sam.PutAsync($"/api/attachments/{sha}", new ByteArrayContent(bytes), Token)).StatusCode);
        // Whether the server holds a file is nobody's business until they see it (audit S5).
        Task<HttpStatusCode> Head(HttpClient client) =>
            client.SendAsync(new HttpRequestMessage(HttpMethod.Head, $"/api/attachments/{sha}"), Token).ContinueWith(sent => sent.Result.StatusCode, Token);
        Assert.Equal(HttpStatusCode.NotFound, await Head(ben));
        Assert.Equal(HttpStatusCode.NotFound, await Head(kim));

        // A stored file is nobody's to read until an attachment they see names it.
        Assert.Equal(HttpStatusCode.NotFound, (await ben.GetAsync($"/api/attachments/{sha}", Token)).StatusCode);
        await factory.BefriendAsync(benId, samId);
        var list = ("lists", Entity("L1", new JsonObject { ["name"] = "Shed", ["visibility"] = "shared" }));
        var member = ("listMembers", Entity("M1", new JsonObject { ["listId"] = "L1", ["principal"] = $"user:{samId}", ["role"] = "viewer" }));
        var task = ("tasks", Entity("T1", new JsonObject { ["listId"] = "L1", ["title"] = "Build it", ["parentId"] = null }));
        var synced = await Sync(ben, list, member, task, Attachment("A1", "T1", "plan.txt", bytes));
        Assert.Empty(synced["rejected"]!.AsArray());

        Assert.Equal(HttpStatusCode.OK, await Head(ben));
        Assert.Equal(HttpStatusCode.OK, await Head(sam));
        Assert.Equal(HttpStatusCode.NotFound, await Head(kim));

        var download = await sam.GetAsync($"/api/attachments/{sha}?name=plan.txt&type=text/plain", Token);
        Assert.Equal(HttpStatusCode.OK, download.StatusCode);
        Assert.Equal(bytes, await download.Content.ReadAsByteArrayAsync(Token));
        Assert.Equal("nosniff", download.Headers.GetValues("X-Content-Type-Options").Single());
        // Its own sandboxed policy, not the app's (ResponseHardening adds only what is missing).
        Assert.Equal("sandbox; default-src 'none'", download.Headers.GetValues("Content-Security-Policy").Single());
        Assert.Equal(HttpStatusCode.NotFound, (await kim.GetAsync($"/api/attachments/{sha}", Token)).StatusCode);

        // Anything that is not plain viewing downloads (HTML never renders from here).
        var page = await sam.GetAsync($"/api/attachments/{sha}?name=x.html&type=text/html", Token);
        Assert.Equal("application/octet-stream", page.Content.Headers.ContentType!.MediaType);
        Assert.Equal("attachment", page.Content.Headers.ContentDisposition!.DispositionType);

        // A viewer adds no files.
        Assert.Equal(["A2"], (await Sync(sam, Attachment("A2", "T1", "mine.txt", bytes)))["rejected"]!.AsArray().Select(id => (string)id!));
        Assert.NotEqual(benId, samId);
    }

    [Fact]
    public async Task A_lists_owner_erases_a_file_in_a_purge_and_its_bytes_are_no_longer_wanted()
    {
        var (olive, oliveId) = await SignIn("olive");
        var (pete, peteId) = await SignIn("pete");
        await factory.BefriendAsync(oliveId, peteId);
        var bytes = Encoding.UTF8.GetBytes("a file olive purges");
        Assert.Empty((await Sync(olive,
            ("lists", Entity("L9", new JsonObject { ["name"] = "Shed", ["visibility"] = "shared" })),
            ("listMembers", Entity("M9", new JsonObject { ["listId"] = "L9", ["principal"] = $"user:{peteId}", ["role"] = "editor" })),
            ("tasks", Entity("T9", new JsonObject { ["listId"] = "L9", ["title"] = "Build it", ["parentId"] = null }))))["rejected"]!.AsArray());
        Assert.Empty((await Sync(pete, Attachment("A9", "T9", "plan.txt", bytes)))["rejected"]!.AsArray());
        var wanted = () => factory.Services.GetRequiredService<SharingState>().Index.WantedFiles(DateTimeOffset.UtcNow.AddDays(-30), DateTimeOffset.UtcNow.AddDays(-365));
        Assert.Contains(Sha(bytes), wanted());

        (string, JsonObject) Removed(string name)
        {
            var file = Attachment("A9", "T9", name, bytes);
            file.Item2["deletedAt"] = "1970-01-01T00:00:00.000Z";
            return file;
        }

        // Removing it does not let the owner rename someone else's file; erasing it does.
        Assert.Equal(["A9"], (await Sync(olive, Removed("other.txt")))["rejected"]!.AsArray().Select(id => (string)id!));
        Assert.Empty((await Sync(olive, Removed(SharingIndex.Erased)))["rejected"]!.AsArray());
        Assert.DoesNotContain(Sha(bytes), wanted());
    }

    [Fact]
    public async Task Comments_and_files_follow_their_task_into_the_trash_and_back()
    {
        // Audit B5: an editor deletes a task with other people's comments and files on it.
        var (olive, oliveId) = await SignIn("olive-t");
        var (pete, peteId) = await SignIn("pete-t");
        var (rita, ritaId) = await SignIn("rita-t");
        await factory.BefriendAsync(oliveId, peteId);
        await factory.BefriendAsync(oliveId, ritaId);
        var bytes = Encoding.UTF8.GetBytes("olive's plan for the trash");
        static (string, JsonObject) Comment(string id, string body) =>
            ("comments", Entity(id, new JsonObject { ["taskId"] = "TT", ["body"] = body, ["editedAt"] = null }));
        static IEnumerable<string> Rejected(JsonObject synced) => synced["rejected"]!.AsArray().Select(id => (string)id!);
        Assert.Empty(Rejected(await Sync(olive,
            ("lists", Entity("LT", new JsonObject { ["name"] = "Shed", ["visibility"] = "shared" })),
            ("listMembers", Entity("MT1", new JsonObject { ["listId"] = "LT", ["principal"] = $"user:{peteId}", ["role"] = "editor" })),
            ("listMembers", Entity("MT2", new JsonObject { ["listId"] = "LT", ["principal"] = $"user:{ritaId}", ["role"] = "editor" })),
            ("tasks", Entity("TT", new JsonObject { ["listId"] = "LT", ["title"] = "Build it", ["parentId"] = null })),
            Attachment("AT", "TT", "plan.txt", bytes))));
        Assert.Empty(Rejected(await Sync(rita, Comment("CT1", "Looks good"), Comment("CT2", "Scratch that"))));

        // What a device holds, and a change of it as a device makes one: only the changed fields restamped.
        static async Task<Dictionary<string, JsonObject>> Held(HttpClient client) =>
            (await Sync(client))["changes"]!.AsArray().Select(each => each!["entity"]!.AsObject()).ToDictionary(each => (string)each["id"]!);
        (string, JsonObject) Changed(Dictionary<string, JsonObject> held, string collection, string id, params (string Field, JsonNode? Value)[] fields)
        {
            var doc = held[id].DeepClone().AsObject();
            var stamp = $"2026-10-21T12:{Interlocked.Increment(ref clock) / 60 % 60:D2}:{clock % 60:D2}.000Z-0000-dev2";
            foreach (var (field, value) in fields)
            {
                doc[field] = value?.DeepClone();
                doc["_hlc"]![field] = stamp;
            }
            return (collection, doc);
        }
        // Pushed from a device that then holds what was taken.
        static async Task<IEnumerable<string>> Push(HttpClient client, Dictionary<string, JsonObject> held, params (string, JsonObject)[] changes)
        {
            var rejected = Rejected(await Sync(client, changes)).ToList();
            foreach (var (_, doc) in changes) if (!rejected.Contains((string)doc["id"]!)) held[(string)doc["id"]!] = doc;
            return rejected;
        }

        // Rita takes back her second comment herself, before any of this.
        var ritas = await Held(rita);
        Assert.Empty(await Push(rita, ritas, Changed(ritas, "comments", "CT2", ("deletedAt", "2026-10-30T09:00:00.000Z"))));

        const string gone = "2026-11-01T10:00:00.000Z";
        var held = await Held(pete);
        // Not on its own: only with the task.
        Assert.Equal(["CT1"], await Push(pete, held, Changed(held, "comments", "CT1", ("deletedAt", gone))));
        // What Rita took back herself does not go with it, nor is it erased on the way.
        held["CT2"] = ritas["CT2"];
        Assert.Equal(["CT2"], await Push(pete, held,
            Changed(held, "tasks", "TT", ("deletedAt", gone)),
            Changed(held, "attachments", "AT", ("deletedAt", gone)),
            Changed(held, "comments", "CT1", ("deletedAt", gone)),
            Changed(held, "comments", "CT2", ("deletedAt", gone), ("body", SharingIndex.Erased))));
        // Nor in a later push, ready to come back with the task.
        Assert.Equal(["CT2"], await Push(pete, held, Changed(held, "comments", "CT2", ("deletedAt", gone))));

        // In the trash it is left alone: not reworded, its words not restamped, not moved to another
        // time, and not erased by an editor (emptying a list's Trash is its owner's).
        Assert.Equal(["CT1"], await Push(pete, held, Changed(held, "comments", "CT1", ("body", "Looks bad"))));
        Assert.Equal(["CT1"], await Push(pete, held, Changed(held, "comments", "CT1", ("body", "Looks good"))));
        Assert.Equal(["CT1"], await Push(pete, held, Changed(held, "comments", "CT1", ("body", SharingIndex.Erased))));
        Assert.Equal(["AT"], await Push(pete, held, Changed(held, "attachments", "AT", ("name", SharingIndex.Erased))));
        Assert.Equal(["CT1"], await Push(pete, held, Changed(held, "comments", "CT1", ("deletedAt", "2026-11-02T10:00:00.000Z"))));

        // Back with the task: what went with it, not the comment Rita took back herself.
        Assert.Equal(["CT2"], await Push(pete, held,
            Changed(held, "tasks", "TT", ("deletedAt", null)),
            Changed(held, "attachments", "AT", ("deletedAt", null)),
            Changed(held, "comments", "CT1", ("deletedAt", null)),
            Changed(held, "comments", "CT2", ("deletedAt", null))));
        var now = await Held(olive);
        Assert.Null((string?)now["CT1"]["deletedAt"]);
        Assert.False(now.TryGetValue("CT2", out var still) && still["deletedAt"] is null);
        // With the task back, a file of Olive's is hers to erase, not Pete's.
        Assert.Equal(["AT"], await Push(pete, held, Changed(held, "attachments", "AT", ("name", SharingIndex.Erased))));
    }

    private static IEnumerable<string> RejectedIds(JsonObject synced) => synced["rejected"]!.AsArray().Select(id => (string)id!);

    private static async Task<Dictionary<string, JsonObject>> HeldBy(HttpClient client) =>
        (await Sync(client))["changes"]!.AsArray().Select(each => each!["entity"]!.AsObject()).ToDictionary(each => (string)each["id"]!);

    /// <summary>A change as a device makes one: only the changed fields restamped, later than any before.</summary>
    private static (string, JsonObject) ChangedOn(Dictionary<string, JsonObject> held, string collection, string id, params (string Field, JsonNode? Value)[] fields)
    {
        var doc = held[id].DeepClone().AsObject();
        var stamp = $"2026-10-21T13:{Interlocked.Increment(ref clock) / 60 % 60:D2}:{clock % 60:D2}.000Z-0000-dev3";
        foreach (var (field, value) in fields)
        {
            doc[field] = value?.DeepClone();
            doc["_hlc"]![field] = stamp;
        }
        held[id] = doc;
        return (collection, doc);
    }

    [Fact]
    public async Task A_task_trashed_on_two_devices_before_they_sync_keeps_its_comments_and_files_with_it()
    {
        var (olive, oliveId) = await SignIn("olive-2");
        var (pete, peteId) = await SignIn("pete-2");
        var (rita, ritaId) = await SignIn("rita-2");
        await factory.BefriendAsync(oliveId, peteId);
        await factory.BefriendAsync(oliveId, ritaId);
        var bytes = Encoding.UTF8.GetBytes("rita's file on the old task");
        Assert.Empty(RejectedIds(await Sync(olive,
            ("lists", Entity("L2", new JsonObject { ["name"] = "Shed", ["visibility"] = "shared" })),
            ("listMembers", Entity("M2P", new JsonObject { ["listId"] = "L2", ["principal"] = $"user:{peteId}", ["role"] = "editor" })),
            ("listMembers", Entity("M2R", new JsonObject { ["listId"] = "L2", ["principal"] = $"user:{ritaId}", ["role"] = "editor" })),
            ("tasks", Entity("T2", new JsonObject { ["listId"] = "L2", ["title"] = "Old and done", ["parentId"] = null })))));
        Assert.Empty(RejectedIds(await Sync(rita,
            ("comments", Entity("C2", new JsonObject { ["taskId"] = "T2", ["body"] = "Done it", ["editedAt"] = null })),
            Attachment("A2", "T2", "photo.txt", bytes))));

        // Pete's phone and laptop each hold it, and each puts it in the Trash at its own time.
        var phone = await HeldBy(pete);
        var laptop = await HeldBy(pete);
        const string onPhone = "2026-11-02T08:00:00.000Z";
        const string onLaptop = "2026-11-02T08:05:00.000Z";
        (string, JsonObject)[] Trashed(Dictionary<string, JsonObject> held, string at) =>
        [
            ChangedOn(held, "tasks", "T2", ("deletedAt", at)),
            ChangedOn(held, "comments", "C2", ("deletedAt", at)),
            ChangedOn(held, "attachments", "A2", ("deletedAt", at)),
        ];
        Assert.Empty(RejectedIds(await Sync(pete, Trashed(phone, onPhone))));
        Assert.Empty(RejectedIds(await Sync(pete, Trashed(laptop, onLaptop))));
        var now = await HeldBy(olive);
        Assert.All(["T2", "C2", "A2"], id => Assert.Equal(onLaptop, (string?)now[id]["deletedAt"]));

        // And they come back with it.
        var back = await HeldBy(pete);
        Assert.Empty(RejectedIds(await Sync(pete,
            ChangedOn(back, "tasks", "T2", ("deletedAt", null)),
            ChangedOn(back, "comments", "C2", ("deletedAt", null)),
            ChangedOn(back, "attachments", "A2", ("deletedAt", null)))));
        now = await HeldBy(olive);
        Assert.All(["T2", "C2", "A2"], id => Assert.Null((string?)now[id]["deletedAt"]));
    }

    [Fact]
    public async Task A_task_cannot_go_to_the_trash_at_the_time_a_comment_on_it_was_deleted()
    {
        var (olive, oliveId) = await SignIn("olive-4");
        var (pete, peteId) = await SignIn("pete-4");
        var (rita, ritaId) = await SignIn("rita-4");
        await factory.BefriendAsync(oliveId, peteId);
        await factory.BefriendAsync(oliveId, ritaId);
        Assert.Empty(RejectedIds(await Sync(olive,
            ("lists", Entity("L4", new JsonObject { ["name"] = "Shed", ["visibility"] = "shared" })),
            ("listMembers", Entity("M4P", new JsonObject { ["listId"] = "L4", ["principal"] = $"user:{peteId}", ["role"] = "editor" })),
            ("listMembers", Entity("M4R", new JsonObject { ["listId"] = "L4", ["principal"] = $"user:{ritaId}", ["role"] = "editor" })),
            ("tasks", Entity("T4", new JsonObject { ["listId"] = "L4", ["title"] = "Paint it", ["parentId"] = null })),
            ("tasks", Entity("T5", new JsonObject { ["listId"] = "L4", ["title"] = "Sand it", ["parentId"] = null })))));
        Assert.Empty(RejectedIds(await Sync(rita,
            ("comments", Entity("C4", new JsonObject { ["taskId"] = "T4", ["body"] = "Said too much", ["editedAt"] = null })),
            ("comments", Entity("C5", new JsonObject { ["taskId"] = "T5", ["body"] = "Said too much", ["editedAt"] = null })))));
        const string taken = "2026-11-04T09:00:00.000Z";
        var ritas = await HeldBy(rita);
        Assert.Empty(RejectedIds(await Sync(rita,
            ChangedOn(ritas, "comments", "C4", ("deletedAt", taken)),
            ChangedOn(ritas, "comments", "C5", ("deletedAt", taken)))));

        // At the comment's own time: refused, so it cannot pass for one that went with the task.
        var held = await HeldBy(pete);
        Assert.Equal(["T4"], RejectedIds(await Sync(pete, ChangedOn(held, "tasks", "T4", ("deletedAt", taken)))));

        // Nor by way of another time first, then that one, then a third carrying the comment.
        held = await HeldBy(pete);
        Assert.Empty(RejectedIds(await Sync(pete, ChangedOn(held, "tasks", "T5", ("deletedAt", "2026-11-04T10:00:00.000Z")))));
        Assert.Equal(["T5"], RejectedIds(await Sync(pete, ChangedOn(held, "tasks", "T5", ("deletedAt", taken)))));
        held = await HeldBy(pete);
        Assert.Equal(["C5"], RejectedIds(await Sync(pete,
            ChangedOn(held, "tasks", "T5", ("deletedAt", "2026-11-04T11:00:00.000Z")),
            ChangedOn(held, "comments", "C5", ("deletedAt", "2026-11-04T11:00:00.000Z")))));

        // Restoring brings back the tasks, not Rita's comments.
        held = await HeldBy(pete);
        Assert.Equal(["C5"], RejectedIds(await Sync(pete,
            ChangedOn(held, "tasks", "T5", ("deletedAt", null)),
            ChangedOn(held, "comments", "C5", ("deletedAt", null)))));
        var now = await HeldBy(olive);
        Assert.Equal(taken, (string?)now["C4"]["deletedAt"]);
        Assert.Equal(taken, (string?)now["C5"]["deletedAt"]);
    }

    [Fact]
    public async Task A_task_purged_after_a_comment_on_it_was_purged_on_its_own_is_taken()
    {
        var (olive, oliveId) = await SignIn("olive-p");
        var (rita, ritaId) = await SignIn("rita-p");
        await factory.BefriendAsync(oliveId, ritaId);
        Assert.Empty(RejectedIds(await Sync(olive,
            ("lists", Entity("L6", new JsonObject { ["name"] = "Shed", ["visibility"] = "shared" })),
            ("listMembers", Entity("M6R", new JsonObject { ["listId"] = "L6", ["principal"] = $"user:{ritaId}", ["role"] = "editor" })),
            ("tasks", Entity("T6", new JsonObject { ["listId"] = "L6", ["title"] = "Old", ["parentId"] = null })))));
        Assert.Empty(RejectedIds(await Sync(rita,
            ("comments", Entity("C6", new JsonObject { ["taskId"] = "T6", ["body"] = "Never mind", ["editedAt"] = null })))));

        // Rita deletes hers; Olive's purge empties it on its own, then the task, both at the purge time.
        var ritas = await HeldBy(rita);
        Assert.Empty(RejectedIds(await Sync(rita, ChangedOn(ritas, "comments", "C6", ("deletedAt", "2026-11-05T09:00:00.000Z")))));
        var held = await HeldBy(olive);
        Assert.Empty(RejectedIds(await Sync(olive,
            ChangedOn(held, "comments", "C6", ("deletedAt", SharingIndex.PurgedAt), ("body", SharingIndex.Erased)))));
        Assert.Empty(RejectedIds(await Sync(olive,
            ChangedOn(held, "tasks", "T6", ("deletedAt", SharingIndex.PurgedAt), ("title", SharingIndex.Erased)))));
        Assert.Equal(SharingIndex.PurgedAt, (string?)(await HeldBy(olive))["T6"]["deletedAt"]);
    }

    [Fact]
    public async Task A_list_restored_from_the_trash_brings_back_other_peoples_comments_on_its_tasks()
    {
        var (olive, oliveId) = await SignIn("olive-l");
        var (rita, ritaId) = await SignIn("rita-l");
        await factory.BefriendAsync(oliveId, ritaId);
        Assert.Empty(RejectedIds(await Sync(olive,
            ("lists", Entity("L3", new JsonObject { ["name"] = "Garden", ["visibility"] = "shared" })),
            ("listMembers", Entity("M3R", new JsonObject { ["listId"] = "L3", ["principal"] = $"user:{ritaId}", ["role"] = "editor" })),
            ("tasks", Entity("T3", new JsonObject { ["listId"] = "L3", ["title"] = "Weed", ["parentId"] = null })))));
        Assert.Empty(RejectedIds(await Sync(rita,
            ("comments", Entity("C3", new JsonObject { ["taskId"] = "T3", ["body"] = "On it", ["editedAt"] = null })))));

        const string gone = "2026-11-03T10:00:00.000Z";
        var held = await HeldBy(olive);
        Assert.Empty(RejectedIds(await Sync(olive,
            ChangedOn(held, "lists", "L3", ("deletedAt", gone)),
            ChangedOn(held, "tasks", "T3", ("deletedAt", gone)),
            ChangedOn(held, "comments", "C3", ("deletedAt", gone)))));
        // Restored with the list still in the Trash before this push: the task can be changed again.
        Assert.Empty(RejectedIds(await Sync(olive,
            ChangedOn(held, "lists", "L3", ("deletedAt", null)),
            ChangedOn(held, "tasks", "T3", ("deletedAt", null)),
            ChangedOn(held, "comments", "C3", ("deletedAt", null)))));
        var ritas = await HeldBy(rita);
        Assert.Null((string?)ritas["C3"]["deletedAt"]);
        Assert.Equal("On it", (string?)ritas["C3"]["body"]);
    }

    [Fact]
    public async Task A_file_on_a_task_in_the_trash_is_kept_while_the_trash_can_give_it_back_even_if_never_marked_itself()
    {
        var (quinn, _) = await SignIn("quinn-t");
        var bytes = Encoding.UTF8.GetBytes("a file an older app left on its task");
        Assert.Empty((await Sync(quinn,
            ("lists", Entity("LQ", new JsonObject { ["name"] = "Old", ["visibility"] = "private" })),
            ("tasks", Entity("TQ", new JsonObject { ["listId"] = "LQ", ["title"] = "Gone", ["parentId"] = null })),
            Attachment("AQ", "TQ", "old.txt", bytes)))["rejected"]!.AsArray());
        var index = () => factory.Services.GetRequiredService<SharingState>().Index;
        static (string, JsonObject) Gone((string, JsonObject) file, string at)
        {
            file.Item2["deletedAt"] = at;
            return file;
        }
        var since = new DateTimeOffset(2026, 9, 15, 0, 0, 0, TimeSpan.Zero);
        Assert.Contains(Sha(bytes), index().WantedFiles(since, since));

        // Only the task goes (an app from before B5); the file stays live.
        Assert.Empty((await Sync(quinn,
            ("tasks", Entity("TQ", new JsonObject { ["listId"] = "LQ", ["title"] = "Gone", ["parentId"] = null, ["deletedAt"] = "2026-09-01T10:00:00.000Z" }))))["rejected"]!.AsArray());
        // Past 30 days, but the Trash can keep the task longer: it stays while the task can come back.
        var longer = new DateTimeOffset(2026, 8, 15, 0, 0, 0, TimeSpan.Zero);
        Assert.Contains(Sha(bytes), index().WantedFiles(since, longer));
        Assert.DoesNotContain(Sha(bytes), index().WantedFiles(since, since));
        // Gone with the task, the same.
        Assert.Empty((await Sync(quinn, Gone(Attachment("AQ", "TQ", "old.txt", bytes), "2026-09-01T10:00:00.000Z")))["rejected"]!.AsArray());
        Assert.Contains(Sha(bytes), index().WantedFiles(since, longer));
        // Erased when the Trash is emptied, it is wanted no more.
        Assert.Empty((await Sync(quinn, Gone(Attachment("AQ", "TQ", SharingIndex.Erased, bytes), "2026-09-01T10:00:00.000Z")))["rejected"]!.AsArray());
        Assert.DoesNotContain(Sha(bytes), index().WantedFiles(since, longer));
    }

    [Fact]
    public async Task Files_nothing_wants_any_more_are_cleaned_up()
    {
        var store = factory.Services.GetRequiredService<IAttachmentStore>();
        _ = factory.CreateClient();
        var orphan = Encoding.UTF8.GetBytes("orphan");
        Assert.Equal(PutResult.Stored, await store.PutAsync(Sha(orphan), new MemoryStream(orphan), 100, Token));
        var cleanup = ActivatorUtilities.CreateInstance<AttachmentCleanup>(factory.Services,
            new ManualTime(DateTimeOffset.UtcNow.AddDays(2)) as TimeProvider);
        // The tests here share one server, so one that ran first may have left an orphan of its own
        // (a viewer's upload the sync then refused): at least this one goes, whatever the order.
        Assert.True(await cleanup.CleanAsync(Token) >= 1);
        Assert.False(await store.ExistsAsync(Sha(orphan), Token));
    }
}
