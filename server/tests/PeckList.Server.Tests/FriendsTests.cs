using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using PeckList.Core;
using PeckList.Core.Accounts;
using PeckList.Core.Sharing;
using PeckList.Core.Storage;
using PeckList.Core.Sync;

namespace PeckList.Server.Tests;

public sealed class FriendsTests(ServerFixture fixture) : IClassFixture<ServerFixture>, IDisposable
{
    private readonly WebApplicationFactory<Program> factory =
        fixture.Factory(("ADMIN_PASSWORD", "correct horse battery"), ("DB_PATH", fixture.NewDbPath()));

    private static CancellationToken Token => TestContext.Current.CancellationToken;

    public void Dispose() => factory.Dispose();

    [Fact]
    public async Task A_new_server_address_reaches_handles_at_the_next_start_and_nothing_else_changes()
    {
        const string admin = "correct horse battery";
        var path = fixture.NewDbPath();
        string id;
        using (var before = fixture.Factory(("ADMIN_PASSWORD", admin), ("DB_PATH", path), ("PUBLIC_URL", "https://old.example.com")))
        {
            _ = before.CreateClient();
            var account = await before.Services.GetRequiredService<AccountService>()
                .CreateUserAsync("olive", "a long enough password", mustChangePassword: false, cancellation: Token);
            id = account.Id;
            await before.Services.GetRequiredService<SharingState>().Loaded.WaitAsync(Token);
            await before.Services.GetRequiredService<Friends>().EnsureProfileAsync(account, "Olive Oyl", Token);
            var made = before.Services.GetRequiredService<SharingState>().Index.DocOf(id)!;
            Assert.Equal("olive@old.example.com", (string?)made["handle"]);
        }

        using var after = fixture.Factory(("ADMIN_PASSWORD", admin), ("DB_PATH", path), ("PUBLIC_URL", "https://new.example.com"));
        _ = after.CreateClient();
        var sharing = after.Services.GetRequiredService<SharingState>();
        await sharing.Loaded.WaitAsync(Token);
        var friends = after.Services.GetRequiredService<Friends>();
        for (var tries = 0; tries < 100 && (string?)sharing.Index.DocOf(id)?["handle"] != "olive@new.example.com"; tries++)
        {
            await Task.Delay(50, Token);
        }

        var profile = sharing.Index.DocOf(id)!;
        Assert.Equal("olive@new.example.com", (string?)profile["handle"]);
        Assert.Equal("new.example.com", (string?)profile["homeServer"]);
        Assert.Equal("Olive Oyl", (string?)profile["displayName"]);
        Assert.Equal("old.example.com", (string?)profile["origin"]);
        // Once in line, a start writes nothing.
        Assert.Equal(0, await friends.RefreshHandlesAsync(Token));
    }

    [Fact]
    public async Task Without_an_address_handles_stay_as_they_are()
    {
        var (_, id) = await SignIn("nomad");
        var friends = factory.Services.GetRequiredService<Friends>();
        Assert.Null(friends.Host);
        var before = factory.Services.GetRequiredService<SharingState>().Index.DocOf(id)?.ToJsonString();
        Assert.Equal(0, await friends.RefreshHandlesAsync(Token));
        Assert.Equal(before, factory.Services.GetRequiredService<SharingState>().Index.DocOf(id)?.ToJsonString());
    }

    private async Task<(HttpClient Client, string Id)> SignIn(string username)
    {
        var accounts = factory.Services.GetRequiredService<AccountService>();
        const string password = "a long enough password";
        var account = await accounts.CreateUserAsync(username, password, mustChangePassword: false, cancellation: Token);
        var client = factory.CreateClient();
        (await client.PostAsJsonAsync("/auth/login", new { username, password }, Token)).EnsureSuccessStatusCode();
        return (client, account.Id);
    }

