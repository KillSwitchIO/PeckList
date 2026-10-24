using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Punchlist.Core;
using Punchlist.Core.Accounts;
using Punchlist.Core.Audit;
using Punchlist.Server.Audit;

namespace Punchlist.Server.Tests;

/// <summary>Deleting accounts (spec: Users, delete with grace period and restore).</summary>
public sealed class AccountDeletionTests(ServerFixture fixture) : IClassFixture<ServerFixture>
{
    private const string AdminPassword = "correct horse battery";
    private const string Password = "a long enough password";
    private const string Clock = "2026-10-22T10:00:00.000Z-0000-dev1";

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

    private static Task<HttpResponseMessage> Pull(HttpClient client) =>
        client.PostAsJsonAsync("/api/sync", new { schemaVersion = WorkspaceSchema.CurrentVersion, cursor = (long?)null }, Token);

    [Fact]
    public async Task A_deleted_account_is_off_at_once_and_can_be_restored_within_the_grace_period()
    {
        using var server = fixture.Factory(("ADMIN_PASSWORD", AdminPassword));
        var admin = await LogIn(server, "admin", AdminPassword);
        var (sam, samId) = await NewUser(server, "sam");
        var adminId = (await server.Services.GetRequiredService<IAccountStore>().FindByUsernameAsync("admin", Token))!.Id;

        Assert.Equal(HttpStatusCode.Conflict, (await admin.DeleteAsync($"/api/admin/users/{adminId}", Token)).StatusCode);
        var deleted = await admin.DeleteAsync($"/api/admin/users/{samId}", Token);
        Assert.Equal(HttpStatusCode.OK, deleted.StatusCode);
        var removedAt = (DateTimeOffset)(await deleted.Content.ReadFromJsonAsync<JsonObject>(Token))!["removedAt"]!;
        Assert.InRange(removedAt - DateTimeOffset.UtcNow, TimeSpan.FromDays(6.9), TimeSpan.FromDays(7.1));

        // Their session ends and they cannot sign in.
        Assert.Equal(HttpStatusCode.Unauthorized, (await Pull(sam)).StatusCode);
        Assert.NotEqual(HttpStatusCode.OK, (await server.CreateClient().PostAsJsonAsync("/auth/login", new { username = "sam", password = Password }, Token)).StatusCode);
        var row = (await admin.GetFromJsonAsync<AdminUser[]>("/api/admin/users", Token))!.Single(user => user.Id == samId);
        Assert.True(row.Disabled);
        Assert.NotNull(row.DeletedAt);
        // Turning it back on is not the way: restoring is.
        Assert.Equal(HttpStatusCode.Conflict, (await admin.PutAsJsonAsync($"/api/admin/users/{samId}/disabled", new { disabled = false }, Token)).StatusCode);

        Assert.Equal(HttpStatusCode.NoContent, (await admin.PostAsync($"/api/admin/users/{samId}/restore", null, Token)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Pull(await LogIn(server, "sam", Password))).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await admin.PostAsync($"/api/admin/users/{samId}/restore", null, Token)).StatusCode);
    }

    [Fact]
    public async Task An_admin_removes_a_deleted_account_now_without_waiting_out_the_grace_period()
    {
        using var server = fixture.Factory(("ADMIN_PASSWORD", AdminPassword));
        var admin = await LogIn(server, "admin", AdminPassword);
        var (_, samId) = await NewUser(server, "sam");

        // Only a deleted account can go now.
        Assert.Equal(HttpStatusCode.Conflict, (await admin.PostAsync($"/api/admin/users/{samId}/remove-now", null, Token)).StatusCode);
        (await admin.DeleteAsync($"/api/admin/users/{samId}", Token)).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.NoContent, (await admin.PostAsync($"/api/admin/users/{samId}/remove-now", null, Token)).StatusCode);

        Assert.Null(await server.Services.GetRequiredService<IAccountStore>().FindByIdAsync(samId, Token));
        Assert.Equal(HttpStatusCode.NotFound, (await admin.PostAsync($"/api/admin/users/{samId}/remove-now", null, Token)).StatusCode);
        // The name is free again.
        await NewUser(server, "sam");
        await server.Services.GetRequiredService<AuditLog>().FlushAsync(Token);
        var events = (await server.Services.GetRequiredService<IAuditStore>().QueryAsync(new AuditQuery { Ascending = true }, Token)).Entries;
        Assert.Contains(events, entry => entry.Type == "admin.user-removed-now");
    }

    [Fact]
    public async Task After_the_grace_period_the_account_and_everything_it_owns_go_and_friends_hear_of_it()
    {
        using var server = fixture.Factory(("ADMIN_PASSWORD", AdminPassword), ("ACCOUNT_DELETE_GRACE_DAYS", "0"));
        var admin = await LogIn(server, "admin", AdminPassword);
        var (sam, samId) = await NewUser(server, "sam");
        var (kim, kimId) = await NewUser(server, "kim");
        (await admin.PostAsJsonAsync("/api/admin/friendships", new { userA = samId, userB = kimId }, Token)).EnsureSuccessStatusCode();
        (await sam.PostAsJsonAsync("/api/sync", new
        {
            schemaVersion = WorkspaceSchema.CurrentVersion,
            cursor = (long?)null,
            changes = new[]
            {
                new
                {
                    collection = "tasks",
                    entity = new JsonObject
                    {
                        ["id"] = "T1", ["title"] = "Sam's task", ["deletedAt"] = null,
                        ["_hlc"] = new JsonObject { ["title"] = Clock, ["deletedAt"] = Clock },
                    },
                },
            },
        }, Token)).EnsureSuccessStatusCode();

        (await admin.DeleteAsync($"/api/admin/users/{samId}", Token)).EnsureSuccessStatusCode();
        Assert.Equal(1, await server.Services.GetRequiredService<AccountRemoval>().RemoveDueAsync(Token));

        Assert.Null(await server.Services.GetRequiredService<IAccountStore>().FindByIdAsync(samId, Token));
        Assert.DoesNotContain((await admin.GetFromJsonAsync<AdminUser[]>("/api/admin/users", Token))!, user => user.Id == samId);
        Assert.Empty((await admin.GetFromJsonAsync<AdminFriend[]>($"/api/admin/users/{kimId}/friends", Token))!);
        var task = await server.Services.GetRequiredService<Core.Storage.IEntityStore>().GetAsync("T1", Token);
        Assert.NotNull(task!.Doc["deletedAt"]);
        Assert.Equal(HttpStatusCode.OK, (await Pull(kim)).StatusCode);

        await server.Services.GetRequiredService<AuditLog>().FlushAsync(Token);
        var events = (await server.Services.GetRequiredService<IAuditStore>().QueryAsync(new AuditQuery { Ascending = true }, Token)).Entries;
        Assert.Contains(events, entry => entry.Type == "admin.user-deleted" && entry.TargetName == "sam");
        Assert.Contains(events, entry => entry.Type == "admin.user-removed" && entry.Detail!.StartsWith("sam,", StringComparison.Ordinal));
    }
}
