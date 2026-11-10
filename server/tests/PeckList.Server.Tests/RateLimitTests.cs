using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using PeckList.Core.Accounts;
using PeckList.Core.Sync;
using PeckList.Server.Auth;

namespace PeckList.Server.Tests;

/// <summary>Lookups, friend codes, one-time tokens and live-update streams have limits (audit S13).</summary>
public sealed class RateLimitTests(ServerFixture fixture) : IClassFixture<ServerFixture>
{
    private const string Password = "a long enough password";

    private static CancellationToken Token => TestContext.Current.CancellationToken;

    private WebApplicationFactory<Program> Server() =>
        fixture.Factory(("ADMIN_PASSWORD", "correct horse battery"), ("DB_PATH", fixture.NewDbPath()));

    private static async Task<HttpClient> SignedIn(WebApplicationFactory<Program> server, string username)
    {
        await server.Services.GetRequiredService<AccountService>()
            .CreateUserAsync(username, Password, mustChangePassword: false, cancellation: Token);
        var client = server.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        (await client.PostAsJsonAsync("/auth/login", new { username, password = Password }, Token)).EnsureSuccessStatusCode();
        return client;
    }

    private static long RetryAfter(HttpResponseMessage response) =>
        (long)Assert.IsType<TimeSpan>(response.Headers.RetryAfter?.Delta).TotalSeconds;

    [Fact]
    public async Task Lookups_and_friend_codes_share_a_limit_per_account()
    {
        using var server = Server();
        var kim = await SignedIn(server, "kim-r");
        var mo = await SignedIn(server, "mo-r");

        for (var each = 0; each < AuthSetup.AccountPerMinute; each++)
        {
            var answer = await kim.GetAsync($"/api/users/lookup?q=nobody{each}", Token);
            Assert.NotEqual(HttpStatusCode.TooManyRequests, answer.StatusCode);
        }
        var lookup = await kim.GetAsync("/api/users/lookup?q=nobody", Token);
        Assert.Equal(HttpStatusCode.TooManyRequests, lookup.StatusCode);
        Assert.InRange(RetryAfter(lookup), 1, 60);
        Assert.Equal(HttpStatusCode.TooManyRequests, (await kim.GetAsync("/api/friends/link/ABCDEFGH", Token)).StatusCode);
        Assert.Equal(HttpStatusCode.TooManyRequests, (await kim.PostAsync("/api/friends/link/ABCDEFGH", null, Token)).StatusCode);

        // Per account, not per address: another account from the same address is not held back.
        Assert.Equal(HttpStatusCode.NotFound, (await mo.GetAsync("/api/users/lookup?q=nobody", Token)).StatusCode);
    }

    [Fact]
    public async Task Saving_the_settings_page_has_its_own_limit()
    {
        using var server = Server();
        var admin = server.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        (await admin.PostAsJsonAsync("/auth/login", new { username = "admin", password = "correct horse battery" }, Token)).EnsureSuccessStatusCode();
        for (var each = 0; each <= AuthSetup.AccountPerMinute; each++) await admin.GetAsync($"/api/users/lookup?q=nobody{each}", Token);
        Assert.Equal(HttpStatusCode.TooManyRequests, (await admin.GetAsync("/api/users/lookup?q=nobody", Token)).StatusCode);

        var saved = await admin.PutAsJsonAsync("/api/admin/settings", new { values = new Dictionary<string, string> { ["REGISTRATION"] = "open" } }, Token);
        Assert.Equal(HttpStatusCode.OK, saved.StatusCode);
    }

    [Fact]
    public async Task One_time_login_links_take_the_sign_in_limit_per_address()
    {
        using var server = Server();
        var client = server.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        var answers = new List<HttpResponseMessage>();
        for (var attempt = 0; attempt < 11; attempt++) answers.Add(await client.PostAsync($"/auth/link/not-a-link-{attempt}", null, Token));
        Assert.All(answers[..10], answer => Assert.Equal(HttpStatusCode.Redirect, answer.StatusCode));
        Assert.Equal(HttpStatusCode.TooManyRequests, answers[^1].StatusCode);
    }

    [Fact]
    public async Task App_hand_off_codes_take_the_sign_in_limit_per_address()
    {
        using var server = Server();
        var client = server.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        var answers = new List<HttpResponseMessage>();
        for (var attempt = 0; attempt < 11; attempt++)
        {
            answers.Add(await client.PostAsync("/auth/app/redeem",
                new FormUrlEncodedContent([new("code", $"not-a-code-{attempt}"), new("verifier", new string('v', 43))]), Token));
        }
        Assert.All(answers[..10], answer => Assert.Equal(HttpStatusCode.Redirect, answer.StatusCode));
        Assert.Equal(HttpStatusCode.TooManyRequests, answers[^1].StatusCode);
    }

    [Fact]
    public async Task An_account_holds_at_most_ten_live_update_streams_and_a_closed_one_frees_its_place()
    {
        using var server = Server();
        var kim = await SignedIn(server, "kim-s");
        var mo = await SignedIn(server, "mo-s");
        var notifier = (InProcessChangeNotifier)server.Services.GetRequiredService<IChangeNotifier>();
        var kimId = (await server.Services.GetRequiredService<IAccountStore>().FindByUsernameAsync("kim-s", Token))!.Id;

        var open = new List<HttpResponseMessage>();
        for (var each = 0; each < SyncEndpoints.MaxStreams; each++)
        {
            var stream = await kim.GetAsync("/api/events", HttpCompletionOption.ResponseHeadersRead, Token);
            Assert.Equal(HttpStatusCode.OK, stream.StatusCode);
            open.Add(stream);
        }
        Assert.Equal(SyncEndpoints.MaxStreams, notifier.Count(kimId));
        using (var refused = await kim.GetAsync("/api/events", HttpCompletionOption.ResponseHeadersRead, Token))
        {
            Assert.Equal(HttpStatusCode.TooManyRequests, refused.StatusCode);
            Assert.InRange(RetryAfter(refused), 1, 60);
        }
        // Another account is not affected.
        using (var other = await mo.GetAsync("/api/events", HttpCompletionOption.ResponseHeadersRead, Token))
        {
            Assert.Equal(HttpStatusCode.OK, other.StatusCode);
        }

        // A client going away gives its place back.
        open[0].Dispose();
        using var patience = CancellationTokenSource.CreateLinkedTokenSource(Token);
        patience.CancelAfter(TimeSpan.FromSeconds(10));
        while (notifier.Count(kimId) >= SyncEndpoints.MaxStreams) await Task.Delay(20, patience.Token);
        using (var again = await kim.GetAsync("/api/events", HttpCompletionOption.ResponseHeadersRead, Token))
        {
            Assert.Equal(HttpStatusCode.OK, again.StatusCode);
        }
        foreach (var stream in open) stream.Dispose();
    }
}
