using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using PeckList.Core;
using PeckList.Core.Accounts;
using PeckList.Core.Audit;
using PeckList.Server.Audit;
using PeckList.Server.Auth;

namespace PeckList.Server.Tests;

/// <summary>
/// Start over (spec: PL-147): the person's own data erased, their account kept, with the same proof
/// as Delete my account; shared lists go on to the next person, and their devices start over.
/// </summary>
public sealed class StartOverTests(ServerFixture fixture) : IClassFixture<ServerFixture>
{
    private const string AdminPassword = "correct horse battery";
    private const string Password = "a long enough password";

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

    private static Task<HttpResponseMessage> StartOver(HttpClient client, string? password) =>
        client.PostAsJsonAsync("/api/account/start-over", new { password }, Token);

    private static int clock;

    private static object Change(string collection, JsonObject fields)
    {
        var stamp = $"2026-11-17T11:{Interlocked.Increment(ref clock) / 60 % 60:D2}:{clock % 60:D2}.000Z-0000-dev1";
        fields["deletedAt"] ??= null;
        var clocks = new JsonObject();
        foreach (var (field, _) in fields) if (field != "id") clocks[field] = stamp;
        fields["_hlc"] = clocks;
        return new { collection, entity = fields };
    }

    /// <summary>Push changes (if any) and pull everything: what the device sees, by id, and the epoch it goes by.</summary>
    private static async Task<(Dictionary<string, JsonObject> Seen, string Epoch)> Sync(HttpClient client, string? epoch = null, params object[] changes)
    {
        var response = await client.PostAsJsonAsync("/api/sync", new { schemaVersion = WorkspaceSchema.CurrentVersion, cursor = (long?)null, changes, epoch }, Token);
        response.EnsureSuccessStatusCode();
        var body = (await response.Content.ReadFromJsonAsync<JsonObject>(Token))!;
        var seen = body["changes"]!.AsArray().Select(each => each!["entity"]!.AsObject()).ToDictionary(each => (string)each["id"]!);
        return (seen, (string)body["epoch"]!);
    }

    /// <summary>A list of theirs with one task in it, T1.</summary>
    private static object[] Mine(string userId) =>
    [
        Change("lists", new JsonObject { ["id"] = "L1", ["name"] = "Mine", ["visibility"] = "private", ["createdBy"] = userId }),
        Change("tasks", new JsonObject { ["id"] = "T1", ["listId"] = "L1", ["title"] = "Mine", ["parentId"] = null, ["createdBy"] = userId }),
    ];

    private static async Task<JsonNode?> DeletedAt(WebApplicationFactory<Program> server, string id) =>
        (await server.Services.GetRequiredService<Core.Storage.IEntityStore>().GetAsync(id, Token))!.Doc["deletedAt"];