    private static async Task<Dictionary<string, JsonObject>> PullAll(HttpClient client)
    {
        var seen = new Dictionary<string, JsonObject>();
        long? cursor = null;
        SyncResponse page;
        do
        {
            var response = await client.PostAsJsonAsync("/api/sync", new { schemaVersion = WorkspaceSchema.CurrentVersion, cursor }, Token);
            response.EnsureSuccessStatusCode();
            page = (await response.Content.ReadFromJsonAsync<SyncResponse>(Token))!;
            foreach (var change in page.Changes) seen[(string)change.Entity["id"]!] = change.Entity;
            cursor = page.Cursor;
        } while (page.More);
        return seen;
    }

    [Fact]
    public async Task Each_account_gets_a_profile_on_first_sync()
    {
        var (ben, benId) = await SignIn("ben");
        var seen = await PullAll(ben);
        var profile = seen[benId];
        Assert.Equal("ben", (string?)profile["handle"]);
        Assert.Equal("ben", (string?)profile["displayName"]);
        Assert.Matches("^#[0-9A-F]{6}$", (string?)profile["avatarColor"]);
        Assert.Equal(benId, (string?)profile["createdBy"]);
        Assert.Matches(@"-server$", (string?)profile["_hlc"]!["handle"]);
    }

    [Fact]
    public async Task A_friend_link_makes_friends_in_one_step()
    {
        var (ben, benId) = await SignIn("ben2");
        var (sam, samId) = await SignIn("sam2");
        var code = await ben.GetFromJsonAsync<FriendCode>("/api/friends/code", Token);
        Assert.Matches("^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$", code!.Code);
        Assert.EndsWith($"/f/{code.Code}", code.Link);
        Assert.Equal(code, await ben.GetFromJsonAsync<FriendCode>("/api/friends/code", Token));

        // Sam opens the link: sees who it is first.
        var preview = await sam.GetFromJsonAsync<ProfilePreview>($"/api/friends/link/{code.Code.ToLowerInvariant().Replace("-", "")}", Token);
        Assert.Equal("ben2", preview!.Username);
        Assert.False(preview.Self);
        Assert.Null(preview.Friendship);

        var accepted = await sam.PostAsync($"/api/friends/link/{code.Code}", null, Token);
        Assert.Equal(HttpStatusCode.OK, accepted.StatusCode);
        var friendshipId = (await accepted.Content.ReadFromJsonAsync<FriendshipAccepted>(Token))!.FriendshipId;

        // Both see the friendship and each other's profile.
        var benSees = await PullAll(ben);
        var samSees = await PullAll(sam);
        Assert.Equal("accepted", (string?)benSees[friendshipId]["state"]);
        Assert.Equal("accepted", (string?)samSees[friendshipId]["state"]);
        Assert.Contains(samId, benSees.Keys);
        Assert.Contains(benId, samSees.Keys);
        Assert.Equal("accepted", (await sam.GetFromJsonAsync<ProfilePreview>($"/api/friends/link/{code.Code}", Token))!.Friendship);
    }

    [Fact]
    public async Task Own_links_and_rotated_codes_lead_nowhere()
    {
        var (ben, _) = await SignIn("ben3");
        var (sam, _) = await SignIn("sam3");
        var code = (await ben.GetFromJsonAsync<FriendCode>("/api/friends/code", Token))!.Code;
        Assert.True((await ben.GetFromJsonAsync<ProfilePreview>($"/api/friends/link/{code}", Token))!.Self);
        Assert.Equal(HttpStatusCode.NotFound, (await ben.PostAsync($"/api/friends/link/{code}", null, Token)).StatusCode);

        var rotated = (await (await ben.PostAsync("/api/friends/code", null, Token)).Content.ReadFromJsonAsync<FriendCode>(Token))!.Code;
        Assert.NotEqual(code, rotated);
        Assert.Equal(HttpStatusCode.NotFound, (await sam.GetAsync($"/api/friends/link/{code}", Token)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await sam.PostAsync($"/api/friends/link/{code}", null, Token)).StatusCode);
    }

