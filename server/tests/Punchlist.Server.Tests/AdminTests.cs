using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Punchlist.Core.Accounts;
using Punchlist.Server.Auth;

namespace Punchlist.Server.Tests;

public sealed partial class AdminTests(ServerFixture fixture) : IClassFixture<ServerFixture>, IDisposable
{
    private const string AdminPassword = "correct horse battery";

    private readonly WebApplicationFactory<Program> factory =
        fixture.Factory(("ADMIN_PASSWORD", AdminPassword), ("DB_PATH", fixture.NewDbPath()));

    private static CancellationToken Token => TestContext.Current.CancellationToken;

    public void Dispose() => factory.Dispose();

    private async Task<HttpClient> LogIn(string username, string password)
    {
        var client = factory.CreateClient();
        (await client.PostAsJsonAsync("/auth/login", new { username, password }, Token)).EnsureSuccessStatusCode();
        return client;
    }

    private async Task<(HttpClient Client, string Id)> SignIn(string username, Role role = Role.User)
    {
        const string password = "a long enough password";
        var account = await factory.Services.GetRequiredService<AccountService>()
            .CreateUserAsync(username, password, role, mustChangePassword: false, cancellation: Token);
        return (await LogIn(username, password), account.Id);
    }

    [Fact]
    public async Task Admins_see_the_groups_people_made_that_each_user_is_in()
    {
        var admin = await LogIn("admin", AdminPassword);
        var (sam, samId) = await SignIn("sam");
        var (_, kimId) = await SignIn("kim");
        const string clock = "2026-10-22T10:00:00.000Z-0000-dev1";
        var group = new JsonObject
        {
            ["id"] = "G1", ["createdAt"] = "2026-10-22T10:00:00.000Z", ["createdBy"] = samId, ["deletedAt"] = null, ["origin"] = "local",
            ["name"] = "Game night", ["color"] = "#A7C7E7", ["ownerId"] = samId, ["archived"] = false,
        };
        group["_hlc"] = new JsonObject(group.Where(pair => pair.Key != "id").Select(pair => KeyValuePair.Create(pair.Key, (JsonNode?)clock)));
        (await sam.PostAsJsonAsync("/api/sync", new
        {
            schemaVersion = Core.WorkspaceSchema.CurrentVersion,
            cursor = (long?)null,
            changes = new[] { new { collection = "groups", entity = group } },
        }, Token)).EnsureSuccessStatusCode();

        var users = (await admin.GetFromJsonAsync<AdminUser[]>("/api/admin/users", Token))!;
        Assert.Equal(["Game night"], users.Single(user => user.Id == samId).PeopleGroups);
        Assert.Empty(users.Single(user => user.Id == kimId).PeopleGroups!);
    }

    private IReadOnlyList<RouteEndpoint> AdminEndpoints()
    {
        _ = factory.CreateClient();
        return factory.Services.GetRequiredService<EndpointDataSource>().Endpoints
            .OfType<RouteEndpoint>()
            .Where(endpoint => endpoint.RoutePattern.RawText?.StartsWith("/api/admin", StringComparison.Ordinal) == true)
            .ToList();
    }

    [GeneratedRegex(@"\{[^}]+\}")]
    private static partial Regex RouteParameter();

    [Fact]
    public async Task Every_admin_endpoint_names_a_permission_and_refuses_plain_users()
    {
        var endpoints = AdminEndpoints();
        Assert.NotEmpty(endpoints);
        var (sam, _) = await SignIn("sam");
        foreach (var endpoint in endpoints)
        {
            Assert.True(endpoint.Metadata.GetMetadata<RequiresPermission>() is not null, $"{endpoint.DisplayName} names no permission");
            var method = endpoint.Metadata.GetMetadata<Microsoft.AspNetCore.Routing.HttpMethodMetadata>()!.HttpMethods.Single();
            var url = RouteParameter().Replace(endpoint.RoutePattern.RawText!, "x");
            using var request = new HttpRequestMessage(new HttpMethod(method), url) { Content = JsonContent.Create(new { }) };
            Assert.Equal(HttpStatusCode.Forbidden, (await sam.SendAsync(request, Token)).StatusCode);
        }
    }

