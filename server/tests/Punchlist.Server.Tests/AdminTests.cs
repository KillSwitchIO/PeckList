using System.Net;
using System.Net.Http.Json;
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
}
