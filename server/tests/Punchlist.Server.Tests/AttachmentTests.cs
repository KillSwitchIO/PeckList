using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Punchlist.Core;
using Punchlist.Core.Accounts;
using Punchlist.Core.Attachments;
using Punchlist.Server.Attachments;

namespace Punchlist.Server.Tests;

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
        Assert.Equal(1, await cleanup.CleanAsync(Token));
        Assert.False(await store.ExistsAsync(Sha(orphan), Token));
    }
}
