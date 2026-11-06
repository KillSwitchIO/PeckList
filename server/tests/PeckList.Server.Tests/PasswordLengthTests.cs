using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using PeckList.Core.Accounts;
using PeckList.Server.Auth;

namespace PeckList.Server.Tests;

/// <summary>New passwords stop at the limit wherever one is set, and an older longer one still signs in (audit S17).</summary>
public sealed class PasswordLengthTests(ServerFixture fixture) : IClassFixture<ServerFixture>
{
    private const string AdminPassword = "correct horse battery";

    private static readonly string Longest = new('x', AccountService.MaxNewPasswordLength);
    private static readonly string TooLong = new('x', AccountService.MaxNewPasswordLength + 1);
    private static readonly string TooLongToTry = new('x', AccountService.MaxTriedPasswordLength + 1);
    private static readonly string FromBefore = new('y', AccountService.MaxNewPasswordLength + 16);

    private static CancellationToken Token => TestContext.Current.CancellationToken;

    private WebApplicationFactory<Program> Server(params (string Key, string Value)[] extra) =>
        fixture.Factory([("ADMIN_PASSWORD", AdminPassword), ("DB_PATH", fixture.NewDbPath()), .. extra]);

    private static async Task<HttpClient> Admin(WebApplicationFactory<Program> server)
    {
        var client = server.CreateClient();
        (await client.PostAsJsonAsync("/auth/login", new { username = "admin", password = AdminPassword }, Token)).EnsureSuccessStatusCode();
        return client;
    }

    private static async Task AssertTooLong(HttpResponseMessage answer)
    {
        Assert.Equal(HttpStatusCode.BadRequest, answer.StatusCode);
        Assert.Equal("too_long", (await answer.Content.ReadFromJsonAsync<AuthError>(Token))!.Error);
    }

    [Fact]
    public async Task A_new_password_over_the_cap_is_refused_and_one_at_the_cap_works()
    {
        using var server = Server();
        var admin = await Admin(server);
        await AssertTooLong(await admin.PostAsJsonAsync("/auth/password", new { current = AdminPassword, next = TooLong }, Token));

        (await admin.PostAsJsonAsync("/auth/password", new { current = AdminPassword, next = Longest }, Token)).EnsureSuccessStatusCode();
        var again = await server.CreateClient().PostAsJsonAsync("/auth/login", new { username = "admin", password = Longest }, Token);
        Assert.Equal(HttpStatusCode.OK, again.StatusCode);
    }

    [Fact]
    public async Task Signing_up_with_a_password_over_the_cap_is_refused()
    {
        using var server = Server(("REGISTRATION", "open"));
        await AssertTooLong(await server.CreateClient().PostAsJsonAsync("/auth/signup", new { username = "sam", password = TooLong }, Token));
    }

    [Fact]
    public async Task An_admin_setting_a_password_over_the_cap_is_refused()
    {
        using var server = Server();
        var admin = await Admin(server);
        var sam = await server.Services.GetRequiredService<AccountService>().CreateUserAsync("sam", AdminPassword, cancellation: Token);
        await AssertTooLong(await admin.PostAsJsonAsync($"/api/admin/users/{sam.Id}/password", new { password = TooLong }, Token));
    }

    [Fact]
    public async Task A_reset_link_refuses_a_password_over_the_cap()
    {
        using var server = Server();
        var accounts = server.Services.GetRequiredService<AccountService>();
        var sam = await accounts.CreateUserAsync("sam", AdminPassword, cancellation: Token);
        var (result, _) = await accounts.ResetOwnPasswordAsync(sam.Id, TooLong, Token);
        Assert.Equal(PasswordChange.TooLong, result);
    }

    [Fact]
    public async Task Trying_a_password_over_the_cap_is_just_wrong_and_does_not_count_towards_a_lock()
    {
        using var server = Server();
        var client = server.CreateClient();
        for (var attempt = 0; attempt <= AccountService.MaxFailedLogins; attempt++)
        {
            var answer = await client.PostAsJsonAsync("/auth/login", new { username = "admin", password = TooLongToTry }, Token);
            Assert.Equal(HttpStatusCode.Unauthorized, answer.StatusCode);
        }
        (await client.PostAsJsonAsync("/auth/login", new { username = "admin", password = AdminPassword }, Token)).EnsureSuccessStatusCode();
    }