    [Fact]
    public async Task Looks_people_up_by_exact_name_only()
    {
        var (ben, _) = await SignIn("ben4");
        await SignIn("samantha4");
        Assert.Equal("samantha4", (await ben.GetFromJsonAsync<ProfilePreview>("/api/users/lookup?q=SAMANTHA4", Token))!.Username);
        Assert.Equal("samantha4", (await ben.GetFromJsonAsync<ProfilePreview>("/api/users/lookup?q=@samantha4", Token))!.Username);
        Assert.Equal(HttpStatusCode.NotFound, (await ben.GetAsync("/api/users/lookup?q=sam", Token)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await ben.GetAsync("/api/users/lookup?q=samantha4@elsewhere.example", Token)).StatusCode);
    }

    [Fact]
    public async Task An_ended_friendship_comes_back_through_the_link()
    {
        var (ben, _) = await SignIn("ben5");
        var (sam, _) = await SignIn("sam5");
        var code = (await ben.GetFromJsonAsync<FriendCode>("/api/friends/code", Token))!.Code;
        var id = (await (await sam.PostAsync($"/api/friends/link/{code}", null, Token)).Content.ReadFromJsonAsync<FriendshipAccepted>(Token))!.FriendshipId;

        // Sam ends it through sync.
        var friendship = (await PullAll(sam))[id];
        friendship["deletedAt"] = "2026-10-21T12:00:00.000Z";
        friendship["_hlc"]!["deletedAt"] = $"{DateTimeOffset.UtcNow:yyyy-MM-dd'T'HH:mm:ss.fff'Z'}-0000-dev1";
        (await sam.PostAsJsonAsync("/api/sync", new { schemaVersion = WorkspaceSchema.CurrentVersion, changes = new[] { new { collection = "friendships", entity = friendship } } }, Token)).EnsureSuccessStatusCode();
        Assert.NotNull((await PullAll(ben))[id]["deletedAt"]);

        await Task.Delay(1100, Token);
        Assert.Equal(id, (await (await sam.PostAsync($"/api/friends/link/{code}", null, Token)).Content.ReadFromJsonAsync<FriendshipAccepted>(Token))!.FriendshipId);
        var back = (await PullAll(ben))[id];
        Assert.Null(back["deletedAt"]);
        Assert.Equal("accepted", (string?)back["state"]);
    }

    private static string Later(int seconds = 1) =>
        $"{DateTimeOffset.UtcNow.AddSeconds(seconds):yyyy-MM-dd'T'HH:mm:ss.fff'Z'}-0000-dev1";

    private static async Task<IReadOnlyList<string>> Push(HttpClient client, JsonObject friendship)
    {
        var answer = await client.PostAsJsonAsync("/api/sync", new
        {
            schemaVersion = WorkspaceSchema.CurrentVersion,
            changes = new[] { new { collection = "friendships", entity = friendship } },
        }, Token);
        answer.EnsureSuccessStatusCode();
        return (await answer.Content.ReadFromJsonAsync<JsonObject>(Token))!["rejected"]!.AsArray().Select(id => (string)id!).ToList();
    }

    /// <summary>Two people made friends by a link, and <paramref name="ender"/> ending it. Returns the row's id.</summary>
    private async Task<string> EndedFriendship(HttpClient linkOwner, HttpClient other, HttpClient ender)
    {
        var code = (await linkOwner.GetFromJsonAsync<FriendCode>("/api/friends/code", Token))!.Code;
        var id = (await (await other.PostAsync($"/api/friends/link/{code}", null, Token)).Content.ReadFromJsonAsync<FriendshipAccepted>(Token))!.FriendshipId;
        var friendship = (await PullAll(ender))[id];
        friendship["deletedAt"] = "2026-10-21T12:00:00.000Z";
        friendship["_hlc"]!["deletedAt"] = Later(0);
        Assert.Empty(await Push(ender, friendship));
        return id;
    }

    private bool Know(string a, string b) => factory.Services.GetRequiredService<SharingState>().Index.Knows(a, b);

