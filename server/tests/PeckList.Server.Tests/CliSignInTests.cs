using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using PeckList.Core.Accounts;
using PeckList.Server.Api;
using PeckList.Server.Auth;
using static PeckList.Server.Tests.TaskApiWorld;

namespace PeckList.Server.Tests;

/// <summary>
/// Signing the command line in (PL-133): a code typed on the /cli page by a person signed in as
/// themselves turns into an API key the CLI collects once (security Must 1).
/// </summary>
public sealed class CliSignInTests(ServerFixture fixture) : IClassFixture<ServerFixture>
{
    private static CancellationToken Token => TestContext.Current.CancellationToken;

    private static async Task<(HttpStatusCode Status, JsonObject Body)> Post(HttpClient client, string path, object? body)
    {
        var response = await client.PostAsJsonAsync(path, body, Token);
        var text = await response.Content.ReadAsStringAsync(Token);
        return (response.StatusCode, text.Length == 0 ? [] : JsonNode.Parse(text)!.AsObject());
    }

    private static async Task<JsonObject> Expect(HttpClient client, string path, object? body, HttpStatusCode expected, string? code = null)
    {
        var (status, json) = await Post(client, path, body);
        Assert.True(status == expected, $"POST {path}: {(int)status} {json.ToJsonString()}");
        if (code is not null) Assert.Equal(code, (string?)json["code"]);
        return json;
    }

    private static async Task<(string Code, string Poll)> BeginAsync(HttpClient cli, bool admin = false)
    {
        var started = await Expect(cli, "/api/v1/cli/sign-in", new { name = "CLI on build-box‮", admin }, HttpStatusCode.OK);
        Assert.Matches("^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$", (string)started["userCode"]!);
        Assert.Equal(5, (int)started["interval"]!);
        Assert.Equal(600, (int)started["expiresIn"]!);
        return ((string)started["userCode"]!, (string)started["pollToken"]!);
    }

    private static async Task<HttpClient> AdminAsync(TaskApiWorld world)
    {
        var admin = world.Server.CreateClient();
        (await admin.PostAsJsonAsync("/auth/login", new { username = "admin", password = AdminPassword }, Token)).EnsureSuccessStatusCode();
        return admin;
    }

