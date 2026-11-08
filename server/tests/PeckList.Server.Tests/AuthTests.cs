using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using PeckList.Core.Accounts;
using PeckList.Server.Auth;

namespace PeckList.Server.Tests;

public sealed class AuthTests(ServerFixture fixture) : IClassFixture<ServerFixture>
{
    private const string Password = "correct horse battery";

    private static CancellationToken Token => TestContext.Current.CancellationToken;

    private WebApplicationFactory<Program> Local(string? db = null) =>
        fixture.Factory(("ADMIN_PASSWORD", Password), ("DB_PATH", db ?? fixture.NewDbPath()));

    private static Task<HttpResponseMessage> Login(HttpClient client, string username, string password) =>
        client.PostAsJsonAsync("/auth/login", new { username, password }, Token);

    [Fact]
    public async Task Logs_in_and_out()
    {
        using var factory = Local();
        var client = factory.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/auth/me", Token)).StatusCode);

        var login = await Login(client, "Admin", Password);
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        var cookie = Assert.Single(login.Headers.GetValues("Set-Cookie"));
        Assert.Contains("pecklist_session=", cookie);
        Assert.Contains("httponly", cookie, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("samesite=lax", cookie, StringComparison.OrdinalIgnoreCase);

        var me = await client.GetFromJsonAsync<Me>("/auth/me", Token);
        Assert.Equal("admin", me!.Username);
        Assert.Equal("superadmin", me.Role);
        Assert.Equal("local", me.AuthMode);
        Assert.False(me.MustChangePassword);

        Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync("/auth/logout", null, Token)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/auth/me", Token)).StatusCode);
    }

    [Fact]
    public async Task A_wrong_password_and_an_unknown_user_answer_alike()
    {
        using var factory = Local();
        var client = factory.CreateClient();
        var wrong = await Login(client, "admin", "nope");
        var unknown = await Login(client, "nobody", "nope");
        Assert.Equal(HttpStatusCode.Unauthorized, wrong.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, unknown.StatusCode);
        Assert.Equal(await wrong.Content.ReadAsStringAsync(Token), await unknown.Content.ReadAsStringAsync(Token));
    }

    [Fact]
    public async Task Locks_the_account_after_repeated_failures()
    {
        using var factory = Local();
        var client = factory.CreateClient();
        for (var attempt = 1; attempt < AccountService.MaxFailedLogins; attempt++) await Login(client, "admin", "nope");
        var locked = await Login(client, "admin", "nope");
        Assert.Equal(HttpStatusCode.Locked, locked.StatusCode);
        Assert.Equal("locked", (await locked.Content.ReadFromJsonAsync<AuthError>(Token))!.Error);
        // It says how long the lock lasts, and so does a try during it.
        Assert.InRange(RetryAfter(locked), 1, (long)AccountService.LockoutTime.TotalSeconds);
        var during = await Login(client, "admin", Password);
        Assert.Equal(HttpStatusCode.Locked, during.StatusCode);
        Assert.InRange(RetryAfter(during), 1, (long)AccountService.LockoutTime.TotalSeconds);
    }

    private static long RetryAfter(HttpResponseMessage response) =>
        (long)Assert.IsType<TimeSpan>(response.Headers.RetryAfter?.Delta).TotalSeconds;

    [Fact]
    public async Task Limits_login_attempts_per_address()
    {
        using var factory = Local();
        var client = factory.CreateClient();
        var answers = new List<HttpResponseMessage>();
        for (var attempt = 0; attempt < 11; attempt++) answers.Add(await Login(client, $"user{attempt}", "nope"));
        Assert.Equal(HttpStatusCode.TooManyRequests, answers[^1].StatusCode);
        // With how long to wait: at most the minute.
        Assert.InRange(RetryAfter(answers[^1]), 1, 60);
    }

    [Fact]
    public async Task A_password_change_ends_the_other_sessions()
    {
        using var factory = Local();
        var laptop = factory.CreateClient();
        var phone = factory.CreateClient();
        await Login(laptop, "admin", Password);
        await Login(phone, "admin", Password);

        var tooShort = await laptop.PostAsJsonAsync("/auth/password", new { current = Password, next = "short" }, Token);
        Assert.Equal("too_short", (await tooShort.Content.ReadFromJsonAsync<AuthError>(Token))!.Error);
        var changed = await laptop.PostAsJsonAsync("/auth/password", new { current = Password, next = "a brand new password" }, Token);
        Assert.Equal(HttpStatusCode.OK, changed.StatusCode);

        Assert.Equal(HttpStatusCode.OK, (await laptop.GetAsync("/auth/me", Token)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await phone.GetAsync("/auth/me", Token)).StatusCode);
    }

    [Fact]
    public async Task A_generated_password_must_be_changed_first()
    {
        using var factory = Local();
        var password = await factory.Services.GetRequiredService<AccountService>().ResetPasswordAsync("admin", Token);
        var client = factory.CreateClient();
        var login = await Login(client, "admin", password);
        Assert.True((await login.Content.ReadFromJsonAsync<Me>(Token))!.MustChangePassword);

        await client.PostAsJsonAsync("/auth/password", new { current = password, next = "a brand new password" }, Token);
        Assert.False((await client.GetFromJsonAsync<Me>("/auth/me", Token))!.MustChangePassword);
    }

    [Fact]
    public async Task Sessions_survive_a_restart()
    {
        var db = fixture.NewDbPath();
        HttpClient client;
        string cookie;
        using (var first = Local(db))
        {
            client = first.CreateClient();
            var login = await Login(client, "admin", Password);
            cookie = login.Headers.GetValues("Set-Cookie").Single().Split(';')[0];
        }
        // A new server on the same database reads the same cookie keys.
        using var second = Local(db);
        var request = new HttpRequestMessage(HttpMethod.Get, "/auth/me");
        request.Headers.Add("Cookie", cookie);
        Assert.Equal(HttpStatusCode.OK, (await second.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = false }).SendAsync(request, Token)).StatusCode);
    }

    [Fact]
    public async Task Without_logins_every_request_is_the_admin()
    {
        using var factory = fixture.Factory(("AUTH_MODE", "none"), ("DB_PATH", fixture.NewDbPath()));
        var client = factory.CreateClient();
        var me = await client.GetFromJsonAsync<Me>("/auth/me", Token);
        Assert.Equal("admin", me!.Username);
        Assert.Equal("none", me.AuthMode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Login(client, "admin", "x")).StatusCode);
    }
}