    [Fact]
    public async Task With_the_password_their_own_things_go_the_account_stays_and_only_their_devices_start_over()
    {
        using var server = fixture.Factory(("ADMIN_PASSWORD", AdminPassword));
        var (sam, samId) = await NewUser(server, "sam");
        var samPhone = await LogIn(server, "sam", Password);
        var (kim, _) = await NewUser(server, "kim");
        var (_, kimEpoch) = await Sync(kim);
        var (_, samEpoch) = await Sync(samPhone);
        await Sync(sam, null,
            Change("lists", new JsonObject { ["id"] = "IN", ["name"] = "Inbox", ["isInbox"] = true, ["visibility"] = "private", ["createdBy"] = samId }),
            Change("tasks", new JsonObject { ["id"] = "T0", ["listId"] = "IN", ["title"] = "In the inbox", ["parentId"] = null, ["createdBy"] = samId }),
            Change("lists", new JsonObject { ["id"] = "L2", ["name"] = "Diary", ["visibility"] = "private", ["createdBy"] = samId }),
            Change("sections", new JsonObject { ["id"] = "S2", ["listId"] = "L2", ["name"] = "Monday", ["createdBy"] = samId }),
            Change("tasks", new JsonObject { ["id"] = "T2", ["listId"] = "L2", ["title"] = "Private", ["parentId"] = null, ["createdBy"] = samId }),
            Change("comments", new JsonObject { ["id"] = "C2", ["taskId"] = "T2", ["body"] = "Note to self", ["editedAt"] = null }),
            Change("tags", new JsonObject { ["id"] = "G2", ["name"] = "home", ["color"] = "#CFE3A3", ["order"] = "V" }));

        var info = await sam.GetFromJsonAsync<StartOverInfo>("/api/account/start-over", Token);
        Assert.Equal(new StartOverInfo("password", true, null), info);

        // No password, or the wrong one: nothing happens.
        Assert.Equal(HttpStatusCode.BadRequest, (await StartOver(sam, null)).StatusCode);
        var wrong = await StartOver(sam, "not my password");
        Assert.Equal("wrong_password", (await wrong.Content.ReadFromJsonAsync<AuthError>(Token))!.Error);
        Assert.Null(await DeletedAt(server, "T2"));

        var done = await StartOver(sam, Password);
        Assert.Equal(HttpStatusCode.OK, done.StatusCode);
        Assert.Equal(new StartedOver(6, 0), await done.Content.ReadFromJsonAsync<StartedOver>(Token));

        // Everything of theirs is gone but the Inbox, emptied; still signed in, here and elsewhere.
        foreach (var id in new[] { "T0", "L2", "S2", "T2", "C2", "G2" }) Assert.NotNull(await DeletedAt(server, id));
        Assert.Null(await DeletedAt(server, "IN"));
        Assert.NotNull(await server.Services.GetRequiredService<IAccountStore>().FindByIdAsync(samId, Token));

        // Their devices go by a new epoch, so each starts over; one still on the old one writes nothing.
        var (_, after) = await Sync(sam);
        Assert.NotEqual(samEpoch, after);
        Assert.StartsWith(samEpoch, after);
        var stale = await samPhone.PostAsJsonAsync("/api/sync", new
        {
            schemaVersion = WorkspaceSchema.CurrentVersion,
            cursor = (long?)null,
            epoch = samEpoch,
            changes = new[] { Change("tasks", new JsonObject { ["id"] = "T9", ["listId"] = "L2", ["title"] = "From before", ["parentId"] = null, ["createdBy"] = samId }) },
        }, Token);
        Assert.Equal(after, (string?)(await stale.Content.ReadFromJsonAsync<JsonObject>(Token))!["epoch"]);
        Assert.Null(await server.Services.GetRequiredService<Core.Storage.IEntityStore>().GetAsync("T9", Token));
        // Nobody else's devices start over.
        Assert.Equal(kimEpoch, (await Sync(kim)).Epoch);

        await server.Services.GetRequiredService<AuditLog>().FlushAsync(Token);
        var events = (await server.Services.GetRequiredService<IAuditStore>().QueryAsync(new AuditQuery { Ascending = true }, Token)).Entries;
        var audited = events.Where(entry => entry.Type == "account.started-over").ToList();
        Assert.Contains(audited, entry => entry.Outcome == AuditOutcome.Ok && entry.ActorName == "sam" && entry.TargetId == samId && entry.Detail == "6 things erased, 0 shared lists handed on");
        Assert.Contains(audited, entry => entry.Outcome != AuditOutcome.Ok);
    }