    [Theory]
    [MemberData(nameof(Databases), MemberType = typeof(TaskApiWorld))]
    public async Task A_typed_code_approved_in_the_browser_becomes_a_key_the_cli_collects_once(string kind)
    {
        using var world = await StartAsync(fixture, kind);
        var ben = await world.PersonAsync("ben");
        var cli = world.Server.CreateClient();
        var (code, poll) = await BeginAsync(cli);

        await Expect(cli, "/api/v1/cli/sign-in/poll", new { pollToken = poll }, HttpStatusCode.PreconditionRequired, "pending");
        await Expect(cli, "/api/v1/cli/sign-in/poll", new { pollToken = poll }, HttpStatusCode.TooManyRequests, "slow_down");

        // Typed however: lower case, without the dash.
        var seen = await Expect(ben.Session, "/api/v1/cli/lookup", new { userCode = code.Replace("-", "").ToLowerInvariant() }, HttpStatusCode.OK);
        Assert.Equal("CLI on build-box", (string?)seen["name"]);
        Assert.False((bool)seen["adminAsked"]!);
        Assert.NotNull(seen["requestedAt"]);
        var approved = await Expect(ben.Session, "/api/v1/cli/approve", new { userCode = code }, HttpStatusCode.OK);
        Assert.Equal("CLI: CLI on build-box", (string?)approved["keyName"]);

        var collected = await Expect(cli, "/api/v1/cli/sign-in/poll", new { pollToken = poll }, HttpStatusCode.OK);
        Assert.Equal(["tasks:read", "tasks:write"], collected["key"]!["scopes"]!.AsArray().Select(scope => (string)scope!).ToArray());
        // Once: the request is gone, and the code with it.
        await Expect(cli, "/api/v1/cli/sign-in/poll", new { pollToken = poll }, HttpStatusCode.Gone, "expired");
        await Expect(ben.Session, "/api/v1/cli/approve", new { userCode = code }, HttpStatusCode.NotFound, "not_found");

        var key = world.Server.CreateClient();
        key.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", (string)collected["token"]!);
        var me = await key.GetFromJsonAsync<JsonObject>("/api/v1/me", Token);
        Assert.Equal(ben.Id, (string?)me!["id"]);

        // Signing out revokes that key, and only a key signs out this way.
        await Expect(ben.Session, "/api/v1/cli/approve", new { userCode = "BCDF-GHJK" }, HttpStatusCode.NotFound, "not_found");
        var sessionOut = await ben.Session.DeleteAsync("/api/v1/cli/sign-in", Token);
        Assert.Equal(HttpStatusCode.Forbidden, sessionOut.StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await key.DeleteAsync("/api/v1/cli/sign-in", Token)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await key.GetAsync("/api/v1/me", Token)).StatusCode);
    }

    [Fact]
    public async Task Only_a_person_signed_in_as_themselves_approves_never_a_key_a_view_as_or_an_unchanged_password()
    {
        using var world = await StartAsync(fixture, Sqlite);
        var sam = await world.PersonAsync("sam");
        var cli = world.Server.CreateClient();
        var (code, poll) = await BeginAsync(cli);
        var admin = await AdminAsync(world);

        // A key, even one with every permission.
        var made = await admin.PostAsJsonAsync("/api/account/api-keys", new { name = "Everything", scopes = ApiScopes.All }, Token);
        var keyed = world.Server.CreateClient();
        keyed.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", (await made.Content.ReadFromJsonAsync<ApiKeyAuth.CreatedKey>(Token))!.Token);
        foreach (var path in new[] { "/api/v1/cli/lookup", "/api/v1/cli/approve", "/api/v1/cli/deny" })
        {
            await Expect(keyed, path, new { userCode = code }, HttpStatusCode.Forbidden, "scope");
        }

        // Viewing as someone.
        var started = await admin.PostAsJsonAsync($"/api/admin/users/{sam.Id}/impersonate", new { reason = "help" }, Token);
        var view = (await started.Content.ReadFromJsonAsync<JsonObject>(Token))!["token"]!.GetValue<string>();
        admin.DefaultRequestHeaders.Add(ImpersonationSetup.Header, view);
        await Expect(admin, "/api/v1/cli/approve", new { userCode = code }, HttpStatusCode.Forbidden, "not_while_impersonating");

        // A password that must change first.
        var accounts = world.Server.Services.GetRequiredService<AccountService>();
        await accounts.CreateUserAsync("newbie", "a long enough password", mustChangePassword: true, cancellation: Token);
        var newbie = world.Server.CreateClient();
        (await newbie.PostAsJsonAsync("/auth/login", new { username = "newbie", password = "a long enough password" }, Token)).EnsureSuccessStatusCode();
        await Expect(newbie, "/api/v1/cli/approve", new { userCode = code }, HttpStatusCode.Forbidden, "password_change_required");

        // Nobody signed in.
        await Expect(world.Server.CreateClient(), "/api/v1/cli/approve", new { userCode = code }, HttpStatusCode.Unauthorized);

        // None of them approved it.
        await Expect(cli, "/api/v1/cli/sign-in/poll", new { pollToken = poll }, HttpStatusCode.PreconditionRequired, "pending");
    }

    [Fact]
    public async Task The_admin_permission_takes_the_terminal_asking_the_approver_ticking_and_a_role_that_allows_it()
    {
        using var world = await StartAsync(fixture, Sqlite);
        var ben = await world.PersonAsync("ben");
        var admin = await AdminAsync(world);
        var cli = world.Server.CreateClient();

        async Task<string[]> Scopes(HttpClient approver, bool asked, bool ticked)
        {
            var (code, poll) = await BeginAsync(cli, admin: asked);
            var seen = await Expect(approver, "/api/v1/cli/lookup", new { userCode = code }, HttpStatusCode.OK);
            Assert.Equal(asked, (bool)seen["adminAsked"]!);
            await Expect(approver, "/api/v1/cli/approve", new { userCode = code, admin = ticked }, HttpStatusCode.OK);
            var collected = await Expect(cli, "/api/v1/cli/sign-in/poll", new { pollToken = poll }, HttpStatusCode.OK);
            return [.. collected["key"]!["scopes"]!.AsArray().Select(scope => (string)scope!)];
        }

        Assert.Contains("admin", await Scopes(admin, asked: true, ticked: true));
        Assert.DoesNotContain("admin", await Scopes(admin, asked: true, ticked: false));
        Assert.DoesNotContain("admin", await Scopes(admin, asked: false, ticked: true));
        Assert.DoesNotContain("admin", await Scopes(ben.Session, asked: true, ticked: true));
    }

    [Fact]
    public async Task A_denied_sign_in_says_so_once_and_wrong_codes_run_out()
    {
        using var world = await StartAsync(fixture, Sqlite);
        var ben = await world.PersonAsync("ben");
        var cli = world.Server.CreateClient();
        var (code, poll) = await BeginAsync(cli);

        Assert.Equal(HttpStatusCode.NoContent, (await ben.Session.PostAsJsonAsync("/api/v1/cli/deny", new { userCode = code }, Token)).StatusCode);
        await Expect(cli, "/api/v1/cli/sign-in/poll", new { pollToken = poll }, HttpStatusCode.Forbidden, "denied");
        await Expect(cli, "/api/v1/cli/sign-in/poll", new { pollToken = poll }, HttpStatusCode.Gone, "expired");
        await Expect(cli, "/api/v1/cli/sign-in/poll", new { pollToken = "not-a-token" }, HttpStatusCode.Gone, "expired");

        var (next, _) = await BeginAsync(cli);
        for (var guess = 0; guess < CliSignIns.WrongCodesPerAccount; guess++)
        {
            await Expect(ben.Session, "/api/v1/cli/lookup", new { userCode = "ZZZZ-ZZZZ" }, HttpStatusCode.NotFound, "not_found");
        }
        // Then even the right one waits.
        await Expect(ben.Session, "/api/v1/cli/lookup", new { userCode = next }, HttpStatusCode.TooManyRequests, "too_many_tries");
    }

    [Fact]
    public async Task Other_accounts_wrong_codes_never_stop_a_right_one()
    {
        using var world = await StartAsync(fixture, Sqlite);
        var ben = await world.PersonAsync("ben");
        var signIns = new CliSignIns(world.Server.Services.GetRequiredService<ApiKeyService>(), TimeProvider.System, NullLogger<CliSignIns>.Instance);
        var started = (await signIns.StartAsync("laptop", admin: false, "192.0.2.7", Token))!;

        for (var account = 0; account < CliSignIns.WrongCodesWorthAWarning / CliSignIns.WrongCodesPerAccount + 5; account++)
        {
            for (var guess = 0; guess < CliSignIns.WrongCodesPerAccount; guess++)
            {
                Assert.Equal(CliSignIns.Lookup.NotFound, signIns.Find($"guesser-{account}", "ZZZZ-ZZZZ").Result);
            }
            Assert.Equal(CliSignIns.Lookup.TooManyTries, signIns.Find($"guesser-{account}", started.UserCode).Result);
        }

        Assert.Equal(CliSignIns.Lookup.Found, signIns.Find(ben.Id, started.UserCode).Result);
    }

    [Fact]
    public async Task A_key_approved_but_never_collected_is_revoked_when_the_sign_in_runs_out()
    {
        using var world = await StartAsync(fixture, Sqlite);
        var ben = await world.PersonAsync("ben");
        var keys = world.Server.Services.GetRequiredService<ApiKeyService>();
        var time = new ManualTime(DateTimeOffset.UtcNow);
        var signIns = new CliSignIns(keys, time, NullLogger<CliSignIns>.Instance);

        var started = (await signIns.StartAsync("laptop", admin: false, "192.0.2.7", Token))!;
        var (found, request) = signIns.Find(ben.Id, started.UserCode);
        Assert.Equal(CliSignIns.Lookup.Found, found);
        var key = (await signIns.ApproveAsync(request!, ben.Id, Role.User, admin: false, Token))!;

        time.Now += CliSignIns.Lifetime + TimeSpan.FromSeconds(1);
        await signIns.SweepAsync(Token);
        Assert.NotNull((await keys.ListAsync(ben.Id, Token)).Single(each => each.Id == key.Id).RevokedAt);
        Assert.Equal(CliSignIns.Poll.Expired, (await signIns.PollAsync(started.PollToken, Token)).Result);
        Assert.Equal(0, signIns.Pending);
    }

    [Fact]
    public async Task Waiting_sign_ins_are_capped()
    {
        using var world = await StartAsync(fixture, Sqlite);
        var signIns = new CliSignIns(world.Server.Services.GetRequiredService<ApiKeyService>(), TimeProvider.System, NullLogger<CliSignIns>.Instance);
        for (var each = 0; each < CliSignIns.MaxPending; each++) Assert.NotNull(await signIns.StartAsync("box", false, null, Token));
        Assert.Null(await signIns.StartAsync("one more", false, null, Token));
    }
}
