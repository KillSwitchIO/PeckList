using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using PeckList.Core;
using PeckList.Server.Auth;

namespace PeckList.Server.Tests;

/// <summary>API keys over HTTP (R-FB-157): made by a session, used as a bearer token, only as far as their scopes reach.</summary>
public sealed class ApiKeyTests(ServerFixture fixture) : IClassFixture<ServerFixture>
{
    private const string AdminPassword = "correct horse battery";
    private const string Clock = "2026-10-22T10:00:00.000Z-0000-dev1";

    private static CancellationToken Token => TestContext.Current.CancellationToken;

    private static async Task<HttpClient> LogIn(WebApplicationFactory<Program> server)
    {
        var client = server.CreateClient();
        (await client.PostAsJsonAsync("/auth/login", new { username = "admin", password = AdminPassword }, Token)).EnsureSuccessStatusCode();
        return client;
    }

    private static HttpClient WithKey(WebApplicationFactory<Program> server, string token)
    {
        var client = server.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    private static JsonObject Tag() => new()
    {
        ["id"] = "01JBTAG0000000000000000001", ["name"] = "api", ["color"] = "#A7C7E7", ["order"] = "a0", ["deletedAt"] = null,
        ["_hlc"] = new JsonObject { ["name"] = Clock, ["color"] = Clock, ["order"] = Clock, ["deletedAt"] = Clock },
    };

    private static Task<HttpResponseMessage> Sync(HttpClient client, bool withChange)
    {
        var changes = new JsonArray();
        if (withChange) changes.Add(new JsonObject { ["collection"] = "tags", ["entity"] = Tag() });
        var body = new JsonObject
        {
            ["schemaVersion"] = WorkspaceSchema.CurrentVersion,
            ["cursor"] = null,
            ["changes"] = changes,
        };
        return client.PostAsJsonAsync("/api/sync", body, Token);
    }

    [Fact]
    public async Task A_read_key_pulls_but_may_not_push_manage_keys_or_reach_admin_and_stops_when_revoked()
    {
        using var server = fixture.Factory(("ADMIN_PASSWORD", AdminPassword), ("DB_PATH", fixture.NewDbPath()));
        var session = await LogIn(server);
        var made = await session.PostAsJsonAsync("/api/account/api-keys",
            new { name = "Dashboard", scopes = new[] { "tasks:read" }, expiresAt = DateTimeOffset.UtcNow.AddDays(30) }, Token);
        made.EnsureSuccessStatusCode();
        var created = await made.Content.ReadFromJsonAsync<ApiKeyAuth.CreatedKey>(Token);
        Assert.StartsWith("pl_", created!.Token);

        var listed = await session.GetFromJsonAsync<List<ApiKeyAuth.KeyView>>("/api/account/api-keys", Token);
        Assert.Equal("Dashboard", Assert.Single(listed!).Name);
        Assert.DoesNotContain(created.Token[^20..], await session.GetStringAsync("/api/account/api-keys", Token));

        var key = WithKey(server, created.Token);
        Assert.Equal(HttpStatusCode.OK, (await Sync(key, withChange: false)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await Sync(key, withChange: true)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await key.GetAsync("/api/account/api-keys", Token)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await key.GetAsync("/api/admin/users", Token)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await key.GetAsync("/api/notifications", Token)).StatusCode);

        Assert.Equal(HttpStatusCode.NoContent, (await session.DeleteAsync($"/api/account/api-keys/{created.Key.Id}", Token)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await Sync(key, withChange: false)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await Sync(WithKey(server, "pl_nope_nothing"), withChange: false)).StatusCode);
    }

    [Fact]
    public void Revoked_keys_are_cleared_while_the_server_runs()
    {
        using var server = fixture.Factory(("ADMIN_PASSWORD", AdminPassword), ("DB_PATH", fixture.NewDbPath()));
        Assert.Contains(server.Services.GetServices<Microsoft.Extensions.Hosting.IHostedService>(), service => service is ApiKeyRetention);
    }

    [Fact]
    public async Task A_write_key_pushes_and_an_admin_key_reaches_the_admin_api()
    {
        using var server = fixture.Factory(("ADMIN_PASSWORD", AdminPassword), ("DB_PATH", fixture.NewDbPath()));
        var session = await LogIn(server);
        var made = await session.PostAsJsonAsync("/api/account/api-keys",
            new { name = "Automation", scopes = new[] { "tasks:write", "admin" } }, Token);
        var created = await made.Content.ReadFromJsonAsync<ApiKeyAuth.CreatedKey>(Token);
        Assert.Equal(["tasks:read", "tasks:write", "admin"], created!.Key.Scopes);
        var key = WithKey(server, created.Token);
        Assert.Equal(HttpStatusCode.OK, (await Sync(key, withChange: true)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await key.GetAsync("/api/admin/users", Token)).StatusCode);

        var refused = await session.PostAsJsonAsync("/api/account/api-keys", new { name = "x", scopes = Array.Empty<string>() }, Token);
        Assert.Equal(HttpStatusCode.BadRequest, refused.StatusCode);
    }

    [Fact]
    public async Task An_admin_key_does_not_view_as_anyone_nor_sign_its_own_account_in_some_other_way()
    {
        using var server = fixture.Factory(("ADMIN_PASSWORD", AdminPassword), ("DB_PATH", fixture.NewDbPath()));
        var session = await LogIn(server);
        var sam = await server.Services.GetRequiredService<Core.Accounts.AccountService>()
            .CreateUserAsync("sam", "a long enough password", mustChangePassword: false, cancellation: Token);
        var me = (await session.GetFromJsonAsync<JsonObject>("/auth/me", Token))!;
        var myId = (string)me["id"]!;
        var made = await session.PostAsJsonAsync("/api/account/api-keys", new { name = "Admin only", scopes = new[] { "admin" } }, Token);
        var key = WithKey(server, (await made.Content.ReadFromJsonAsync<ApiKeyAuth.CreatedKey>(Token))!.Token);

        // View-as is the browser's: a key neither starts one nor rides one a session started.
        var start = await key.PostAsJsonAsync($"/api/admin/users/{sam.Id}/impersonate", new { reason = "help" }, Token);
        Assert.Equal(HttpStatusCode.Forbidden, start.StatusCode);
        Assert.Contains("not_with_a_key", await start.Content.ReadAsStringAsync(Token));
        var started = await session.PostAsJsonAsync($"/api/admin/users/{sam.Id}/impersonate", new { reason = "help" }, Token);
        Assert.Equal(HttpStatusCode.OK, started.StatusCode);
        var view = (await started.Content.ReadFromJsonAsync<JsonObject>(Token))!["token"]!.GetValue<string>();
        using (var request = new HttpRequestMessage(HttpMethod.Get, "/auth/me"))
        {
            request.Headers.Add(ImpersonationSetup.Header, view);
            var riding = await key.SendAsync(request, Token);
            Assert.Equal(HttpStatusCode.Forbidden, riding.StatusCode);
            Assert.Contains("not_with_a_key", await riding.Content.ReadAsStringAsync(Token));
        }

        // Nothing that would outlast the key: no sign-in link, password or provider link for its own account.
        foreach (var (path, body) in new (string, object?)[]
        {
            ($"/api/admin/users/{myId}/login-link", null),
            ($"/api/admin/users/{myId}/password", new { password = "another long password" }),
            ($"/api/admin/users/{myId}/identities", new { provider = "any", subject = "someone" }),
        })
        {
            var refused = await key.PostAsJsonAsync(path, body, Token);
            Assert.Equal(HttpStatusCode.Forbidden, refused.StatusCode);
            Assert.Contains("not_with_a_key", await refused.Content.ReadAsStringAsync(Token));
        }
        foreach (var (path, body) in new (string, object)[]
        {
            ("/api/admin/oidc/mappings", new { provider = "any", providerUsername = "someone", accountId = myId }),
            ("/api/admin/oidc/identities/any/someone/account", new { accountId = myId }),
        })
        {
            var refused = await key.PutAsJsonAsync(path, body, Token);
            Assert.Equal(HttpStatusCode.Forbidden, refused.StatusCode);
            Assert.Contains("not_with_a_key", await refused.Content.ReadAsStringAsync(Token));
            // The session gets past that check (to "no such provider" or "no such link").
            Assert.NotEqual(HttpStatusCode.Forbidden, (await session.PutAsJsonAsync(path, body, Token)).StatusCode);
        }
        // The session still may; the key still acts on other people as the role allows.
        Assert.NotEqual(HttpStatusCode.Forbidden, (await key.PostAsync($"/api/admin/users/{sam.Id}/login-link", null, Token)).StatusCode);
        Assert.NotEqual(HttpStatusCode.Forbidden, (await session.PostAsync($"/api/admin/users/{myId}/login-link", null, Token)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await key.PostAsJsonAsync($"/api/admin/users/{sam.Id}/password", new { password = "another long password" }, Token)).StatusCode);
    }
}
