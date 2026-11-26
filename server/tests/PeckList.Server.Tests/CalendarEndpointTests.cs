using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using PeckList.Calendars.Testing;
using PeckList.Core;
using PeckList.Core.Accounts;
using PeckList.Core.Calendars;
using PeckList.Server.Calendars;

namespace PeckList.Server.Tests;

/// <summary>Settings &gt; Calendars and shown events over HTTP (PL-134), against the fake calendar service.</summary>
public sealed class CalendarEndpointTests(ServerFixture fixture) : IClassFixture<ServerFixture>
{
    private readonly FakeCalendarProvider fake = new(push: false);
    private const string Password = "app-password";

    private static CancellationToken Token => TestContext.Current.CancellationToken;

    private WebApplicationFactory<Program> Server(bool on = true, bool withProvider = true, bool privateNetwork = false) =>
        fixture.Factory(("ADMIN_PASSWORD", "correct horse battery"), ("CALENDAR_SYNC", on ? "true" : "false"),
                ("CALENDAR_CALDAV_PRIVATE_NETWORK", privateNetwork ? "true" : "false"))
            .WithWebHostBuilder(host => host.ConfigureTestServices(services =>
            {
                if (withProvider) services.AddSingleton<ICalendarProvider>(fake);
            }));

    private static async Task<(HttpClient Client, string Id)> SignIn(WebApplicationFactory<Program> server, string username)
    {
        var accounts = server.Services.GetRequiredService<AccountService>();
        const string password = "a long enough password";
        var account = await accounts.CreateUserAsync(username, password, mustChangePassword: false, cancellation: Token);
        var client = server.CreateClient();
        (await client.PostAsJsonAsync("/auth/login", new { username, password }, Token)).EnsureSuccessStatusCode();
        return (client, account.Id);
    }

    private static JsonObject Entity(string id, string by, JsonObject fields)
    {
        const string stamp = "2026-11-24T10:00:00.000Z-0000-dev1";
        fields["id"] = id;
        fields["createdAt"] = "2026-11-24T10:00:00.000Z";
        fields["createdBy"] = by;
        fields["deletedAt"] ??= null;
        fields["origin"] = "dev1";
        var clocks = new JsonObject();
        foreach (var (field, _) in fields) if (field != "id") clocks[field] = stamp;
        fields["_hlc"] = clocks;
        return fields;
    }

    private static async Task PushAsync(HttpClient client, params (string Collection, JsonObject Entity)[] changes) =>
        (await client.PostAsJsonAsync("/api/sync", new
        {
            schemaVersion = WorkspaceSchema.CurrentVersion,
            cursor = (long?)null,
            changes = changes.Select(each => new { collection = each.Collection, entity = each.Entity }).ToArray(),
        }, Token)).EnsureSuccessStatusCode();

    /// <summary>An inbox and a tag of the person's, as their app would make them.</summary>
    private static Task WorkspaceAsync(HttpClient client, string userId, string prefix) => PushAsync(client,
        ("lists", Entity($"{prefix}INBOX", userId, new JsonObject { ["name"] = "Inbox", ["visibility"] = "private", ["isInbox"] = true, ["order"] = "a0" })),
        ("tags", Entity($"{prefix}TAG", userId, new JsonObject { ["name"] = "calendar", ["color"] = "#3366FF", ["order"] = "a0" })));

    private async Task<JsonObject> ConnectAsync(HttpClient client)
    {
        var connection = fake.AddAccount(username: $"sam{Guid.NewGuid():N}", password: Password);
        fake.AddCalendar(connection, "Personal");
        var answer = await client.PostAsJsonAsync("/api/calendars/accounts",
            new { provider = "fake", serverUrl = connection.ServerUrl, username = connection.Username, password = Password }, Token);
        Assert.Equal(HttpStatusCode.Created, answer.StatusCode);
        return (await answer.Content.ReadFromJsonAsync<JsonObject>(Token))!;
    }

    private static string LinkOf(JsonObject account) => (string)account["calendars"]![0]!["id"]!;

    [Fact]
    public async Task Every_route_answers_404_while_calendar_sync_is_off()
    {
        await using var server = Server(on: false);
        var (client, _) = await SignIn(server, "ben");

        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/calendars", Token)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.PostAsJsonAsync("/api/calendars/accounts", new { serverUrl = "https://calendar.example.com" }, Token)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/calendars/events?from=2026-11-01&to=2026-11-30", Token)).StatusCode);
    }