    [Fact]
    public async Task Admins_manage_users_and_groups_but_only_super_admins_change_roles()
    {
        var (ann, _) = await SignIn("ann", Role.Admin);
        var (_, samId) = await SignIn("sam");
        Assert.Equal(HttpStatusCode.OK, (await ann.GetAsync("/api/admin/users", Token)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await ann.GetAsync("/api/admin/groups", Token)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden,
            (await ann.PutAsJsonAsync($"/api/admin/users/{samId}/role", new { role = "admin" }, Token)).StatusCode);
    }

    [Fact]
    public async Task A_new_role_applies_on_the_next_request_without_signing_in_again()
    {
        var root = await LogIn("admin", AdminPassword);
        var me = await root.GetFromJsonAsync<Me>("/auth/me", Token);
        Assert.Equal("superadmin", me!.Role);

        var (sam, samId) = await SignIn("sam");
        Assert.Equal(HttpStatusCode.Forbidden, (await sam.GetAsync("/api/admin/users", Token)).StatusCode);
        var changed = await root.PutAsJsonAsync($"/api/admin/users/{samId}/role", new { role = "admin" }, Token);
        Assert.Equal(HttpStatusCode.OK, changed.StatusCode);

        Assert.Equal(HttpStatusCode.OK, (await sam.GetAsync("/api/admin/users", Token)).StatusCode);
        Assert.Equal("admin", (await sam.GetFromJsonAsync<Me>("/auth/me", Token))!.Role);
        Assert.Equal(HttpStatusCode.BadRequest,
            (await root.PutAsJsonAsync($"/api/admin/users/{samId}/role", new { role = "owner" }, Token)).StatusCode);
    }

    [Fact]
    public async Task The_last_super_admin_cannot_step_down()
    {
        var root = await LogIn("admin", AdminPassword);
        var users = await root.GetFromJsonAsync<AdminUser[]>("/api/admin/users", Token);
        var admin = users!.Single(user => user.Username == "admin");
        var refused = await root.PutAsJsonAsync($"/api/admin/users/{admin.Id}/role", new { role = "user" }, Token);
        Assert.Equal(HttpStatusCode.Conflict, refused.StatusCode);
        Assert.Equal("last_super_admin", (await refused.Content.ReadFromJsonAsync<AdminError>(Token))!.Error);
    }

    [Fact]
    public async Task Server_groups_are_made_filled_renamed_and_deleted()
    {
        var root = await LogIn("admin", AdminPassword);
        var (_, samId) = await SignIn("sam");

        var made = await root.PostAsJsonAsync("/api/admin/groups", new { name = " Family ", offeredForSharing = true }, Token);
        Assert.Equal(HttpStatusCode.Created, made.StatusCode);
        var family = (await made.Content.ReadFromJsonAsync<AdminGroup>(Token))!;
        Assert.Equal("Family", family.Name);
        Assert.Equal(HttpStatusCode.Conflict, (await root.PostAsJsonAsync("/api/admin/groups", new { name = "FAMILY" }, Token)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await root.PostAsJsonAsync("/api/admin/groups", new { name = "  " }, Token)).StatusCode);

        Assert.Equal(HttpStatusCode.NoContent, (await root.PutAsync($"/api/admin/groups/{family.Id}/members/{samId}", null, Token)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await root.PutAsync($"/api/admin/groups/{family.Id}/members/nobody", null, Token)).StatusCode);
        var groups = await root.GetFromJsonAsync<AdminGroup[]>("/api/admin/groups", Token);
        var member = Assert.Single(Assert.Single(groups!).Members);
        Assert.Equal(samId, member.AccountId);
        Assert.True(family.OfferedForSharing);
        Assert.Equal(["manual"], member.Sources);
        var users = await root.GetFromJsonAsync<AdminUser[]>("/api/admin/users", Token);
        Assert.Equal([family.Id], users!.Single(user => user.Id == samId).Groups);

        var renamed = await root.PatchAsJsonAsync($"/api/admin/groups/{family.Id}", new { name = "Household" }, Token);
        Assert.Equal("Household", (await renamed.Content.ReadFromJsonAsync<AdminGroup>(Token))!.Name);
        Assert.Equal(HttpStatusCode.NoContent, (await root.DeleteAsync($"/api/admin/groups/{family.Id}/members/{samId}", Token)).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await root.DeleteAsync($"/api/admin/groups/{family.Id}", Token)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await root.DeleteAsync($"/api/admin/groups/{family.Id}", Token)).StatusCode);
    }

