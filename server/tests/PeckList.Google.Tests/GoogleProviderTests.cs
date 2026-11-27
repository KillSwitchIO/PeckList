using System.Text.Json.Nodes;
using PeckList.Calendars.Testing;
using PeckList.Core.Calendars;

namespace PeckList.Google.Tests;

/// <summary>What the Google adapter does beyond the shared contract: tokens, calendars, Google's own shapes.</summary>
public sealed class GoogleProviderTests
{
    private static CancellationToken Cancel => TestContext.Current.CancellationToken;

    [Fact]
    public async Task A_refreshed_token_is_handed_back_once_for_the_calls_of_one_connection()
    {
        var rig = new GoogleRig();
        var connection = rig.Connection();

        await rig.Provider.CalendarsAsync(connection, Cancel);
        await rig.Provider.AddressAsync(connection, Cancel);

        var saved = Assert.Single(rig.Saved);
        var token = GoogleToken.Read(saved)!;
        Assert.Equal(rig.RefreshToken, token.RefreshToken);
        Assert.Equal(GoogleRig.ClientId, token.ClientId);
        Assert.False(string.IsNullOrEmpty(token.AccessToken));
        Assert.Single(rig.Google.Calls, call => call == "POST /token");
    }

    [Fact]
    public async Task An_access_token_Google_refuses_is_refreshed_and_the_call_made_again()
    {
        var rig = new GoogleRig();
        // An access token that looks good for an hour but Google no longer takes.
        var stale = new GoogleToken(rig.RefreshToken, "access-revoked", DateTimeOffset.UtcNow.AddHours(1), GoogleRig.ClientId, FakeGoogle.AllScopes);
        var connection = new CalendarConnection(GoogleCalendarProvider.ServerUrl, null, stale.Write());

        var calendars = await rig.Provider.CalendarsAsync(connection, Cancel);

        Assert.Contains(calendars, each => each.Id == rig.Address);
        Assert.Single(rig.Google.Calls, call => call == "POST /token");
    }