    [Fact]
    public async Task Shared_lists_go_on_to_the_next_person_and_what_they_added_to_others_lists_stays_but_their_comments()
    {
        using var server = fixture.Factory(("ADMIN_PASSWORD", AdminPassword));
        var admin = await LogIn(server, "admin", AdminPassword);
        var (sam, samId) = await NewUser(server, "sam");
        var (kim, kimId) = await NewUser(server, "kim");
        (await admin.PostAsJsonAsync("/api/admin/friendships", new { userA = samId, userB = kimId }, Token)).EnsureSuccessStatusCode();
        // Sam's shared list with Kim editing, and Kim's list Sam is on.
        await Sync(sam, null,
            Change("lists", new JsonObject { ["id"] = "L1", ["name"] = "House", ["visibility"] = "shared", ["createdBy"] = samId }),
            Change("listMembers", new JsonObject { ["id"] = "M1", ["listId"] = "L1", ["principal"] = $"user:{kimId}", ["role"] = "editor", ["createdBy"] = samId, ["createdAt"] = "2026-11-01T00:00:00.000Z" }),
            Change("tasks", new JsonObject { ["id"] = "T1", ["listId"] = "L1", ["title"] = "Sam's chore in the shared list", ["parentId"] = null, ["createdBy"] = samId }),
            Change("groups", new JsonObject { ["id"] = "G1", ["name"] = "Family", ["color"] = "#A7C7E7", ["ownerId"] = samId, ["archived"] = false, ["createdBy"] = samId }));
        await Sync(kim, null,
            Change("lists", new JsonObject { ["id"] = "KL", ["name"] = "Garden", ["visibility"] = "shared", ["createdBy"] = kimId }),
            Change("listMembers", new JsonObject { ["id"] = "KM", ["listId"] = "KL", ["principal"] = $"user:{samId}", ["role"] = "editor", ["createdBy"] = kimId, ["createdAt"] = "2026-11-01T00:00:00.000Z" }),
            Change("tasks", new JsonObject { ["id"] = "KT", ["listId"] = "KL", ["title"] = "Kim's task", ["parentId"] = null, ["createdBy"] = kimId }));
        await Sync(sam, null,
            Change("tasks", new JsonObject { ["id"] = "ST", ["listId"] = "KL", ["title"] = "Sam's task in Kim's list", ["parentId"] = null, ["createdBy"] = samId }),
            Change("comments", new JsonObject { ["id"] = "SC", ["taskId"] = "KT", ["body"] = "I'll water them", ["editedAt"] = null }));
        // Kim's own task and comment in Sam's shared list.
        await Sync(kim, null,
            Change("tasks", new JsonObject { ["id"] = "K1", ["listId"] = "L1", ["title"] = "Kim's chore in Sam's list", ["parentId"] = null, ["createdBy"] = kimId }),
            Change("comments", new JsonObject { ["id"] = "KC", ["taskId"] = "T1", ["body"] = "Done by Friday", ["editedAt"] = null }));

        var done = await StartOver(sam, Password);
        Assert.Equal(1, (await done.Content.ReadFromJsonAsync<StartedOver>(Token))!.HandedOn);

        // Kim owns the shared list now, with what is in it.
        var (seen, _) = await Sync(kim);
        Assert.Equal(kimId, (string?)seen["L1"]["ownerId"]);
        Assert.Null(seen["L1"]["deletedAt"]);
        Assert.Null(seen["T1"]["deletedAt"]);
        Assert.Null(seen["M1"]["deletedAt"]);
        // Nothing of Kim's goes: Kim's task and comment in the list, and Kim's task in Kim's own list.
        Assert.Null(await DeletedAt(server, "K1"));
        Assert.Null(await DeletedAt(server, "KC"));
        Assert.Null(await DeletedAt(server, "KT"));
        // In Kim's list, Sam's task stays; Sam's comment and Sam's place on it go.
        Assert.Null(seen["ST"]["deletedAt"]);
        Assert.NotNull(await DeletedAt(server, "SC"));
        Assert.NotNull(await DeletedAt(server, "KM"));
        // Groups stay theirs.
        Assert.Null(await DeletedAt(server, "G1"));
    }

    [Fact]
    public async Task Wrong_passwords_lock_the_account_as_at_sign_in_and_nothing_goes()
    {
        using var server = fixture.Factory(("ADMIN_PASSWORD", AdminPassword));
        var (sam, samId) = await NewUser(server, "sam");
        await Sync(sam, null, Mine(samId));

        for (var attempt = 1; attempt < AccountService.MaxFailedLogins; attempt++)
        {
            Assert.Equal(HttpStatusCode.BadRequest, (await StartOver(sam, $"guess {attempt}")).StatusCode);
        }
        var locked = await StartOver(sam, "one more guess");
        Assert.Equal(HttpStatusCode.Locked, locked.StatusCode);
        Assert.Equal("locked", (await locked.Content.ReadFromJsonAsync<AuthError>(Token))!.Error);
        Assert.NotNull(locked.Headers.RetryAfter?.Delta);
        // The right password waits too, and nothing was erased.
        Assert.Equal(HttpStatusCode.Locked, (await StartOver(sam, Password)).StatusCode);
        Assert.Null(await DeletedAt(server, "T1"));
    }

