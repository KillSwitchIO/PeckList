using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Authentication.OpenIdConnect;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using PeckList.Calendars.Testing;
using PeckList.Core;
using PeckList.Core.Accounts;
using PeckList.Core.Calendars;
using PeckList.Core.Configuration;
using PeckList.Google;
using PeckList.Server.Auth;
using PeckList.Server.Calendars;

namespace PeckList.Server.Tests;

/// <summary>
/// Connecting Google Calendar over HTTP (PL-134, the design note's sign-in flow), the web's way and
/// the Android app's, with the fake Google standing in for Google and the relay page.
/// </summary>
public sealed partial class GoogleConnectTests(ServerFixture fixture) : IClassFixture<ServerFixture>
{
    private const string ClientId = "pecklist-test.apps.googleusercontent.test";
    private const string ClientSecret = "fake-secret";
    private const string AppScheme = "com.pecklist.app";
    private const string Password = "a long enough password";

    private readonly FakeGoogle google = new();
    private readonly string address = $"sam{Guid.NewGuid():N}@example.com";

    private static CancellationToken Token => TestContext.Current.CancellationToken;

    private WebApplicationFactory<Program> Server(bool relay = false, string? publicUrl = null, bool on = true, bool client = true,
        params (string Key, string Value)[] more)
    {
        google.AddClient(ClientId, ClientSecret);
        (string, string)[] settings =
        [
            ("ADMIN_PASSWORD", "correct horse battery"),
            ("CALENDAR_SYNC", on ? "true" : "false"),
            .. publicUrl is null ? Array.Empty<(string, string)>() : [("PUBLIC_URL", publicUrl)],
            .. more,
        ];
        return fixture.Factory(settings).WithWebHostBuilder(host => host.ConfigureTestServices(services =>
        {
            services.AddSingleton<IGoogleClients>(provider => new ServerGoogleClients(
                provider.GetRequiredService<LiveSettings>(), client ? new GoogleClient(ClientId, ClientSecret, relay) : null));
            services.AddSingleton(provider => new GoogleCalendarProvider(new HttpClient(google), provider.GetRequiredService<IGoogleClients>(),
                TimeProvider.System, new GoogleAddresses(FakeGoogle.Api, FakeGoogle.TokenUrl, FakeGoogle.RevokeUrl, FakeGoogle.AuthorizeUrl)));
        }));
    }

    private static async Task<(HttpClient Browser, string Id)> SignIn(WebApplicationFactory<Program> server, string username)
    {
        var account = await server.Services.GetRequiredService<AccountService>().CreateUserAsync(username, Password, mustChangePassword: false, cancellation: Token);
        var browser = Browser(server);
        (await browser.PostAsJsonAsync("/auth/login", new { username, password = Password }, Token)).EnsureSuccessStatusCode();
        return (browser, account.Id);
    }