    [Fact]
    public async Task A_calendar_kind_the_server_lacks_is_refused_and_the_rest_still_answers()
    {
        await using var server = Server(withProvider: false);
        var (client, _) = await SignIn(server, "ben");

        var answer = await client.PostAsJsonAsync("/api/calendars/accounts",
            new { provider = "exchange", serverUrl = "https://calendar.example.com/dav/", username = "sam", password = Password }, Token);
        var problem = await answer.Content.ReadFromJsonAsync<JsonObject>(Token);

        Assert.Equal(HttpStatusCode.BadRequest, answer.StatusCode);
        Assert.Equal("calendar_provider_unavailable", (string?)problem!["error"]);
        Assert.Empty((await client.GetFromJsonAsync<JsonObject>("/api/calendars", Token))!["accounts"]!.AsArray());
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/calendars/events?from=2026-11-01&to=2026-11-30", Token)).StatusCode);
        await server.Services.GetRequiredService<CalendarRuns>().RunDueAsync(new HashSet<string>(), Token);
    }

    [Fact]
    public void The_server_syncs_caldav_calendars_and_lists_their_overrides_with_the_series()
    {
        using var server = Server(withProvider: false);

        var caldav = server.Services.GetRequiredService<CalendarSync>().Provider("caldav");

        Assert.IsType<PeckList.CalDav.CalDavCalendarProvider>(caldav);
        Assert.Equal(new CalendarCapabilities(Push: false, CreateCalendar: true, SeriesListsOverrides: true), caldav.Capabilities);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task A_caldav_server_at_a_private_address_is_refused_unless_the_admin_allows_it(bool allowed)
    {
        await using var server = Server(withProvider: false, privateNetwork: allowed);
        var (client, userId) = await SignIn(server, "ben");

        // Nothing listens on port 1: allowed, the address is dialled and does not answer.
        var answer = await client.PostAsJsonAsync("/api/calendars/accounts",
            new { serverUrl = "http://127.0.0.1:1/dav/", username = "sam", password = Password }, Token);
        var problem = (await answer.Content.ReadFromJsonAsync<JsonObject>(Token))!;

        if (allowed)
        {
            Assert.NotEqual("calendar_address_blocked", (string?)problem["error"]);
        }
        else
        {
            Assert.Equal(HttpStatusCode.BadRequest, answer.StatusCode);
            Assert.Equal("calendar_address_blocked", (string?)problem["error"]);
        }
        Assert.Empty(await server.Services.GetRequiredService<ICalendarStore>().AccountsAsync(userId, Token));
    }

    [Fact]
    public async Task Connecting_checks_the_account_lists_its_calendars_and_never_gives_back_the_password()
    {
        await using var server = Server();
        var (client, userId) = await SignIn(server, "ben");

        var account = await ConnectAsync(client);
        var listing = await client.GetStringAsync("/api/calendars", Token);

        Assert.Equal("off", (string?)account["calendars"]![0]!["mode"]);
        Assert.Equal("Personal", (string?)account["calendars"]![0]!["name"]);
        Assert.DoesNotContain(Password, account.ToJsonString(), StringComparison.Ordinal);
        Assert.DoesNotContain(Password, listing, StringComparison.Ordinal);
        var stored = Assert.Single(await server.Services.GetRequiredService<ICalendarStore>().AccountsAsync(userId, Token));
        Assert.StartsWith(Core.Configuration.ConfigCipher.Prefix, stored.Secret, StringComparison.Ordinal);
        Assert.DoesNotContain(Password, stored.Secret, StringComparison.Ordinal);
    }

    [Fact]
    public async Task A_refused_password_is_answered_and_nothing_is_stored()
    {
        await using var server = Server();
        var (client, userId) = await SignIn(server, "ben");
        var connection = fake.AddAccount(username: "kim", password: Password);

        var answer = await client.PostAsJsonAsync("/api/calendars/accounts",
            new { provider = "fake", serverUrl = connection.ServerUrl, username = "kim", password = "wrong" }, Token);

        Assert.Equal(HttpStatusCode.BadRequest, answer.StatusCode);
        Assert.Equal("calendar_auth_failed", (string?)(await answer.Content.ReadFromJsonAsync<JsonObject>(Token))!["error"]);
        Assert.Empty(await server.Services.GetRequiredService<ICalendarStore>().AccountsAsync(userId, Token));
    }

    [Fact]
    public async Task Connecting_is_limited_per_person()
    {
        await using var server = Server();
        var (client, _) = await SignIn(server, "ben");
        var statuses = new List<HttpStatusCode>();

        for (var each = 0; each <= CalendarEndpoints.ConnectsPerWindow; each++)
        {
            statuses.Add((await client.PostAsJsonAsync("/api/calendars/accounts",
                new { provider = "fake", serverUrl = "https://calendar.example.com", username = "nobody", password = "wrong" }, Token)).StatusCode);
        }

        Assert.All(statuses.Take(CalendarEndpoints.ConnectsPerWindow), status => Assert.Equal(HttpStatusCode.BadRequest, status));
        Assert.Equal(HttpStatusCode.TooManyRequests, statuses[^1]);
    }

    [Fact]
    public async Task Sync_now_is_limited_per_person()
    {
        await using var server = Server();
        var (client, _) = await SignIn(server, "ben");
        var account = await ConnectAsync(client);
        (await client.PutAsJsonAsync($"/api/calendars/{LinkOf(account)}", new { mode = "show" }, Token)).EnsureSuccessStatusCode();
        var calls = fake.Calls;
        var statuses = new List<HttpStatusCode>();

        for (var each = 0; each < 20; each++) statuses.Add((await client.PostAsync($"/api/calendars/{LinkOf(account)}/sync", null, Token)).StatusCode);

        Assert.All(statuses.Take(CalendarEndpoints.SyncsPerWindow), status => Assert.Equal(HttpStatusCode.OK, status));
        Assert.All(statuses.Skip(CalendarEndpoints.SyncsPerWindow), status => Assert.Equal(HttpStatusCode.TooManyRequests, status));
        Assert.True(fake.Calls - calls <= CalendarEndpoints.SyncsPerWindow * 2, $"{fake.Calls - calls} calls to the calendar service");
    }

    [Fact]
    public async Task A_calendar_backing_off_is_not_run_by_hand_and_other_peoples_calendars_still_sync()
    {
        await using var server = Server();
        var (ben, _) = await SignIn(server, "ben");
        var (kim, _) = await SignIn(server, "kim");
        var account = await ConnectAsync(ben);
        var linkId = LinkOf(account);
        (await ben.PutAsJsonAsync($"/api/calendars/{linkId}", new { mode = "show" }, Token)).EnsureSuccessStatusCode();
        var store = server.Services.GetRequiredService<ICalendarStore>();
        // As a run that timed out leaves it.
        var wait = DateTimeOffset.UtcNow.AddMinutes(10);
        await store.SaveLinkAsync((await store.LinkAsync(linkId, Token))! with { Problem = CalendarSync.TimedOut, Failures = 1, NextAttempt = wait }, Token);
        var calls = fake.Calls;

        var synced = (await (await ben.PostAsync($"/api/calendars/{linkId}/sync", null, Token)).Content.ReadFromJsonAsync<JsonObject>(Token))!;
        (await ben.PutAsJsonAsync($"/api/calendars/{linkId}", new { mode = "off" }, Token)).EnsureSuccessStatusCode();
        var flipped = (await (await ben.PutAsJsonAsync($"/api/calendars/{linkId}", new { mode = "show" }, Token)).Content.ReadFromJsonAsync<JsonObject>(Token))!;

        Assert.Equal(calls, fake.Calls);
        Assert.Equal(CalendarSync.TimedOut, (string?)synced["problem"]);
        Assert.NotNull(synced["nextAttempt"]);
        Assert.Equal(CalendarSync.TimedOut, (string?)flipped["problem"]);
        var link = (await store.LinkAsync(linkId, Token))!;
        Assert.Equal(1, link.Failures);
        Assert.Equal(wait.ToUnixTimeMilliseconds(), link.NextAttempt?.ToUnixTimeMilliseconds());

        var other = await ConnectAsync(kim);
        var shown = (await (await kim.PutAsJsonAsync($"/api/calendars/{LinkOf(other)}", new { mode = "show" }, Token)).Content.ReadFromJsonAsync<JsonObject>(Token))!;
        Assert.NotNull(shown["syncedAt"]);
    }

    [Fact]
    public async Task An_adapter_bug_is_logged_by_type_without_the_calendars_text()
    {
        await using var server = Server();
        var (client, _) = await SignIn(server, "ben");
        var account = await ConnectAsync(client);
        (await client.PutAsJsonAsync($"/api/calendars/{LinkOf(account)}", new { mode = "show" }, Token)).EnsureSuccessStatusCode();
        var lines = new LogLines();
        var services = server.Services;
        var runs = new CalendarRuns(services.GetRequiredService<CalendarSync>(), services.GetRequiredService<ICalendarStore>(),
            services.GetRequiredService<Core.Configuration.LiveSettings>(), services.GetRequiredService<CalendarNudges>(), services.GetRequiredService<CalendarChannels>(), TimeProvider.System, lines);
        fake.FailNext(new FormatException("SUMMARY:calendar text from the server"));

        var run = await runs.RunNowAsync(LinkOf(account), Token);

        Assert.Equal(CalendarSync.Failed, run.Problem);
        var line = Assert.Single(lines.All);
        Assert.Contains("System.FormatException", line, StringComparison.Ordinal);
        Assert.DoesNotContain("calendar text from the server", line, StringComparison.Ordinal);
        var link = (await services.GetRequiredService<ICalendarStore>().LinkAsync(LinkOf(account), Token))!;
        Assert.Equal(CalendarSync.Failed, link.Problem);
        Assert.NotNull(link.NextAttempt);
    }

    /// <summary>Every line logged, with any exception attached, as text.</summary>
    private sealed class LogLines : Microsoft.Extensions.Logging.ILogger<CalendarRuns>
    {
        public List<string> All { get; } = [];

        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

        public bool IsEnabled(Microsoft.Extensions.Logging.LogLevel logLevel) => true;

        public void Log<TState>(Microsoft.Extensions.Logging.LogLevel logLevel, Microsoft.Extensions.Logging.EventId eventId, TState state, Exception? exception,
            Func<TState, Exception?, string> formatter) => All.Add(formatter(state, exception) + (exception is null ? "" : " " + exception));
    }

    [Fact]
    public async Task Someone_elses_calendars_are_out_of_reach()
    {
        await using var server = Server();
        var (ben, _) = await SignIn(server, "ben");
        var (kim, _) = await SignIn(server, "kim");
        var account = await ConnectAsync(ben);

        Assert.Empty((await kim.GetFromJsonAsync<JsonObject>("/api/calendars", Token))!["accounts"]!.AsArray());
        Assert.Equal(HttpStatusCode.NotFound, (await kim.PutAsJsonAsync($"/api/calendars/{LinkOf(account)}", new { mode = "show" }, Token)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await kim.PostAsync($"/api/calendars/{LinkOf(account)}/sync", null, Token)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await kim.DeleteAsync($"/api/calendars/accounts/{(string)account["id"]!}", Token)).StatusCode);
    }

    [Fact]
    public async Task Syncing_with_a_tag_sends_tagged_tasks_to_the_calendar()
    {
        await using var server = Server();
        var (client, userId) = await SignIn(server, "ben");
        await WorkspaceAsync(client, userId, "B");
        await PushAsync(client, ("tasks", Entity("BTASK1", userId, new JsonObject
        {
            ["title"] = "Dentist", ["notes"] = "", ["listId"] = "BINBOX", ["sectionId"] = null, ["parentId"] = null, ["order"] = "a0",
            ["status"] = "open", ["completedAt"] = null, ["completedBy"] = null, ["priority"] = 0,
            ["schedule"] = new JsonObject { ["start"] = "2026-11-30", ["end"] = null, ["allDay"] = true, ["timeZone"] = "Europe/London" },
            ["due"] = null, ["tags"] = new JsonObject { ["BTAG"] = new JsonObject { ["in"] = true, ["hlc"] = "2026-11-24T10:00:00.000Z-0000-dev1" } },
            ["assignees"] = new JsonObject(), ["blockedBy"] = new JsonObject(), ["recurrence"] = null, ["progress"] = 0,
        })));
        var account = await ConnectAsync(client);

        Assert.Equal("unknown_tag", (string?)(await (await client.PutAsJsonAsync($"/api/calendars/{LinkOf(account)}", new { mode = "sync", tagId = "NOPE" }, Token))
            .Content.ReadFromJsonAsync<JsonObject>(Token))!["error"]);
        var answer = await client.PutAsJsonAsync($"/api/calendars/{LinkOf(account)}", new { mode = "sync", tagId = "BTAG" }, Token);

        Assert.Equal(HttpStatusCode.OK, answer.StatusCode);
        var link = (await answer.Content.ReadFromJsonAsync<JsonObject>(Token))!;
        Assert.Equal("sync", (string?)link["mode"]);
        Assert.NotNull(link["syncedAt"]);
        var calendarId = (await server.Services.GetRequiredService<ICalendarStore>().LinkAsync(LinkOf(account), Token))!.RemoteId;
        Assert.Equal("Dentist", Assert.Single(fake.Events(calendarId)).Data.Summary);
    }

    [Fact]
    public async Task Shown_events_list_by_occurrence_single_ones_edit_and_repeating_ones_only_hide()
    {
        await using var server = Server();
        var (client, userId) = await SignIn(server, "ben");
        await WorkspaceAsync(client, userId, "S");
        var account = await ConnectAsync(client);
        var calendarId = (await server.Services.GetRequiredService<ICalendarStore>().LinkAsync(LinkOf(account), Token))!.RemoteId;
        fake.Seed(calendarId, new EventData("Dentist", "", CalendarTime.Local("2026-11-30T09:00", "Europe/London"), CalendarTime.Local("2026-11-30T09:30", "Europe/London")));
        fake.Seed(calendarId, new EventData("Gym", "", CalendarTime.Date("2026-11-02"), CalendarTime.Date("2026-11-03"), "FREQ=WEEKLY;BYDAY=MO"));
        (await client.PutAsJsonAsync($"/api/calendars/{LinkOf(account)}", new { mode = "show" }, Token)).EnsureSuccessStatusCode();

        var events = (await client.GetFromJsonAsync<JsonObject>("/api/calendars/events?from=2026-11-23&to=2026-12-06", Token))!["events"]!.AsArray();

        Assert.Equal(["2026-11-23 Gym", "2026-11-30 Gym", "2026-11-30 Dentist"], events.Select(each => $"{(string)each!["occurrence"]!} {(string)each["title"]!}"));
        var dentist = events.Single(each => (string)each!["title"]! == "Dentist")!;
        var gym = events.First(each => (string)each!["title"]! == "Gym")!;
        Assert.True((bool)dentist["editable"]!);
        Assert.False((bool)gym["editable"]!);

        var refused = await client.PatchAsJsonAsync($"/api/calendars/events/{(string)gym["id"]!}", new { title = "Swim" }, Token);
        Assert.Equal(HttpStatusCode.Conflict, refused.StatusCode);
        Assert.Equal("calendar_recurring_read_only", (string?)(await refused.Content.ReadFromJsonAsync<JsonObject>(Token))!["error"]);

        var edited = await client.PatchAsJsonAsync($"/api/calendars/events/{(string)dentist["id"]!}", new { title = "Dentist (moved)", start = "2026-12-01T10:00", end = "2026-12-01T10:45" }, Token);
        Assert.Equal(HttpStatusCode.OK, edited.StatusCode);
        Assert.Contains(fake.Events(calendarId), each => each.Data.Summary == "Dentist (moved)" && each.Data.Start == CalendarTime.Local("2026-12-01T10:00", "Europe/London"));

        (await client.PostAsJsonAsync($"/api/calendars/events/{(string)gym["id"]!}/hide", new { occurrence = "2026-11-23" }, Token)).EnsureSuccessStatusCode();
        var made = await client.PostAsJsonAsync($"/api/calendars/events/{(string)dentist["id"]!}/task", new { }, Token);
        Assert.Equal(HttpStatusCode.OK, made.StatusCode);
        Assert.NotNull((string?)(await made.Content.ReadFromJsonAsync<JsonObject>(Token))!["taskId"]);

        var after = (await client.GetFromJsonAsync<JsonObject>("/api/calendars/events?from=2026-11-23&to=2026-12-06", Token))!["events"]!.AsArray();
        Assert.Equal(["2026-11-30 Gym"], after.Select(each => $"{(string)each!["occurrence"]!} {(string)each["title"]!}"));
        Assert.Equal(2, fake.Events(calendarId).Count);
    }

    [Fact]
    public async Task A_range_longer_than_allowed_is_refused()
    {
        await using var server = Server();
        var (client, _) = await SignIn(server, "ben");

        var answer = await client.GetAsync("/api/calendars/events?from=2026-11-01&to=2027-01-15", Token);

        Assert.Equal(HttpStatusCode.BadRequest, answer.StatusCode);
    }

    [Fact]
    public async Task Disconnecting_removes_the_account_and_keeps_the_calendar()
    {
        await using var server = Server();
        var (client, _) = await SignIn(server, "ben");
        var account = await ConnectAsync(client);

        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"/api/calendars/accounts/{(string)account["id"]!}", Token)).StatusCode);

        Assert.Empty((await client.GetFromJsonAsync<JsonObject>("/api/calendars", Token))!["accounts"]!.AsArray());
    }
}