    [Fact]
    public async Task Admins_add_people_who_choose_their_own_password_first()
    {
        var (ann, _) = await SignIn("ann", Role.Admin);
        var made = await ann.PostAsJsonAsync("/api/admin/users", new { username = "zoe" }, Token);
        Assert.Equal(HttpStatusCode.Created, made.StatusCode);
        var zoe = (await made.Content.ReadFromJsonAsync<NewUser>(Token))!;
        Assert.Equal(("zoe", "user"), (zoe.Username, zoe.Role));
        var zoeClient = await LogIn("zoe", zoe.Password);
        Assert.True((await zoeClient.GetFromJsonAsync<Me>("/auth/me", Token))!.MustChangePassword);

        Assert.Equal(HttpStatusCode.Conflict, (await ann.PostAsJsonAsync("/api/admin/users", new { username = "ZOE" }, Token)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await ann.PostAsJsonAsync("/api/admin/users", new { username = "Zoe Q" }, Token)).StatusCode);
        // Only super admins make admins.
        Assert.Equal(HttpStatusCode.Forbidden, (await ann.PostAsJsonAsync("/api/admin/users", new { username = "max", role = "admin" }, Token)).StatusCode);
    }

    [Fact]
    public async Task Turning_an_account_off_ends_its_sessions_until_it_is_back_on()
    {
        var root = await LogIn("admin", AdminPassword);
        var (sam, samId) = await SignIn("sam");
        Assert.Equal(HttpStatusCode.NoContent, (await root.PutAsJsonAsync($"/api/admin/users/{samId}/disabled", new { disabled = true }, Token)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await sam.GetAsync("/auth/me", Token)).StatusCode);
        var again = await factory.CreateClient().PostAsJsonAsync("/auth/login", new { username = "sam", password = "a long enough password" }, Token);
        Assert.Equal(HttpStatusCode.Unauthorized, again.StatusCode);
        var users = await root.GetFromJsonAsync<AdminUser[]>("/api/admin/users", Token);
        Assert.True(users!.Single(user => user.Id == samId).Disabled);

        Assert.Equal(HttpStatusCode.NoContent, (await root.PutAsJsonAsync($"/api/admin/users/{samId}/disabled", new { disabled = false }, Token)).StatusCode);
        await LogIn("sam", "a long enough password");

        var rootId = users!.Single(user => user.Username == "admin").Id;
        Assert.Equal(HttpStatusCode.Conflict, (await root.PutAsJsonAsync($"/api/admin/users/{rootId}/disabled", new { disabled = true }, Token)).StatusCode);
    }

    [Fact]
    public async Task A_reset_password_must_be_changed_and_admins_leave_other_admins_alone()
    {
        var (ann, _) = await SignIn("ann", Role.Admin);
        var (sam, samId) = await SignIn("sam");
        var reset = await ann.PostAsJsonAsync($"/api/admin/users/{samId}/password", new { }, Token);
        var password = (await reset.Content.ReadFromJsonAsync<PasswordReset>(Token))!.Password;
        Assert.Equal(HttpStatusCode.Unauthorized, (await sam.GetAsync("/auth/me", Token)).StatusCode);
        Assert.True((await (await LogIn("sam", password)).GetFromJsonAsync<Me>("/auth/me", Token))!.MustChangePassword);
        Assert.Equal(HttpStatusCode.BadRequest, (await ann.PostAsJsonAsync($"/api/admin/users/{samId}/password", new { password = "short" }, Token)).StatusCode);

        var users = await ann.GetFromJsonAsync<AdminUser[]>("/api/admin/users", Token);
        var rootId = users!.Single(user => user.Username == "admin").Id;
        Assert.Equal(HttpStatusCode.Forbidden, (await ann.PostAsJsonAsync($"/api/admin/users/{rootId}/password", new { }, Token)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await ann.PutAsJsonAsync($"/api/admin/users/{rootId}/disabled", new { disabled = true }, Token)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await ann.PostAsync($"/api/admin/users/{rootId}/login-link", null, Token)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await ann.PostAsJsonAsync("/api/admin/users/nobody/password", new { }, Token)).StatusCode);
    }