    [Fact]
    public async Task A_current_password_over_the_cap_is_just_wrong()
    {
        using var server = Server();
        var admin = await Admin(server);
        var answer = await admin.PostAsJsonAsync("/auth/password", new { current = TooLongToTry, next = "a brand new password" }, Token);
        Assert.Equal(HttpStatusCode.BadRequest, answer.StatusCode);
        Assert.Equal("wrong_password", (await answer.Content.ReadFromJsonAsync<AuthError>(Token))!.Error);
    }

    [Fact]
    public async Task A_longer_password_from_before_the_limit_still_signs_in_and_is_held_to_it_at_the_next_change()
    {
        using var server = Server();
        var accounts = server.Services.GetRequiredService<AccountService>();
        var sam = await accounts.CreateUserAsync("sam", AdminPassword, mustChangePassword: false, cancellation: Token);
        await server.Services.GetRequiredService<IAccountStore>().UpdateAsync(
            sam with { PasswordHash = server.Services.GetRequiredService<IPasswordHasher>().Hash(FromBefore) }, Token);

        var client = server.CreateClient();
        (await client.PostAsJsonAsync("/auth/login", new { username = "sam", password = FromBefore }, Token)).EnsureSuccessStatusCode();
        await AssertTooLong(await client.PostAsJsonAsync("/auth/password", new { current = FromBefore, next = TooLong }, Token));
        (await client.PostAsJsonAsync("/auth/password", new { current = FromBefore, next = "a brand new password" }, Token)).EnsureSuccessStatusCode();
    }

    [Fact]
    public async Task A_longer_password_from_before_the_limit_confirms_removing_it()
    {
        using var server = Server();
        var accounts = server.Services.GetRequiredService<AccountService>();
        var sam = await accounts.CreateUserAsync("sam", AdminPassword, mustChangePassword: false, cancellation: Token);
        await server.Services.GetRequiredService<IAccountStore>().UpdateAsync(
            sam with { PasswordHash = server.Services.GetRequiredService<IPasswordHasher>().Hash(FromBefore) }, Token);

        Assert.Equal(PasswordChange.Changed, (await accounts.RemovePasswordAsync(sam.Id, FromBefore, Token)).Result);
    }

    [Fact]
    public async Task A_long_admin_password_does_not_stop_a_server_that_has_its_admin()
    {
        var database = fixture.NewDbPath();
        using (var first = fixture.Factory(("ADMIN_PASSWORD", AdminPassword), ("DB_PATH", database)))
        {
            await Admin(first);
        }
        using var again = fixture.Factory(("ADMIN_PASSWORD", TooLong), ("DB_PATH", database));
        await Admin(again);
        using var longest = fixture.Factory(("ADMIN_PASSWORD", TooLongToTry), ("DB_PATH", database));
        await Admin(longest);
    }

    [Fact]
    public async Task A_long_admin_password_does_not_stop_a_server_in_use_that_lost_its_admin()
    {
        var database = fixture.NewDbPath();
        using (var first = fixture.Factory(("ADMIN_PASSWORD", AdminPassword), ("DB_PATH", database)))
        {
            var store = first.Services.GetRequiredService<IAccountStore>();
            var accounts = first.Services.GetRequiredService<AccountService>();
            await accounts.CreateUserAsync("sam", AdminPassword, Role.SuperAdmin, cancellation: Token);
            var admin = (await store.FindByUsernameAsync(AccountService.AdminUsername, Token))!;
            await store.UpdateAsync(admin with { Username = "renamed" }, Token);
        }
        using var again = fixture.Factory(("ADMIN_PASSWORD", TooLong), ("DB_PATH", database));
        var client = again.CreateClient();
        var answer = await client.PostAsJsonAsync("/auth/login", new { username = "admin", password = TooLong }, Token);
        Assert.Equal(HttpStatusCode.OK, answer.StatusCode);
    }

    [Fact]
    public async Task A_demo_account_with_a_longer_password_does_not_stop_the_server()
    {
        using var server = Server(("DEMO_MODE", "true"), ("DEMO_ACCOUNTS", $"demo-sam:{FromBefore}"));
        var answer = await server.CreateClient().PostAsJsonAsync("/auth/login", new { username = "demo-sam", password = FromBefore }, Token);
        Assert.Equal(HttpStatusCode.OK, answer.StatusCode);
    }

    [Fact]
    public void A_generated_password_fits_the_limits() =>
        Assert.InRange(PeckList.Core.Ids.NewPassword().Length, AccountService.MinPasswordLength, AccountService.MaxNewPasswordLength);
}