    [Fact]
    public async Task After_an_end_and_a_new_request_the_live_friendship_is_the_one_used()
    {
        var (ben, benId) = await SignIn("ben9");
        var (sam, samId) = await SignIn("sam9");
        var friends = factory.Services.GetRequiredService<Friends>();
        var sharing = factory.Services.GetRequiredService<SharingState>();
        var ended = await EndedFriendship(ben, sam, ben);

        var request = (await PullAll(sam))[ended].DeepClone().AsObject();
        var live = Ids.NewUlid();
        request["id"] = live;
        request["userA"] = samId;
        request["userB"] = benId;
        request["state"] = "pending";
        request["createdBy"] = samId;
        request["deletedAt"] = null;
        foreach (var clock in request["_hlc"]!.AsObject().Select(pair => pair.Key).ToList()) request["_hlc"]![clock] = Later(0);
        Assert.Empty(await Push(sam, request));
        var asked = (await PullAll(ben))[live];
        asked["state"] = "accepted";
        asked["_hlc"]!["state"] = Later();
        Assert.Empty(await Push(ben, asked));

        // A friend link and an admin both find the live one, and the ended one stays ended.
        var code = (await ben.GetFromJsonAsync<FriendCode>("/api/friends/code", Token))!.Code;
        Assert.Equal(live, (await (await sam.PostAsync($"/api/friends/link/{code}", null, Token)).Content.ReadFromJsonAsync<FriendshipAccepted>(Token))!.FriendshipId);
        await Task.Delay(1100, Token);
        Assert.Equal(live, await friends.MakeFriendsAsync(benId, samId, cancellation: Token));
        Assert.NotNull((await PullAll(ben))[ended]["deletedAt"]);

        Assert.Single(sharing.Index.FriendshipsOf(benId), each => each.Other == samId);
        Assert.Equal("accepted", (await ben.GetFromJsonAsync<ProfilePreview>("/api/users/lookup?q=sam9", Token))!.Friendship);

        // An admin can end it, and then there is nothing left to end.
        Assert.True(await friends.EndFriendshipAsync(benId, samId, Token));
        Assert.False(Know(benId, samId));
        Assert.Empty(sharing.Index.FriendshipsOf(benId));
        Assert.False(await friends.EndFriendshipAsync(benId, samId, Token));
        Assert.Null((await ben.GetFromJsonAsync<ProfilePreview>("/api/users/lookup?q=sam9", Token))!.Friendship);
    }

    [Fact]
    public async Task An_ended_friendship_stays_ended_whichever_side_pushes_it()
    {
        var (ben, benId) = await SignIn("ben6");
        var (sam, samId) = await SignIn("sam6");
        var id = await EndedFriendship(ben, sam, ben);

        foreach (var client in new[] { sam, ben })
        {
            var row = (await PullAll(client))[id];
            row["deletedAt"] = null;
            row["_hlc"]!["deletedAt"] = Later();
            Assert.Equal([id], await Push(client, row));
            Assert.NotNull((await PullAll(ben))[id]["deletedAt"]);
            Assert.NotNull((await PullAll(sam))[id]["deletedAt"]);
            Assert.False(Know(benId, samId));
        }
    }

    [Fact]
    public async Task After_an_end_a_new_request_the_other_side_accepts_makes_friends_again()
    {
        var (ben, benId) = await SignIn("ben7");
        var (sam, samId) = await SignIn("sam7");
        var id = await EndedFriendship(ben, sam, ben);

        var request = (await PullAll(sam))[id].DeepClone().AsObject();
        request["id"] = Ids.NewUlid();
        request["userA"] = samId;
        request["userB"] = benId;
        request["state"] = "pending";
        request["createdBy"] = samId;
        request["deletedAt"] = null;
        foreach (var clock in request["_hlc"]!.AsObject().Select(pair => pair.Key).ToList()) request["_hlc"]![clock] = Later(0);
        Assert.Empty(await Push(sam, request));
        Assert.False(Know(benId, samId));

        var asked = (await PullAll(ben))[(string)request["id"]!];
        asked["state"] = "accepted";
        asked["_hlc"]!["state"] = Later();
        Assert.Empty(await Push(ben, asked));
        Assert.True(Know(benId, samId));
    }