    [Fact]
    public async Task Admins_make_and_end_friendships()
    {
        var root = await LogIn("admin", AdminPassword);
        var (sam, samId) = await SignIn("sam");
        var (kim, kimId) = await SignIn("kim");
        var made = await root.PostAsJsonAsync("/api/admin/friendships", new { userA = samId, userB = kimId }, Token);
        Assert.Equal(HttpStatusCode.OK, made.StatusCode);
        var friends = await root.GetFromJsonAsync<AdminFriend[]>($"/api/admin/users/{samId}/friends", Token);
        Assert.Equal([new AdminFriend(kimId, "kim", "accepted")], friends!);
        // Sam's devices get it on the next sync.
        var pulled = await sam.PostAsJsonAsync("/api/sync", new { schemaVersion = Core.WorkspaceSchema.CurrentVersion, cursor = (long?)null }, Token);
        Assert.Contains(kimId, await pulled.Content.ReadAsStringAsync(Token));
        // Both see which admin made it.
        var adminId = (await root.GetFromJsonAsync<Me>("/auth/me", Token))!.Id;
        var friendship = await FriendshipOf(sam);
        Assert.Equal(adminId, (string?)friendship["madeBy"]?["id"]);
        Assert.Equal("admin", (string?)friendship["madeBy"]?["name"]);
        Assert.Equal("admin", (string?)(await FriendshipOf(kim))["madeBy"]?["name"]);

        Assert.Equal(HttpStatusCode.NoContent, (await root.DeleteAsync($"/api/admin/friendships/{kimId}/{samId}", Token)).StatusCode);
        Assert.Empty((await root.GetFromJsonAsync<AdminFriend[]>($"/api/admin/users/{samId}/friends", Token))!);
        Assert.Equal(HttpStatusCode.NotFound, (await root.DeleteAsync($"/api/admin/friendships/{kimId}/{samId}", Token)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await root.PostAsJsonAsync("/api/admin/friendships", new { userA = samId, userB = samId }, Token)).StatusCode);

        // Made again by the two themselves: no admin's name on it any more.
        var code = (await kim.GetFromJsonAsync<System.Text.Json.Nodes.JsonObject>("/api/friends/code", Token))!["code"]!.ToString();
        (await sam.PostAsync($"/api/friends/link/{code}", null, Token)).EnsureSuccessStatusCode();
        var again = await FriendshipOf(sam);
        Assert.Null(again["deletedAt"]);
        Assert.Null(again["madeBy"]);
    }

    /// <summary>The one friendship the account's devices hold, from a full pull.</summary>
    private static async Task<System.Text.Json.Nodes.JsonObject> FriendshipOf(HttpClient client)
    {
        var pulled = await client.PostAsJsonAsync("/api/sync", new { schemaVersion = Core.WorkspaceSchema.CurrentVersion, cursor = (long?)null }, Token);
        var page = (await pulled.Content.ReadFromJsonAsync<System.Text.Json.Nodes.JsonObject>(Token))!;
        return page["changes"]!.AsArray()
            .Where(change => (string?)change!["collection"] == "friendships")
            .Select(change => change!["entity"]!.AsObject())
            .Single();
    }

