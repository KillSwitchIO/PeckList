using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using PeckList.Core.Accounts;
using PeckList.Server.Auth;

namespace PeckList.Server.Tests;

/// <summary>Passwords stop at 256 characters (audit S17), wherever one is set or tried.</summary>
public sealed class PasswordLengthTests(ServerFixture fixture) : IClassFixture<ServerFixture>
{
    private const string AdminPassword = "correct horse battery";

    private static readonly string Longest = new('x', AccountService.MaxPasswordLength);
    private static readonly string TooLong = new('x', AccountService.MaxPasswordLength + 1);

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
            var answer = await client.PostAsJsonAsync("/auth/login", new { username = "admin", password = TooLong }, Token);
            Assert.Equal(HttpStatusCode.Unauthorized, answer.StatusCode);
        }
        (await client.PostAsJsonAsync("/auth/login", new { username = "admin", password = AdminPassword }, Token)).EnsureSuccessStatusCode();
    }

    [Fact]
    public async Task A_current_password_over_the_cap_is_just_wrong()
    {
        using var server = Server();
        var admin = await Admin(server);
        var answer = await admin.PostAsJsonAsync("/auth/password", new { current = TooLong, next = "a brand new password" }, Token);
        Assert.Equal(HttpStatusCode.BadRequest, answer.StatusCode);
        Assert.Equal("wrong_password", (await answer.Content.ReadFromJsonAsync<AuthError>(Token))!.Error);
    }
}
