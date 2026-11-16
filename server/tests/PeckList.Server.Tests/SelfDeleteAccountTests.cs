using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Claims;
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
/// Deleting your own account (the Play account deletion policy): the admin's delete with its grace
/// period and restore, asked for by the person with fresh proof that it is them.
/// </summary>
public sealed class SelfDeleteAccountTests(ServerFixture fixture) : IClassFixture<ServerFixture>
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

    private static async Task<string> NewUser(WebApplicationFactory<Program> server, string username) =>
        (await server.Services.GetRequiredService<AccountService>()
            .CreateUserAsync(username, Password, mustChangePassword: false, cancellation: Token)).Id;

    private static Task<HttpResponseMessage> Delete(HttpClient client, string? password) =>
        client.PostAsJsonAsync("/api/account/delete", new { password }, Token);

    private static Task<HttpResponseMessage> Pull(HttpClient client) =>
        client.PostAsJsonAsync("/api/sync", new { schemaVersion = WorkspaceSchema.CurrentVersion, cursor = (long?)null }, Token);

    private static async Task<string?> ErrorOf(HttpResponseMessage response) =>
        (await response.Content.ReadFromJsonAsync<AdminError>(Token))?.Error;

    /// <summary>The account keeps its sessions, but has no password any more (a provider or passkey account).</summary>
    private static async Task DropPassword(WebApplicationFactory<Program> server, string id)
    {
        var store = server.Services.GetRequiredService<IAccountStore>();
        await store.UpdateAsync((await store.FindByIdAsync(id, Token))! with { PasswordHash = null }, Token);
    }

    [Fact]
    public async Task With_their_password_a_person_deletes_their_account_every_session_ends_and_an_admin_can_restore_it()
    {
        using var server = fixture.Factory(("ADMIN_PASSWORD", AdminPassword));
        var admin = await LogIn(server, "admin", AdminPassword);
        var samId = await NewUser(server, "sam");
        var sam = await LogIn(server, "sam", Password);
        var samPhone = await LogIn(server, "sam", Password);

        var info = await sam.GetFromJsonAsync<AccountDeletion>("/api/account/delete", Token);
        Assert.Equal(new AccountDeletion(7, "password", true, null), info);

        // No password, or the wrong one: nothing happens.
        Assert.Equal(HttpStatusCode.BadRequest, (await Delete(sam, null)).StatusCode);
        var wrong = await Delete(sam, "not my password");
        Assert.Equal(HttpStatusCode.BadRequest, wrong.StatusCode);
        Assert.Equal("wrong_password", (await wrong.Content.ReadFromJsonAsync<AuthError>(Token))!.Error);
        Assert.Equal(HttpStatusCode.OK, (await Pull(samPhone)).StatusCode);

        var deleted = await Delete(sam, Password);
        Assert.Equal(HttpStatusCode.OK, deleted.StatusCode);
        var removedAt = (await deleted.Content.ReadFromJsonAsync<UserDeleted>(Token))!.RemovedAt;
        Assert.InRange(removedAt - DateTimeOffset.UtcNow, TimeSpan.FromDays(6.9), TimeSpan.FromDays(7.1));

        // Signed out here, and on every other device; no way back in.
        Assert.Equal(HttpStatusCode.Unauthorized, (await Pull(sam)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await Pull(samPhone)).StatusCode);
        Assert.NotEqual(HttpStatusCode.OK,
            (await server.CreateClient().PostAsJsonAsync("/auth/login", new { username = "sam", password = Password }, Token)).StatusCode);
        var row = (await admin.GetFromJsonAsync<AdminUser[]>("/api/admin/users", Token))!.Single(user => user.Id == samId);
        Assert.NotNull(row.DeletedAt);
        Assert.Equal(removedAt, row.RemovedAt);

        await server.Services.GetRequiredService<AuditLog>().FlushAsync(Token);
        var events = (await server.Services.GetRequiredService<IAuditStore>().QueryAsync(new AuditQuery { Ascending = true }, Token)).Entries;
        var audited = events.Where(entry => entry.Type == "account.deleted").ToList();
        Assert.Contains(audited, entry => entry.Outcome == AuditOutcome.Ok && entry.ActorName == "sam" && entry.TargetId == samId);
        Assert.Contains(audited, entry => entry.Outcome != AuditOutcome.Ok);

        // Changed their mind: an admin brings it back within the grace period.
        Assert.Equal(HttpStatusCode.NoContent, (await admin.PostAsync($"/api/admin/users/{samId}/restore", null, Token)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Pull(await LogIn(server, "sam", Password))).StatusCode);
    }

    [Fact]
    public async Task Without_a_password_it_takes_a_sign_in_in_the_last_ten_minutes()
    {
        using (var server = fixture.Factory(("ADMIN_PASSWORD", AdminPassword)))
        {
            var kimId = await NewUser(server, "kim");
            var kim = await LogIn(server, "kim", Password);
            await DropPassword(server, kimId);
            var info = await kim.GetFromJsonAsync<AccountDeletion>("/api/account/delete", Token);
            Assert.Equal(("sign-in", true), (info!.Proof, info.SignedInRecently));
            // Just signed in: no password to type.
            Assert.Equal(HttpStatusCode.OK, (await Delete(kim, null)).StatusCode);
            Assert.NotNull((await server.Services.GetRequiredService<IAccountStore>().FindByIdAsync(kimId, Token))!.DeletedAt);
        }

        var time = new ManualTime(DateTimeOffset.UtcNow);
        using (var server = fixture.Factory(("ADMIN_PASSWORD", AdminPassword))
            .WithWebHostBuilder(host => host.ConfigureTestServices(services => services.AddSingleton<TimeProvider>(time))))
        {
            var samId = await NewUser(server, "sam");
            var sam = await LogIn(server, "sam", Password);
            await DropPassword(server, samId);
            time.Now = time.Now.AddMinutes(11);
            Assert.False((await sam.GetFromJsonAsync<AccountDeletion>("/api/account/delete", Token))!.SignedInRecently);
            var stale = await Delete(sam, "anything");
            Assert.Equal(HttpStatusCode.Forbidden, stale.StatusCode);
            Assert.Equal("sign_in_again", await ErrorOf(stale));
            Assert.Null((await server.Services.GetRequiredService<IAccountStore>().FindByIdAsync(samId, Token))!.DeletedAt);
            Assert.Equal(HttpStatusCode.OK, (await Pull(sam)).StatusCode);
        }
    }

    [Fact]
    public void A_session_from_before_sign_in_times_were_kept_never_counts_as_a_recent_sign_in()
    {
        var time = new ManualTime(DateTimeOffset.UtcNow);
        var sam = new Account { Id = "sam", Username = "sam", SecurityStamp = "stamp", CreatedAt = time.Now };
        Assert.True(AccountEndpoints.SignedInRecently(AuthSetup.Principal(sam, "Cookies", since: time.Now), time));
        Assert.False(AccountEndpoints.SignedInRecently(AuthSetup.Principal(sam, "Cookies", since: time.Now.AddMinutes(-11)), time));

        // Its sign-in time is filled in as it is first seen: right for the 90-day limit, but no proof.
        var old = new ClaimsPrincipal(new ClaimsIdentity(AuthSetup.Principal(sam, "Cookies").Claims.Where(claim => claim.Type != AuthSetup.SinceClaim), "Cookies"));
        Assert.False(AccountEndpoints.SignedInRecently(AuthSetup.WithAssumedSince(old, time.Now, "Cookies"), time));
    }

    [Fact]
    public async Task The_last_super_admin_is_told_to_make_someone_else_one_first()
    {
        using var server = fixture.Factory(("ADMIN_PASSWORD", AdminPassword));
        var admin = await LogIn(server, "admin", AdminPassword);
        Assert.Equal("last_super_admin", (await admin.GetFromJsonAsync<AccountDeletion>("/api/account/delete", Token))!.Blocked);

        var refused = await Delete(admin, AdminPassword);
        Assert.Equal(HttpStatusCode.Conflict, refused.StatusCode);
        var error = await refused.Content.ReadFromJsonAsync<AdminError>(Token);
        Assert.Equal(("last_super_admin", "make someone else a super admin first"), (error!.Error, error.Message));
        Assert.Equal(HttpStatusCode.OK, (await Pull(admin)).StatusCode);
    }

    [Fact]
    public async Task Never_by_an_admin_viewing_as_them_nor_with_an_API_key()
    {
        using var server = fixture.Factory(("ADMIN_PASSWORD", AdminPassword), ("DB_PATH", fixture.NewDbPath()));
        var admin = await LogIn(server, "admin", AdminPassword);
        var samId = await NewUser(server, "sam");
        var sam = await LogIn(server, "sam", Password);

        var started = await admin.PostAsJsonAsync($"/api/admin/users/{samId}/impersonate", new { reason = "Sam asked for help" }, Token);
        var viewing = (await started.Content.ReadFromJsonAsync<ImpersonationStart>(Token))!.Token;
        using (var request = new HttpRequestMessage(HttpMethod.Post, "/api/account/delete") { Content = JsonContent.Create(new { password = Password }) })
        {
            request.Headers.Add(ImpersonationSetup.Header, viewing);
            Assert.Equal(HttpStatusCode.Forbidden, (await admin.SendAsync(request, Token)).StatusCode);
        }

        var made = await sam.PostAsJsonAsync("/api/account/api-keys", new { name = "Everything", scopes = new[] { "tasks:read", "tasks:write" } }, Token);
        var key = server.CreateClient();
        key.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", (await made.Content.ReadFromJsonAsync<ApiKeyAuth.CreatedKey>(Token))!.Token);
        Assert.Equal(HttpStatusCode.Forbidden, (await Delete(key, Password)).StatusCode);

        Assert.Null((await server.Services.GetRequiredService<IAccountStore>().FindByIdAsync(samId, Token))!.DeletedAt);
    }

    [Fact]
    public async Task With_no_grace_period_as_on_a_demo_server_the_account_goes_at_once()
    {
        using var server = fixture.Factory(("ADMIN_PASSWORD", AdminPassword), ("ACCOUNT_DELETE_GRACE_DAYS", "0"));
        var samId = await NewUser(server, "sam");
        var sam = await LogIn(server, "sam", Password);
        Assert.Equal(0, (await sam.GetFromJsonAsync<AccountDeletion>("/api/account/delete", Token))!.GraceDays);

        Assert.Equal(HttpStatusCode.OK, (await Delete(sam, Password)).StatusCode);
        Assert.Null(await server.Services.GetRequiredService<IAccountStore>().FindByIdAsync(samId, Token));
        // The name is free again.
        await NewUser(server, "sam");
    }

    [Fact]
    public async Task On_a_demo_server_a_demo_account_deletes_itself_at_once_and_the_next_start_puts_it_back()
    {
        var db = fixture.NewDbPath();
        (string, string)[] demo = [("ADMIN_PASSWORD", AdminPassword), ("DB_PATH", db), ("DEMO_MODE", "true"), ("DEMO_ACCOUNTS", "demo-sam:try-pecklist-sam")];
        using (var server = fixture.Factory(demo))
        {
            var sam = await LogIn(server, "demo-sam", "try-pecklist-sam");
            Assert.Equal(HttpStatusCode.OK, (await Delete(sam, "try-pecklist-sam")).StatusCode);
            Assert.Null(await server.Services.GetRequiredService<IAccountStore>().FindByUsernameAsync("demo-sam", Token));
        }
        using (var server = fixture.Factory(demo))
        {
            await LogIn(server, "demo-sam", "try-pecklist-sam");
        }
    }
}