    private static async Task<HttpResponseMessage> Viewing(HttpClient client, string token, HttpMethod method, string path, object? body = null)
    {
        using var request = new HttpRequestMessage(method, path);
        request.Headers.Add(ImpersonationSetup.Header, token);
        if (body is not null) request.Content = JsonContent.Create(body);
        return await client.SendAsync(request, Token);
    }

    private static async Task<string> StartViewing(HttpClient root, string userId)
    {
        var started = await root.PostAsJsonAsync($"/api/admin/users/{userId}/impersonate", new { reason = "Sam asked for help" }, Token);
        Assert.Equal(HttpStatusCode.OK, started.StatusCode);
        return (await started.Content.ReadFromJsonAsync<ImpersonationStart>(Token))!.Token;
    }

    [Fact]
    public async Task A_super_admin_views_as_someone_in_one_tab_only()
    {
        var root = await LogIn("admin", AdminPassword);
        var (sam, samId) = await SignIn("sam");
        var list = new System.Text.Json.Nodes.JsonObject
        {
            ["id"] = "L-SAM",
            ["name"] = "Sam's chores",
            ["deletedAt"] = null,
            ["_hlc"] = new System.Text.Json.Nodes.JsonObject { ["name"] = "2026-10-22T10:00:00.000Z-0000-dev1" },
        };
        (await sam.PostAsJsonAsync("/api/sync", new { schemaVersion = Core.WorkspaceSchema.CurrentVersion, cursor = (long?)null, changes = new[] { new { collection = "lists", entity = list } } }, Token)).EnsureSuccessStatusCode();

        var token = await StartViewing(root, samId);
        var me = await (await Viewing(root, token, HttpMethod.Get, "/auth/me")).Content.ReadFromJsonAsync<Me>(Token);
        Assert.Equal(("sam", "admin", "Sam asked for help"), (me!.Username, me.Impersonation!.By, me.Impersonation.Reason));
        // The same browser without the header is still the admin.
        Assert.Equal("admin", (await root.GetFromJsonAsync<Me>("/auth/me", Token))!.Username);

        var synced = await Viewing(root, token, HttpMethod.Post, "/api/sync", new { schemaVersion = Core.WorkspaceSchema.CurrentVersion, cursor = (long?)null });
        Assert.Contains("Sam's chores", await synced.Content.ReadAsStringAsync(Token));

        // Accounts are out of bounds while viewing.
        Assert.Equal(HttpStatusCode.Forbidden, (await Viewing(root, token, HttpMethod.Get, "/api/admin/users")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await Viewing(root, token, HttpMethod.Post, "/auth/password", new { current = "x", next = "y" })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await Viewing(root, token, HttpMethod.Get, "/api/account/sign-in")).StatusCode);

        Assert.Equal(HttpStatusCode.NoContent, (await Viewing(root, token, HttpMethod.Delete, "/auth/impersonation")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await Viewing(root, token, HttpMethod.Get, "/auth/me")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await root.GetAsync("/auth/me", Token)).StatusCode);
    }

    [Fact]
    public async Task Only_super_admins_view_as_others_and_never_as_one_another()
    {
        var root = await LogIn("admin", AdminPassword);
        var (ann, _) = await SignIn("ann", Role.Admin);
        var (_, samId) = await SignIn("sam");
        var (_, otherRootId) = await SignIn("root2", Role.SuperAdmin);
        Assert.Equal(HttpStatusCode.Forbidden,
            (await ann.PostAsJsonAsync($"/api/admin/users/{samId}/impersonate", new { reason = "curious" }, Token)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict,
            (await root.PostAsJsonAsync($"/api/admin/users/{otherRootId}/impersonate", new { reason = "curious" }, Token)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,
            (await root.PostAsJsonAsync($"/api/admin/users/{samId}/impersonate", new { reason = " " }, Token)).StatusCode);

        // A token only works with the session of the admin who started it.
        var token = await StartViewing(root, samId);
        Assert.Equal(HttpStatusCode.Unauthorized, (await Viewing(ann, token, HttpMethod.Get, "/auth/me")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Viewing(root, token, HttpMethod.Get, "/auth/me")).StatusCode);
    }
}