    [Fact]
    public async Task Removing_the_account_later_drops_their_own_epoch()
    {
        using var server = fixture.Factory(("ADMIN_PASSWORD", AdminPassword), ("ACCOUNT_DELETE_GRACE_DAYS", "0"));
        var (sam, samId) = await NewUser(server, "sam");
        await Sync(sam, null, Mine(samId));
        Assert.Equal(HttpStatusCode.OK, (await StartOver(sam, Password)).StatusCode);
        var secrets = server.Services.GetRequiredService<ISecretStore>();
        Assert.NotNull(await secrets.GetAsync(Core.Sync.ServerEpoch.PersonKind, samId, Token));

        Assert.Equal(HttpStatusCode.OK, (await sam.PostAsJsonAsync("/api/account/delete", new { password = Password }, Token)).StatusCode);
        Assert.Null(await secrets.GetAsync(Core.Sync.ServerEpoch.PersonKind, samId, Token));
    }

    [Fact]
    public async Task Without_a_password_it_takes_a_sign_in_in_the_last_ten_minutes()
    {
        var time = new ManualTime(DateTimeOffset.UtcNow);
        using var server = fixture.Factory(("ADMIN_PASSWORD", AdminPassword))
            .WithWebHostBuilder(host => host.ConfigureTestServices(services => services.AddSingleton<TimeProvider>(time)));
        var (sam, samId) = await NewUser(server, "sam");
        await Sync(sam, null, Mine(samId));
        var store = server.Services.GetRequiredService<IAccountStore>();
        await store.UpdateAsync((await store.FindByIdAsync(samId, Token))! with { PasswordHash = null }, Token);
        Assert.Equal(new StartOverInfo("sign-in", true, null), await sam.GetFromJsonAsync<StartOverInfo>("/api/account/start-over", Token));

        time.Now = time.Now.AddMinutes(11);
        var stale = await StartOver(sam, "anything");
        Assert.Equal(HttpStatusCode.Forbidden, stale.StatusCode);
        Assert.Equal("sign_in_again", (await stale.Content.ReadFromJsonAsync<AdminError>(Token))!.Error);
        Assert.Null(await DeletedAt(server, "T1"));
    }

    [Fact]
    public async Task Never_by_an_admin_viewing_as_them_nor_with_an_API_key()
    {
        using var server = fixture.Factory(("ADMIN_PASSWORD", AdminPassword), ("DB_PATH", fixture.NewDbPath()));
        var admin = await LogIn(server, "admin", AdminPassword);
        var (sam, samId) = await NewUser(server, "sam");
        await Sync(sam, null, Mine(samId));

        var started = await admin.PostAsJsonAsync($"/api/admin/users/{samId}/impersonate", new { reason = "Sam asked for help" }, Token);
        var viewing = (await started.Content.ReadFromJsonAsync<ImpersonationStart>(Token))!.Token;
        // Viewing as someone never reaches account routes at all, reads included.
        using (var request = new HttpRequestMessage(HttpMethod.Get, "/api/account/start-over"))
        {
            request.Headers.Add(ImpersonationSetup.Header, viewing);
            var refused = await admin.SendAsync(request, Token);
            Assert.Equal(HttpStatusCode.Forbidden, refused.StatusCode);
            Assert.Equal("not_while_impersonating", (await refused.Content.ReadFromJsonAsync<AdminError>(Token))!.Error);
        }
        using (var request = new HttpRequestMessage(HttpMethod.Post, "/api/account/start-over") { Content = JsonContent.Create(new { password = Password }) })
        {
            request.Headers.Add(ImpersonationSetup.Header, viewing);
            Assert.Equal(HttpStatusCode.Forbidden, (await admin.SendAsync(request, Token)).StatusCode);
        }

        var made = await sam.PostAsJsonAsync("/api/account/api-keys", new { name = "Everything", scopes = new[] { "tasks:read", "tasks:write" } }, Token);
        var key = server.CreateClient();
        key.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", (await made.Content.ReadFromJsonAsync<ApiKeyAuth.CreatedKey>(Token))!.Token);
        Assert.Equal(HttpStatusCode.Forbidden, (await StartOver(key, Password)).StatusCode);

        Assert.Null(await DeletedAt(server, "T1"));
    }
}