    [Fact]
    public async Task A_sign_in_that_ended_at_Google_is_an_auth_problem_without_the_token_in_it()
    {
        var rig = new GoogleRig();
        rig.Google.Expire(rig.RefreshToken);

        var problem = await Assert.ThrowsAsync<CalendarProblem>(() => rig.Provider.CalendarsAsync(rig.Connection(), Cancel));

        Assert.Equal(CalendarProblemKind.Auth, problem.Kind);
        Assert.Equal("calendar_auth_failed", problem.Code);
        Assert.DoesNotContain(rig.RefreshToken, problem.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Google_not_answering_in_time_is_unreachable_not_a_cancellation()
    {
        var rig = new GoogleRig();
        rig.Google.Silent = true;
        var provider = new GoogleCalendarProvider(new HttpClient(rig.Google) { Timeout = TimeSpan.FromMilliseconds(200) }, rig.Known, TimeProvider.System,
            new GoogleAddresses(FakeGoogle.Api, FakeGoogle.TokenUrl, FakeGoogle.RevokeUrl, FakeGoogle.AuthorizeUrl));

        var problem = await Assert.ThrowsAsync<CalendarProblem>(() => provider.CalendarsAsync(rig.Connection(), Cancel));

        Assert.Equal(CalendarProblemKind.Unavailable, problem.Kind);
        Assert.Equal("calendar_unreachable", problem.Code);
    }

    [Fact]
    public async Task A_token_from_a_client_this_server_no_longer_has_asks_to_reconnect()
    {
        var rig = new GoogleRig();
        rig.Known.Clear();

        var problem = await Assert.ThrowsAsync<CalendarProblem>(() => rig.Provider.CalendarsAsync(rig.Connection(), Cancel));

        Assert.Equal(CalendarProblemKind.Auth, problem.Kind);
        Assert.Equal("calendar_google_client_changed", problem.Code);
    }

    [Fact]
    public async Task Calendars_are_listed_across_pages_with_their_role_and_colour_and_free_busy_ones_left_out()
    {
        var rig = new GoogleRig();
        var shared = rig.Google.AddCalendar(rig.Address, "Family", accessRole: "reader", color: "#7ae7bf");
        var work = rig.Google.AddCalendar(rig.Address, "Work", accessRole: "writer", timeZone: "Europe/Berlin");
        rig.Google.AddCalendar(rig.Address, "Boss", accessRole: "freeBusyReader");

        var calendars = await rig.Provider.CalendarsAsync(rig.Connection(), Cancel);

        Assert.Equal(3, calendars.Count);
        Assert.Equal(new RemoteCalendar(shared, "Family", "#7AE7BF", ReadOnly: true, "America/Chicago"), calendars.Single(each => each.Id == shared));
        Assert.Equal(new RemoteCalendar(work, "Work", "#7AE7BF", ReadOnly: false, "Europe/Berlin"), calendars.Single(each => each.Id == work));
        Assert.DoesNotContain(calendars, each => each.Name == "Boss");
    }

    [Fact]
    public async Task A_made_calendar_takes_the_primary_calendars_zone()
    {
        var rig = new GoogleRig();

        var made = await rig.Provider.CreateCalendarAsync(rig.Connection(), "PeckList", Cancel);

        Assert.Equal("America/Chicago", made.TimeZone);
        Assert.False(made.ReadOnly);
    }

    [Fact]
    public async Task A_time_given_with_only_an_offset_reads_in_the_calendars_zone()
    {
        var rig = new GoogleRig();
        var calendar = rig.Google.AddCalendar(rig.Address, "Work", timeZone: "America/Chicago");
        rig.Google.Seed(rig.Address, calendar, new JsonObject
        {
            ["summary"] = "Call",
            ["start"] = new JsonObject { ["dateTime"] = "2026-11-03T15:00:00Z" },
            ["end"] = new JsonObject { ["dateTime"] = "2026-11-03T15:30:00Z" },
        });

        var listed = await rig.Provider.ChangesAsync(rig.Connection(), calendar, null, Cancel);

        var only = Assert.Single(listed.Changed);
        Assert.Equal(CalendarTime.Local("2026-11-03T09:00", "America/Chicago"), only.Data.Start);
        Assert.Equal(CalendarTime.Local("2026-11-03T09:30", "America/Chicago"), only.Data.End);
    }

    [Fact]
    public async Task A_deleted_series_comes_as_deleted_and_a_cancelled_occurrence_as_a_cancelled_override()
    {
        var rig = new GoogleRig();
        var connection = rig.Connection();
        var calendar = rig.Google.AddCalendar(rig.Address, "Work");
        var gym = await rig.Provider.CreateEventAsync(connection, calendar,
            new EventData("Gym", "", CalendarTime.Local("2026-11-02T08:00", "America/Chicago"), CalendarTime.Local("2026-11-02T08:30", "America/Chicago"), RRule: "FREQ=WEEKLY;COUNT=4"), Cancel);
        var lunch = await rig.Provider.CreateEventAsync(connection, calendar,
            new EventData("Lunch", "", CalendarTime.Date("2026-11-04"), null), Cancel);
        var original = GoogleProviderContractTests.Time(CalendarTime.Local("2026-11-09T08:00", "America/Chicago"));
        rig.Google.SeedOverride(rig.Address, calendar, gym.Id, original, original.DeepClone().AsObject(), original.DeepClone().AsObject(), "Gym");
        var overrideId = (await rig.Provider.ChangesAsync(connection, calendar, null, Cancel)).Changed.Single(each => each.SeriesId == gym.Id).Id;
        var start = await rig.Provider.ChangesAsync(connection, calendar, null, Cancel);

        await rig.Provider.DeleteEventAsync(connection, calendar, overrideId, (await ReadAsync(rig, connection, calendar, overrideId)).Etag, Cancel);
        await rig.Provider.DeleteEventAsync(connection, calendar, lunch.Id, lunch.Etag, Cancel);
        var since = await rig.Provider.ChangesAsync(connection, calendar, start.SyncToken, Cancel);

        Assert.Contains(lunch.Id, since.Deleted);
        var cancelled = Assert.Single(since.Changed, each => each.Id == overrideId);
        Assert.True(cancelled.Cancelled);
        Assert.Equal(gym.Id, cancelled.SeriesId);
        Assert.Equal(CalendarTime.Local("2026-11-09T08:00", "America/Chicago"), cancelled.OriginalStart);
        // The full listing still holds the series and its cancelled occurrence, its exception.
        var full = await rig.Provider.ChangesAsync(connection, calendar, null, Cancel);
        Assert.Contains(full.Changed, each => each.Id == overrideId && each.Cancelled);
        Assert.DoesNotContain(full.Changed, each => each.Id == lunch.Id);
    }

    [Fact]
    public async Task A_changed_occurrence_is_read_only_here()
    {
        var rig = new GoogleRig();
        var connection = rig.Connection();
        var calendar = rig.Google.AddCalendar(rig.Address, "Work");
        var gym = await rig.Provider.CreateEventAsync(connection, calendar,
            new EventData("Gym", "", CalendarTime.Local("2026-11-02T08:00", "America/Chicago"), null, RRule: "FREQ=WEEKLY;COUNT=4"), Cancel);
        var original = GoogleProviderContractTests.Time(CalendarTime.Local("2026-11-09T08:00", "America/Chicago"));
        rig.Google.SeedOverride(rig.Address, calendar, gym.Id, original, original.DeepClone().AsObject(), original.DeepClone().AsObject(), "Gym");
        var single = (await rig.Provider.ChangesAsync(connection, calendar, null, Cancel)).Changed.Single(each => each.SeriesId == gym.Id);

        var problem = await Assert.ThrowsAsync<CalendarProblem>(() => rig.Provider.UpdateEventAsync(connection, calendar, single, single.Data with { Summary = "Moved" }, Cancel));

        Assert.Equal("calendar_occurrence_read_only", problem.Code);
    }

    [Fact]
    public async Task A_timed_event_can_become_all_day_and_keeps_its_unmapped_recurrence_lines()
    {
        var rig = new GoogleRig();
        var connection = rig.Connection();
        var calendar = rig.Google.AddCalendar(rig.Address, "Work");
        var seeded = rig.Google.Seed(rig.Address, calendar, new JsonObject
        {
            ["summary"] = "Review",
            ["start"] = GoogleProviderContractTests.Time(CalendarTime.Local("2026-11-03T09:00", "America/Chicago")),
            ["end"] = GoogleProviderContractTests.Time(CalendarTime.Local("2026-11-03T10:00", "America/Chicago")),
            ["recurrence"] = new JsonArray("RRULE:FREQ=MONTHLY;COUNT=3", "RDATE;TZID=America/Chicago:20261225T090000"),
        });
        var basis = await ReadAsync(rig, connection, calendar, (string)seeded["id"]!);

        await rig.Provider.UpdateEventAsync(connection, calendar, basis,
            basis.Data with { Start = CalendarTime.Date("2026-11-03"), End = CalendarTime.Date("2026-11-04") }, Cancel);

        var stored = rig.Google.Event(rig.Address, calendar, basis.Id)!;
        Assert.Equal("2026-11-03", (string?)stored["start"]!["date"]);
        Assert.Null(stored["start"]!["dateTime"]);
        Assert.Contains(stored["recurrence"]!.AsArray(), line => (string?)line == "RDATE;TZID=America/Chicago:20261225T090000");
    }

    [Fact]
    public async Task A_refused_change_says_Googles_status_and_reason_and_never_the_events_text()
    {
        var rig = new GoogleRig();
        var connection = rig.Connection();
        var calendar = rig.Google.AddCalendar(rig.Address, "Work");
        var seeded = rig.Google.Seed(rig.Address, calendar, new JsonObject
        {
            ["summary"] = "Kim's birthday",
            ["eventType"] = "birthday",
            ["start"] = new JsonObject { ["date"] = "2026-12-01" },
            ["end"] = new JsonObject { ["date"] = "2026-12-02" },
        });
        var basis = await ReadAsync(rig, connection, calendar, (string)seeded["id"]!);

        var problem = await Assert.ThrowsAsync<CalendarProblem>(() => rig.Provider.UpdateEventAsync(connection, calendar, basis, basis.Data with { Summary = "Party" }, Cancel));

        Assert.Equal(CalendarProblemKind.Refused, problem.Kind);
        Assert.Equal("calendar_refused", problem.Code);
        Assert.Equal("Google answered 400 (eventTypeRestriction)", problem.Message);
        Assert.DoesNotContain("birthday", problem.Describe(), StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task A_refresh_Google_refuses_is_named_as_the_refresh_whatever_call_needed_it()
    {
        var rig = new GoogleRig();
        rig.Google.Expire(rig.RefreshToken);

        var problem = await Assert.ThrowsAsync<CalendarProblem>(() => rig.Provider.ChangesAsync(rig.Connection(), rig.Address, null, Cancel));

        Assert.Equal(CalendarCalls.Refresh, problem.Call);
        Assert.Equal(CalendarCalls.Refresh, problem.At(CalendarCalls.List).Call);
        Assert.Equal("calendar_auth_failed (Google refused the sign-in) in refresh", problem.Describe());
    }

    [Fact]
    public async Task Without_the_calendar_scopes_Google_refuses_and_the_problem_says_so()
    {
        var rig = new GoogleRig(scope: FakeGoogle.EventsScope);

        var problem = await Assert.ThrowsAsync<CalendarProblem>(() => rig.Provider.CalendarsAsync(rig.Connection(), Cancel));

        Assert.Equal(CalendarProblemKind.Refused, problem.Kind);
        Assert.Equal("calendar_forbidden", problem.Code);
    }

    [Fact]
    public async Task Revoking_ends_the_grant_at_Google_and_a_second_revoke_is_fine()
    {
        var rig = new GoogleRig();

        await rig.Provider.RevokeAsync(rig.Connection(), Cancel);
        await rig.Provider.RevokeAsync(rig.Connection(), Cancel);

        Assert.True(rig.Google.Revoked(rig.RefreshToken));
        await Assert.ThrowsAsync<CalendarProblem>(() => rig.Provider.CalendarsAsync(rig.Connection(), Cancel));
    }

    [Fact]
    public async Task A_channel_carries_the_callback_and_token_and_stops()
    {
        var rig = new GoogleRig();
        var connection = rig.Connection();
        var calendar = rig.Google.AddCalendar(rig.Address, "Work");

        var channel = await rig.Provider.WatchAsync(connection, calendar, new Uri("https://pecklist.example.com/api/calendars/google/push"), "secret-token", Cancel);

        var open = Assert.Single(rig.Google.Channels);
        Assert.Equal((channel!.Id, calendar, channel.ResourceId, "https://pecklist.example.com/api/calendars/google/push", "secret-token"), open);
        Assert.InRange(channel.Expires, DateTimeOffset.UtcNow.AddDays(6), DateTimeOffset.UtcNow.AddDays(8));
        await rig.Provider.StopWatchAsync(connection, channel, Cancel);
        Assert.Empty(rig.Google.Channels);
    }

    private static async Task<RemoteEvent> ReadAsync(GoogleRig rig, CalendarConnection connection, string calendar, string id) =>
        (await rig.Provider.ChangesAsync(connection, calendar, null, Cancel)).Changed.Single(each => each.Id == id);
}
