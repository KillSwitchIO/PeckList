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
