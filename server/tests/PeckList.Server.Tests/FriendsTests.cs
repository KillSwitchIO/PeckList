using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using PeckList.Core;
using PeckList.Core.Accounts;
using PeckList.Core.Sharing;
using PeckList.Core.Sync;

namespace PeckList.Server.Tests;

public sealed class FriendsTests(ServerFixture fixture) : IClassFixture<ServerFixture>, IDisposable
{
    private readonly WebApplicationFactory<Program> factory =
        fixture.Factory(("ADMIN_PASSWORD", "correct horse battery"), ("DB_PATH", fixture.NewDbPath()));

    private static CancellationToken Token => TestContext.Current.CancellationToken;

    public void Dispose() => factory.Dispose();

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
}