    private static HttpClient Browser(WebApplicationFactory<Program> server) =>
        // https, as a server with a PUBLIC_URL of https marks its cookies Secure.
        server.CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = new Uri("https://localhost"), AllowAutoRedirect = false });

    /// <summary>The address Google's sign-in was sent to, and what it carried.</summary>
    private static Dictionary<string, string> Query(Uri location)
    {
        Assert.StartsWith(FakeGoogle.AuthorizeUrl.AbsoluteUri, location.AbsoluteUri, StringComparison.Ordinal);
        return location.Query.TrimStart('?').Split('&').Select(pair => pair.Split('=', 2))
            .ToDictionary(pair => pair[0], pair => Uri.UnescapeDataString(pair[1]), StringComparer.Ordinal);
    }

    /// <summary>What Google's sign-in hands back: a code for the redirect it was asked with, and the state.</summary>
    private string SignInAtGoogle(Dictionary<string, string> asked, string scope = FakeGoogle.AllScopes) =>
        google.IssueCode(address, asked["client_id"], asked["redirect_uri"], asked["code_challenge"], scope);

    private static async Task<HttpResponseMessage> Callback(HttpClient browser, string code, string state) =>
        await browser.GetAsync($"{GoogleConnect.CallbackPath}?code={Uri.EscapeDataString(code)}&state={Uri.EscapeDataString(state)}&scope=x", Token);

    private static async Task<JsonObject> Calendars(HttpClient browser) =>
        (await browser.GetFromJsonAsync<JsonObject>("/api/calendars", Token))!;

    /// <summary>The web's way, start to end: link route, Google, callback.</summary>
    private async Task<HttpResponseMessage> ConnectOnWeb(HttpClient browser, string scope = FakeGoogle.AllScopes)
    {
        var start = await browser.GetAsync($"/auth/oidc/{GoogleConnect.LinkName}/link", Token);
        Assert.Equal(HttpStatusCode.Redirect, start.StatusCode);
        var asked = Query(start.Headers.Location!);
        return await Callback(browser, SignInAtGoogle(asked, scope), asked["state"]);
    }

    [Fact]
    public async Task On_the_web_Google_is_offered_and_connecting_lands_on_the_calendar_settings()
    {
        await using var server = Server();
        var (browser, _) = await SignIn(server, "ben");
        google.AddAccount(address, ClientId);
        google.AddCalendar(address, "Family", accessRole: "reader");
        Assert.Contains("google", (await Calendars(browser))["providers"]!.AsArray().Select(each => (string?)each));

        var done = await ConnectOnWeb(browser);

        Assert.Equal(HttpStatusCode.Redirect, done.StatusCode);
        Assert.Equal("/settings/calendars?calendar=cal_connected", done.Headers.Location!.OriginalString);
        var account = Assert.Single((await Calendars(browser))["accounts"]!.AsArray())!;
        Assert.Equal("google", (string?)account["provider"]);
        Assert.Equal(address, (string?)account["name"]);
        Assert.Equal("ok", (string?)account["status"]);
        Assert.Equal(2, account["calendars"]!.AsArray().Count);
        Assert.All(account["calendars"]!.AsArray(), each => Assert.Equal("off", (string?)each!["mode"]));
        Assert.DoesNotContain("refresh", account.ToJsonString(), StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task An_admins_own_client_comes_straight_back_and_the_state_names_this_server_under_a_signature()
    {
        await using var server = Server(publicUrl: "https://tasks.example.com");
        var (browser, _) = await SignIn(server, "ben");

        var start = await browser.GetAsync($"/auth/oidc/{GoogleConnect.LinkName}/link", Token);

        var asked = Query(start.Headers.Location!);
        Assert.Equal("https://tasks.example.com" + GoogleConnect.CallbackPath, asked["redirect_uri"]);
        Assert.Equal("offline", asked["access_type"]);
        Assert.Equal("S256", asked["code_challenge_method"]);
        Assert.Equal(GoogleScopes.All, asked["scope"]);
        Assert.DoesNotContain(' ', start.Headers.Location!.OriginalString);
        var payload = JsonNode.Parse(System.Buffers.Text.Base64Url.DecodeFromChars(asked["state"].Split('.')[0]))!;
        Assert.Equal("https://tasks.example.com" + GoogleConnect.CallbackPath, (string?)payload["r"]);
        Assert.Contains(GoogleConnect.Cookie, start.Headers.GetValues("Set-Cookie").Single(each => each.StartsWith(GoogleConnect.Cookie, StringComparison.Ordinal)), StringComparison.Ordinal);
        Assert.Contains("httponly", start.Headers.GetValues("Set-Cookie").Single(each => each.StartsWith(GoogleConnect.Cookie, StringComparison.Ordinal)), StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task The_built_in_client_signs_in_through_the_relay_page()
    {
        await using var server = Server(relay: true);
        var (browser, _) = await SignIn(server, "ben");

        var start = await browser.GetAsync($"/auth/oidc/{GoogleConnect.LinkName}/link", Token);
        var asked = Query(start.Headers.Location!);
        // The relay page passes the code and state on to the server the state names.
        var done = await Callback(browser, SignInAtGoogle(asked), asked["state"]);

        Assert.Equal(GoogleDefaults.RelayUrl.ToString(), asked["redirect_uri"]);
        Assert.Equal("/settings/calendars?calendar=cal_connected", done.Headers.Location!.OriginalString);
    }

    [Fact]
    public async Task The_built_in_client_names_a_public_address_only_from_PUBLIC_URL_never_from_the_Host_header()
    {
        await using var server = Server(relay: true);
        var (browser, _) = await SignIn(server, "ben");
        using var spoofed = new HttpRequestMessage(HttpMethod.Get, $"/auth/oidc/{GoogleConnect.LinkName}/link");
        spoofed.Headers.Host = "tasks.example.com";

        var refused = await browser.SendAsync(spoofed, Token);

        Assert.Equal("/settings/calendars?calendar=cal_unavailable", refused.Headers.Location!.OriginalString);
        await using var named = Server(relay: true, publicUrl: "https://tasks.example.com");
        var (other, _) = await SignIn(named, "ben");
        var asked = Query((await other.GetAsync($"/auth/oidc/{GoogleConnect.LinkName}/link", Token)).Headers.Location!);
        var payload = JsonNode.Parse(System.Buffers.Text.Base64Url.DecodeFromChars(asked["state"].Split('.')[0]))!;
        Assert.Equal("https://tasks.example.com" + GoogleConnect.CallbackPath, (string?)payload["r"]);
    }

    [Fact]
    public async Task A_forged_state_a_missing_cookie_or_a_used_sign_in_connects_nothing()
    {
        await using var server = Server();
        var (browser, _) = await SignIn(server, "ben");
        var start = await browser.GetAsync($"/auth/oidc/{GoogleConnect.LinkName}/link", Token);
        var asked = Query(start.Headers.Location!);
        var code = SignInAtGoogle(asked);
        var parts = asked["state"].Split('.');
        var forged = System.Buffers.Text.Base64Url.EncodeToString(Encoding.UTF8.GetBytes("{\"v\":1,\"r\":\"http://localhost/auth/calendar/google/callback\",\"n\":\"guess\"}")) + "." + parts[1];

        var badMac = await Callback(browser, code, forged);
        var otherBrowser = await Callback(Browser(server), code, asked["state"]);
        var first = await Callback(browser, code, asked["state"]);
        var again = await Callback(browser, code, asked["state"]);

        Assert.Equal("/settings/calendars?calendar=cal_expired", badMac.Headers.Location!.OriginalString);
        Assert.Equal("/settings/calendars?calendar=cal_expired", otherBrowser.Headers.Location!.OriginalString);
        // The browser that began it still can, once (the forged try did not use its sign-in up).
        Assert.Equal("/settings/calendars?calendar=cal_connected", first.Headers.Location!.OriginalString);
        Assert.Equal("/settings/calendars?calendar=cal_expired", again.Headers.Location!.OriginalString);
        Assert.Single((await Calendars(browser))["accounts"]!.AsArray());
    }

    [Fact]
    public async Task Saying_no_at_Google_or_leaving_out_a_scope_says_why_and_keeps_nothing()
    {
        await using var server = Server();
        var (browser, _) = await SignIn(server, "ben");

        var start = await browser.GetAsync($"/auth/oidc/{GoogleConnect.LinkName}/link", Token);
        var denied = await browser.GetAsync($"{GoogleConnect.CallbackPath}?error=access_denied&state={Uri.EscapeDataString(Query(start.Headers.Location!)["state"])}", Token);
        var partial = await ConnectOnWeb(browser, scope: FakeGoogle.EventsScope + " " + FakeGoogle.CalendarListScope);

        Assert.Equal("/settings/calendars?calendar=cal_cancelled", denied.Headers.Location!.OriginalString);
        Assert.Equal("/settings/calendars?calendar=cal_scope_missing", partial.Headers.Location!.OriginalString);
        Assert.Empty((await Calendars(browser))["accounts"]!.AsArray());
    }

    [Fact]
    public async Task In_the_app_the_tab_confirms_whose_calendars_go_where_and_returns_to_the_app()
    {
        await using var server = Server();
        var (app, _) = await SignIn(server, "kim");

        var link = await app.PostAsJsonAsync("/auth/app/link-start", new { provider = GoogleConnect.LinkName, scheme = AppScheme }, Token);
        link.EnsureSuccessStatusCode();
        var tabUrl = (string)(await link.Content.ReadFromJsonAsync<JsonObject>(Token))!["url"]!;
        Assert.StartsWith("/auth/app/link?", tabUrl, StringComparison.Ordinal);
        // The browser tab: no PeckList session in it.
        var tab = Browser(server);
        var start = await tab.GetAsync(tabUrl, Token);
        var asked = Query(start.Headers.Location!);
        var page = await Callback(tab, SignInAtGoogle(asked), asked["state"]);

        Assert.Equal(HttpStatusCode.OK, page.StatusCode);
        var html = await page.Content.ReadAsStringAsync(Token);
        Assert.Contains(address, html, StringComparison.Ordinal);
        Assert.Contains("<strong>kim</strong>", html, StringComparison.Ordinal);
        Assert.DoesNotContain("signed in here", html, StringComparison.Ordinal);
        Assert.Contains("frame-ancestors 'none'", page.Headers.GetValues("Content-Security-Policy").Single(), StringComparison.Ordinal);
        Assert.Empty((await Calendars(app))["accounts"]!.AsArray());

        var confirmCode = ConfirmCode().Match(html).Groups[1].Value;
        var confirmed = await tab.PostAsync(GoogleConnect.ConfirmPath, new FormUrlEncodedContent([new("code", confirmCode)]), Token);
        var reused = await tab.PostAsync(GoogleConnect.ConfirmPath, new FormUrlEncodedContent([new("code", confirmCode)]), Token);

        Assert.Equal($"{AppScheme}://link?result=cal_connected", confirmed.Headers.Location!.OriginalString);
        Assert.Equal("/settings/calendars?calendar=cal_expired", reused.Headers.Location!.OriginalString);
        Assert.Equal(address, (string?)(await Calendars(app))["accounts"]![0]!["name"]);
    }

    [Fact]
    public async Task A_link_someone_else_began_names_their_account_before_anything_is_connected()
    {
        await using var server = Server();
        var (attacker, _) = await SignIn(server, "mallory");
        var (victim, _) = await SignIn(server, "ben");
        // Mallory starts a link from "the app" and sends the tab's address to Ben, who opens it.
        var link = await attacker.PostAsJsonAsync("/auth/app/link-start", new { provider = GoogleConnect.LinkName, scheme = AppScheme }, Token);
        var tabUrl = (string)(await link.Content.ReadFromJsonAsync<JsonObject>(Token))!["url"]!;
        var start = await victim.GetAsync(tabUrl, Token);
        var asked = Query(start.Headers.Location!);

        var page = await Callback(victim, SignInAtGoogle(asked), asked["state"]);

        // Ben's browser is signed in as Ben, not Mallory: the page says whose account it would be.
        Assert.Equal(HttpStatusCode.OK, page.StatusCode);
        var html = await page.Content.ReadAsStringAsync(Token);
        Assert.Contains("to the PeckList account <strong>mallory</strong>", html, StringComparison.Ordinal);
        Assert.Contains("You're signed in here as <strong>ben</strong>", html, StringComparison.Ordinal);
        Assert.Empty((await Calendars(attacker))["accounts"]!.AsArray());
        Assert.Empty((await Calendars(victim))["accounts"]!.AsArray());
    }

    [Fact]
    public async Task Connecting_the_same_Google_address_again_renews_it_and_keeps_its_calendars()
    {
        await using var server = Server();
        var (browser, _) = await SignIn(server, "ben");
        await ConnectOnWeb(browser);
        var first = (await Calendars(browser))["accounts"]![0]!;
        var linkId = (string)first["calendars"]![0]!["id"]!;
        (await browser.PutAsJsonAsync($"/api/calendars/{linkId}", new { mode = "show" }, Token)).EnsureSuccessStatusCode();

        var again = await ConnectOnWeb(browser);

        Assert.Equal("/settings/calendars?calendar=cal_connected", again.Headers.Location!.OriginalString);
        var account = Assert.Single((await Calendars(browser))["accounts"]!.AsArray())!;
        Assert.Equal((string?)first["id"], (string?)account["id"]);
        Assert.Equal("show", (string?)account["calendars"]!.AsArray().Single(each => (string?)each!["id"] == linkId)!["mode"]);
    }

    [Fact]
    public async Task Disconnecting_ends_the_grant_at_Google()
    {
        await using var server = Server();
        var (browser, _) = await SignIn(server, "ben");
        await ConnectOnWeb(browser);
        var account = (await Calendars(browser))["accounts"]![0]!;
        var stored = (await server.Services.GetRequiredService<ICalendarStore>().AccountAsync((string)account["id"]!, Token))!;
        var refresh = GoogleToken.Read(await server.Services.GetRequiredService<ICalendarSecrets>().UnprotectAsync(stored.Secret, Token))!.RefreshToken;

        var gone = await browser.DeleteAsync($"/api/calendars/accounts/{(string)account["id"]!}", Token);

        Assert.Equal(HttpStatusCode.NoContent, gone.StatusCode);
        Assert.True(google.Revoked(refresh));
    }

    [Fact]
    public async Task A_Google_account_whose_secret_no_longer_opens_still_turns_off_and_disconnects()
    {
        await using var server = Server(publicUrl: "https://tasks.example.com");
        var (browser, _) = await SignIn(server, "ben");
        google.AddAccount(address, ClientId);
        google.AddCalendar(address, "Family");
        await ConnectOnWeb(browser);
        var account = (await Calendars(browser))["accounts"]![0]!;
        var accountId = (string)account["id"]!;
        var linkIds = account["calendars"]!.AsArray().Select(each => (string)each!["id"]!).ToList();
        foreach (var linkId in linkIds) (await browser.PutAsJsonAsync($"/api/calendars/{linkId}", new { mode = "show" }, Token)).EnsureSuccessStatusCode();
        Assert.Equal(linkIds.Count, google.Channels.Count);
        var store = server.Services.GetRequiredService<ICalendarStore>();
        // As after a CONFIG_KEY change: the secret is there, sealed under a key this server no longer has.
        var sealedElsewhere = new ConfigCipher(System.Security.Cryptography.RandomNumberGenerator.GetBytes(32)).Encrypt("{}");
        await store.SaveAccountAsync((await store.AccountAsync(accountId, Token))! with { Secret = sealedElsewhere }, Token);

        var off = await browser.PutAsJsonAsync($"/api/calendars/{linkIds[0]}", new { mode = "off" }, Token);
        var gone = await browser.DeleteAsync($"/api/calendars/accounts/{accountId}", Token);

        Assert.Equal(HttpStatusCode.OK, off.StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, gone.StatusCode);
        Assert.Null(await store.AccountAsync(accountId, Token));
        Assert.Empty((await Calendars(browser))["accounts"]!.AsArray());
    }

    [Fact]
    public async Task Disconnecting_while_Google_does_not_answer_still_removes_the_account_in_bounded_time()
    {
        await using var server = Server(publicUrl: "https://tasks.example.com");
        var (browser, _) = await SignIn(server, "ben");
        await ConnectOnWeb(browser);
        var account = (await Calendars(browser))["accounts"]![0]!;
        var accountId = (string)account["id"]!;
        (await browser.PutAsJsonAsync($"/api/calendars/{(string)account["calendars"]![0]!["id"]!}", new { mode = "show" }, Token)).EnsureSuccessStatusCode();
        Assert.Single(google.Channels);
        google.Silent = true;
        var clock = System.Diagnostics.Stopwatch.StartNew();

        var gone = await browser.DeleteAsync($"/api/calendars/accounts/{accountId}", Token);

        Assert.Equal(HttpStatusCode.NoContent, gone.StatusCode);
        Assert.InRange(clock.Elapsed, TimeSpan.Zero, CalendarEndpoints.EndAtProviderWithin + TimeSpan.FromSeconds(5));
        Assert.Null(await server.Services.GetRequiredService<ICalendarStore>().AccountAsync(accountId, Token));
    }

    [Fact]
    public async Task Starting_sign_ins_over_and_over_hits_the_connect_limit()
    {
        await using var server = Server();
        var (browser, _) = await SignIn(server, "ben");
        var (other, _) = await SignIn(server, "kim");

        for (var each = 0; each < CalendarEndpoints.ConnectsPerWindow; each++)
        {
            Assert.StartsWith(FakeGoogle.AuthorizeUrl.AbsoluteUri, (await browser.GetAsync($"/auth/oidc/{GoogleConnect.LinkName}/link", Token)).Headers.Location!.AbsoluteUri, StringComparison.Ordinal);
        }
        var over = await browser.GetAsync($"/auth/oidc/{GoogleConnect.LinkName}/link", Token);
        var someoneElse = await other.GetAsync($"/auth/oidc/{GoogleConnect.LinkName}/link", Token);

        Assert.Equal("/settings/calendars?calendar=cal_failed", over.Headers.Location!.OriginalString);
        Assert.StartsWith(FakeGoogle.AuthorizeUrl.AbsoluteUri, someoneElse.Headers.Location!.AbsoluteUri, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Without_a_client_Google_is_not_offered_and_the_link_route_says_so()
    {
        await using var server = Server(client: false);
        var (browser, _) = await SignIn(server, "ben");

        var start = await browser.GetAsync($"/auth/oidc/{GoogleConnect.LinkName}/link", Token);

        Assert.DoesNotContain("google", (await Calendars(browser))["providers"]!.AsArray().Select(each => (string?)each));
        Assert.Equal("/settings/calendars?calendar=cal_unavailable", start.Headers.Location!.OriginalString);
    }

    [Fact]
    public async Task An_OIDC_provider_named_calendar_google_keeps_working_and_Google_Calendar_steps_aside()
    {
        var oidc = new FakeOidcProvider();
        await using var server = Server(more:
        [
            ("OIDC_PROVIDERS", GoogleConnect.LinkName),
            ("OIDC_CALENDAR_GOOGLE_AUTHORITY", FakeOidcProvider.Authority),
            ("OIDC_CALENDAR_GOOGLE_CLIENT_ID", FakeOidcProvider.ClientId),
            ("OIDC_CALENDAR_GOOGLE_CLIENT_SECRET", "secret"),
        ]);
        await using var withOidc = server.WithWebHostBuilder(host => host.ConfigureTestServices(services =>
            services.Configure<OpenIdConnectOptions>(OidcSetup.Scheme(GoogleConnect.LinkName), options => options.BackchannelHttpHandler = oidc)));
        var (browser, _) = await SignIn(withOidc, "ben");

        var start = await browser.GetAsync($"/auth/oidc/{GoogleConnect.LinkName}/link", Token);

        Assert.StartsWith(FakeOidcProvider.Authority, start.Headers.Location!.AbsoluteUri, StringComparison.Ordinal);
        Assert.DoesNotContain("google", (await Calendars(browser))["providers"]!.AsArray().Select(each => (string?)each));
        Assert.True(withOidc.Services.GetRequiredService<GoogleConnect>().NameTaken);
    }

    [Fact]
    public async Task The_sign_in_routes_are_gone_while_calendar_sync_is_off()
    {
        await using var server = Server(on: false);
        var browser = Browser(server);

        Assert.Equal(HttpStatusCode.NotFound, (await browser.GetAsync($"{GoogleConnect.CallbackPath}?code=x&state=y", Token)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await browser.PostAsync("/api/calendars/google/push", null, Token)).StatusCode);
    }

    [Fact]
    public async Task A_synced_calendar_opens_a_push_channel_on_a_public_https_server_and_Off_stops_it()
    {
        await using var server = Server(publicUrl: "https://tasks.example.com");
        var (browser, _) = await SignIn(server, "ben");
        await ConnectOnWeb(browser);
        var linkId = (string)(await Calendars(browser))["accounts"]![0]!["calendars"]![0]!["id"]!;

        (await browser.PutAsJsonAsync($"/api/calendars/{linkId}", new { mode = "show" }, Token)).EnsureSuccessStatusCode();

        var channel = Assert.Single(google.Channels);
        Assert.Equal("https://tasks.example.com/api/calendars/google/push", channel.Address);
        var link = (await server.Services.GetRequiredService<ICalendarStore>().LinkAsync(linkId, Token))!;
        Assert.Equal(channel.Id, link.Channel!.Id);
        Assert.Equal(Tokens.Hash(channel.Token), link.ChannelTokenHash);

        (await browser.PutAsJsonAsync($"/api/calendars/{linkId}", new { mode = "off" }, Token)).EnsureSuccessStatusCode();

        Assert.Empty(google.Channels);
        Assert.Null((await server.Services.GetRequiredService<ICalendarStore>().LinkAsync(linkId, Token))!.Channel);
    }

    [Fact]
    public async Task No_channel_is_opened_without_a_public_https_address()
    {
        await using var server = Server(publicUrl: "http://192.168.1.20:8080");
        var (browser, _) = await SignIn(server, "ben");
        await ConnectOnWeb(browser);
        var linkId = (string)(await Calendars(browser))["accounts"]![0]!["calendars"]![0]!["id"]!;

        (await browser.PutAsJsonAsync($"/api/calendars/{linkId}", new { mode = "show" }, Token)).EnsureSuccessStatusCode();

        Assert.Empty(google.Channels);
    }

    [Fact]
    public async Task Only_a_push_matching_its_channel_token_and_resource_nudges_the_calendar()
    {
        await using var server = Server(publicUrl: "https://tasks.example.com");
        var (browser, _) = await SignIn(server, "ben");
        await ConnectOnWeb(browser);
        var linkId = (string)(await Calendars(browser))["accounts"]![0]!["calendars"]![0]!["id"]!;
        (await browser.PutAsJsonAsync($"/api/calendars/{linkId}", new { mode = "show" }, Token)).EnsureSuccessStatusCode();
        var channel = Assert.Single(google.Channels);
        var nudges = server.Services.GetRequiredService<CalendarNudges>();
        nudges.DrainAll();
        var googleCalls = Browser(server);

        async Task<HttpStatusCode> Push(string id, string token, string resource, string state = "exists")
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, "/api/calendars/google/push");
            request.Headers.Add("X-Goog-Channel-ID", id);
            request.Headers.Add("X-Goog-Channel-Token", token);
            request.Headers.Add("X-Goog-Resource-ID", resource);
            request.Headers.Add("X-Goog-Resource-State", state);
            return (await googleCalls.SendAsync(request, Token)).StatusCode;
        }

        Assert.Equal(HttpStatusCode.OK, await Push(channel.Id, "a-wrong-token", channel.Resource));
        Assert.Equal(HttpStatusCode.OK, await Push(channel.Id, channel.Token, "another-resource"));
        Assert.Equal(HttpStatusCode.OK, await Push("no-such-channel", channel.Token, channel.Resource));
        Assert.Equal(HttpStatusCode.OK, await Push(channel.Id, channel.Token, channel.Resource, state: "sync"));
        Assert.Empty(nudges.DrainAll().Links);

        Assert.Equal(HttpStatusCode.OK, await Push(channel.Id, channel.Token, channel.Resource));
        Assert.Equal([linkId], nudges.DrainAll().Links);
    }

    [GeneratedRegex("name=\"code\" value=\"([^\"]+)\"")]
    private static partial Regex ConfirmCode();
}