    /// <summary>A new pending request from <paramref name="fromId"/> to <paramref name="toId"/>, shaped like <paramref name="template"/>.</summary>
    private static JsonObject Request(JsonObject template, string fromId, string toId)
    {
        var request = template.DeepClone().AsObject();
        request["id"] = Ids.NewUlid();
        request["userA"] = fromId;
        request["userB"] = toId;
        request["state"] = "pending";
        request["createdBy"] = fromId;
        request["deletedAt"] = null;
        foreach (var clock in request["_hlc"]!.AsObject().Select(pair => pair.Key).ToList()) request["_hlc"]![clock] = Later(0);
        return request;
    }

    [Fact]
    public async Task A_second_live_request_between_two_people_is_refused_and_an_end_closes_every_row()
    {
        var (ben, benId) = await SignIn("ben10");
        var (sam, samId) = await SignIn("sam10");
        var friends = factory.Services.GetRequiredService<Friends>();
        var sharing = factory.Services.GetRequiredService<SharingState>();
        var ended = await EndedFriendship(ben, sam, ben);
        var template = (await PullAll(ben))[ended];

        // A pair that got two live rows before the server refused the second, one each way.
        var first = Request(template, samId, benId);
        var second = Request(template, benId, samId);
        await factory.Services.GetRequiredService<SyncService>().WriteAsServerAsync(samId,
            [new IncomingEntity("friendships", first), new IncomingEntity("friendships", second)], Token);
        Assert.Equal(2, sharing.Index.LiveFriendshipsBetween(benId, samId).Count);

        // A third is refused while those are live.
        var third = Request(template, samId, benId);
        Assert.Equal([(string)third["id"]!], await Push(sam, third));
        Assert.Equal(2, sharing.Index.LiveFriendshipsBetween(benId, samId).Count);

        // One end closes both, so nothing keeps them friends.
        Assert.True(await friends.EndFriendshipAsync(benId, samId, Token));
        Assert.Empty(sharing.Index.LiveFriendshipsBetween(benId, samId));
        Assert.Empty(sharing.Index.FriendshipsOf(benId));
        Assert.False(Know(benId, samId));
        var rows = await PullAll(ben);
        Assert.NotNull(rows[(string)first["id"]!]["deletedAt"]);
        Assert.NotNull(rows[(string)second["id"]!]["deletedAt"]);

        // With nothing live, a request goes through again; a second one in the same push does not.
        var again = Request(template, samId, benId);
        var twice = Request(template, samId, benId);
        var answer = await sam.PostAsJsonAsync("/api/sync", new
        {
            schemaVersion = WorkspaceSchema.CurrentVersion,
            changes = new[] { new { collection = "friendships", entity = again }, new { collection = "friendships", entity = twice } },
        }, Token);
        answer.EnsureSuccessStatusCode();
        var rejected = (await answer.Content.ReadFromJsonAsync<JsonObject>(Token))!["rejected"]!.AsArray().Select(id => (string)id!);
        Assert.Equal([(string)twice["id"]!], rejected);
        Assert.Equal([(string)again["id"]!], sharing.Index.LiveFriendshipsBetween(benId, samId).Select(each => each.Id));
    }

    [Fact]
    public async Task An_admin_can_still_make_an_ended_friendship_again()
    {
        var (ben, benId) = await SignIn("ben8");
        var (sam, samId) = await SignIn("sam8");
        var id = await EndedFriendship(ben, sam, sam);

        await Task.Delay(1100, Token);
        Assert.Equal(id, await factory.Services.GetRequiredService<Friends>().MakeFriendsAsync(benId, samId, cancellation: Token));

        Assert.Null((await PullAll(sam))[id]["deletedAt"]);
        Assert.True(Know(benId, samId));
    }
}
