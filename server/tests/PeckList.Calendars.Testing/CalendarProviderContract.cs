using PeckList.Core.Calendars;

namespace PeckList.Calendars.Testing;

/// <summary>
/// What an adapter's test class hands the contract kit: a provider, a connection, and a fresh empty
/// calendar that nothing else writes to. The hooks reach past the port for what only the service's own
/// clients can do; a hook left null skips its case.
/// </summary>
/// <param name="CalendarId">A writable calendar, empty, used by this one test.</param>
/// <param name="RejectedSyncToken">A sync token shaped as the service's own that it will refuse (expired or made up).</param>
/// <param name="WrongPassword">The same account with a wrong password; null when the test service has no passwords.</param>
/// <param name="SeedWithExtras">
/// Makes an event in the calendar the way another client would, with a location and an alarm (things
/// the port does not map), and returns it as the adapter reads it.
/// </param>
/// <param name="HasExtras">Whether an event read through the adapter still has that location and alarm.</param>
/// <param name="SeedOverride">
/// Moves one occurrence of a repeating event the way another client would: the series' id, the
/// occurrence's original start, and the occurrence as moved.
/// </param>
public sealed record CalendarTestTarget(
    ICalendarProvider Provider,
    CalendarConnection Connection,
    string CalendarId,
    string RejectedSyncToken,
    CalendarConnection? WrongPassword = null,
    Func<string, EventData, CancellationToken, Task<RemoteEvent>>? SeedWithExtras = null,
    Func<RemoteEvent, bool>? HasExtras = null,
    Func<string, string, CalendarTime, EventData, CancellationToken, Task>? SeedOverride = null);

/// <summary>
/// The calendar adapter contract (spec: PL-134, Shape: "contract tests that every adapter passes"):
/// derive from it in the adapter's tests and supply <see cref="TargetAsync"/>. The fake runs it in
/// PeckList.Calendars.Tests, CalDAV against Radicale in PeckList.CalDav.Tests, Google against its
/// recorded fake. The data is made up.
/// </summary>
public abstract class CalendarProviderContract
{
    /// <summary>A fresh target for one test.</summary>
    protected abstract Task<CalendarTestTarget> TargetAsync(CancellationToken cancellation);

    private static CancellationToken Cancel => TestContext.Current.CancellationToken;

    private const string Zone = "America/Chicago";

    /// <summary>The shapes a task maps to (decision 5), and text that needs escaping.</summary>
    public static TheoryData<string> Shapes => [.. ShapeData.Keys];

    private static readonly Dictionary<string, EventData> ShapeData = new(StringComparer.Ordinal)
    {
        ["all-day, one day"] = new("Bins out", "", CalendarTime.Date("2026-11-03"), CalendarTime.Date("2026-11-04")),
        ["all-day, three days"] = new("Trip", "", CalendarTime.Date("2026-11-03"), CalendarTime.Date("2026-11-06")),
        ["timed, with a zone"] = new("Dentist", "Bring the form", CalendarTime.Local("2026-11-03T09:00", Zone), CalendarTime.Local("2026-11-03T10:30", Zone)),
        ["timed, across midnight"] = new("Night shift", "", CalendarTime.Local("2026-11-03T23:30", "Europe/Berlin"), CalendarTime.Local("2026-11-04T00:15", "Europe/Berlin")),
        ["timed, in UTC"] = new("Standup", "", CalendarTime.Local("2026-11-05T14:00", "UTC"), CalendarTime.Local("2026-11-05T14:15", "UTC")),
        ["text that needs escaping"] = new(
            "Café ☕ review; notes, too",
            "Line one\nLine two, with; commas\\ and a backslash\n\nÜnïcödé and 日本語",
            CalendarTime.Local("2026-11-06T08:00", Zone),
            CalendarTime.Local("2026-11-06T08:30", Zone)),
        ["written by PeckList"] = new("Pay rent", "", CalendarTime.Date("2026-11-07"), CalendarTime.Date("2026-11-08"),
            Marker: new EventMarker("01JDZK6Q1Y9V3W5T7R8P0N2M4K", "01JDZK7A2B3C4D5E6F7G8H9J0K")),
    };

    [Theory]
    [MemberData(nameof(Shapes))]
    public async Task An_event_reads_back_as_it_was_written(string shape)
    {
        var target = await TargetAsync(Cancel);
        var data = ShapeData[shape];

        var created = await target.Provider.CreateEventAsync(target.Connection, target.CalendarId, data, Cancel);

        Assert.False(string.IsNullOrEmpty(created.Id));
        Assert.False(string.IsNullOrEmpty(created.Etag));
        AssertSameEvent(data, created.Data);
        AssertSameEvent(data, (await ReadAsync(target, created.Id)).Data);
    }

    [Fact]
    public async Task An_event_written_without_an_end_lasts_30_minutes_or_one_day()
    {
        var target = await TargetAsync(Cancel);

        var timed = await target.Provider.CreateEventAsync(target.Connection, target.CalendarId,
            new EventData("Call", "", CalendarTime.Local("2026-11-03T09:45", Zone), null), Cancel);
        var allDay = await target.Provider.CreateEventAsync(target.Connection, target.CalendarId,
            new EventData("Holiday", "", CalendarTime.Date("2026-11-30"), null), Cancel);

        Assert.Equal(CalendarTime.Local("2026-11-03T10:15", Zone), (await ReadAsync(target, timed.Id)).Data.End);
        Assert.Equal(CalendarTime.Date("2026-12-01"), (await ReadAsync(target, allDay.Id)).Data.End);
    }

    [Fact]
    public async Task A_full_listing_holds_everything_and_a_token_then_brings_only_what_changed()
    {
        var target = await TargetAsync(Cancel);
        var first = await CreateAsync(target, "First");
        var second = await CreateAsync(target, "Second");

        var full = await target.Provider.ChangesAsync(target.Connection, target.CalendarId, null, Cancel);
        Assert.True(full.Reset);
        Assert.NotNull(full.SyncToken);
        Assert.Equal(new[] { first.Id, second.Id }.Order(StringComparer.Ordinal), full.Changed.Select(each => each.Id).Order(StringComparer.Ordinal), StringComparer.Ordinal);

        var third = await CreateAsync(target, "Third");
        await target.Provider.DeleteEventAsync(target.Connection, target.CalendarId, first.Id, first.Etag, Cancel);
        var since = await target.Provider.ChangesAsync(target.Connection, target.CalendarId, full.SyncToken, Cancel);

        Assert.False(since.Reset);
        Assert.Contains(since.Changed, each => each.Id == third.Id && !each.Cancelled);
        Assert.DoesNotContain(since.Changed, each => each.Id == second.Id);
        Assert.True(since.Deleted.Contains(first.Id) || since.Changed.Any(each => each.Id == first.Id && each.Cancelled),
            "a deleted event comes as deleted or cancelled");
    }

    [Fact]
    public async Task An_update_with_the_current_etag_lands_and_one_with_a_stale_etag_is_a_conflict()
    {
        var target = await TargetAsync(Cancel);
        var created = await CreateAsync(target, "Dentist");
        var renamed = created.Data with { Summary = "Dentist (moved)", Start = CalendarTime.Local("2026-11-03T11:00", Zone), End = CalendarTime.Local("2026-11-03T11:30", Zone) };

        var updated = await target.Provider.UpdateEventAsync(target.Connection, target.CalendarId, created, renamed, Cancel);

        Assert.NotEqual(created.Etag, updated.Etag);
        Assert.True(updated.UpdatedAt >= created.UpdatedAt);
        AssertSameEvent(renamed, (await ReadAsync(target, created.Id)).Data);
        var stale = await Assert.ThrowsAsync<CalendarProblem>(() =>
            target.Provider.UpdateEventAsync(target.Connection, target.CalendarId, created, renamed with { Summary = "Lost" }, Cancel));
        Assert.Equal(CalendarProblemKind.Conflict, stale.Kind);
    }

    [Fact]
    public async Task A_delete_with_a_stale_etag_is_a_conflict_and_deleting_a_gone_event_succeeds()
    {
        var target = await TargetAsync(Cancel);
        var created = await CreateAsync(target, "Dentist");
        var updated = await target.Provider.UpdateEventAsync(target.Connection, target.CalendarId, created, created.Data with { Summary = "Dentist!" }, Cancel);

        var stale = await Assert.ThrowsAsync<CalendarProblem>(() =>
            target.Provider.DeleteEventAsync(target.Connection, target.CalendarId, created.Id, created.Etag, Cancel));
        Assert.Equal(CalendarProblemKind.Conflict, stale.Kind);

        await target.Provider.DeleteEventAsync(target.Connection, target.CalendarId, updated.Id, updated.Etag, Cancel);
        await target.Provider.DeleteEventAsync(target.Connection, target.CalendarId, updated.Id, updated.Etag, Cancel);
        var full = await target.Provider.ChangesAsync(target.Connection, target.CalendarId, null, Cancel);
        Assert.DoesNotContain(full.Changed, each => each.Id == created.Id && !each.Cancelled);
    }

    [Fact]
    public async Task A_sync_token_the_service_refuses_asks_for_a_full_listing()
    {
        var target = await TargetAsync(Cancel);

        var problem = await Assert.ThrowsAsync<CalendarProblem>(() =>
            target.Provider.ChangesAsync(target.Connection, target.CalendarId, target.RejectedSyncToken, Cancel));

        Assert.Equal(CalendarProblemKind.SyncTokenExpired, problem.Kind);
    }

    [Fact]
    public async Task The_marker_survives_an_update_and_events_written_elsewhere_have_none()
    {
        var target = await TargetAsync(Cancel);
        var marker = new EventMarker("01JDZK6Q1Y9V3W5T7R8P0N2M4K", "01JDZK7A2B3C4D5E6F7G8H9J0K");
        var created = await target.Provider.CreateEventAsync(target.Connection, target.CalendarId,
            new EventData("Pay rent", "", CalendarTime.Date("2026-11-07"), CalendarTime.Date("2026-11-08"), Marker: marker), Cancel);

        await target.Provider.UpdateEventAsync(target.Connection, target.CalendarId, created, created.Data with { Summary = "Pay rent today" }, Cancel);
        var read = await ReadAsync(target, created.Id);

        Assert.Equal(marker, read.Data.Marker);
        Assert.Equal("Pay rent today", read.Data.Summary);
        var elsewhere = await CreateAsync(target, "Not ours");
        Assert.Null((await ReadAsync(target, elsewhere.Id)).Data.Marker);
    }

    [Fact]
    public async Task An_update_keeps_what_the_engine_does_not_map()
    {
        var target = await TargetAsync(Cancel);
        if (target.SeedWithExtras is null || target.HasExtras is null) Assert.Skip("the adapter has no seed hook for unmapped properties");
        var seeded = await target.SeedWithExtras(target.CalendarId,
            new EventData("Team lunch", "", CalendarTime.Local("2026-11-10T12:00", Zone), CalendarTime.Local("2026-11-10T13:00", Zone)), Cancel);
        Assert.True(target.HasExtras(seeded));
        Assert.Null(seeded.Data.Marker);

        await target.Provider.UpdateEventAsync(target.Connection, target.CalendarId, seeded, seeded.Data with { Summary = "Team lunch (booked)" }, Cancel);
        var read = await ReadAsync(target, seeded.Id);

        Assert.Equal("Team lunch (booked)", read.Data.Summary);
        Assert.True(target.HasExtras(read), "the location and alarm are still there");
    }

    [Fact]
    public async Task A_repeating_rule_and_its_exceptions_read_back_as_written()
    {
        var target = await TargetAsync(Cancel);
        var data = new EventData("Gym", "", CalendarTime.Local("2026-11-02T08:00", "America/New_York"), CalendarTime.Local("2026-11-02T08:30", "America/New_York"),
            RRule: "FREQ=WEEKLY;BYDAY=MO,WE;COUNT=10", ExDates: [CalendarTime.Local("2026-11-09T08:00", "America/New_York")]);

        var created = await target.Provider.CreateEventAsync(target.Connection, target.CalendarId, data, Cancel);

        AssertSameEvent(data, (await ReadAsync(target, created.Id)).Data);
    }

    [Fact]
    public async Task One_moved_occurrence_comes_back_as_an_override_of_its_series()
    {
        var target = await TargetAsync(Cancel);
        if (target.SeedOverride is null) Assert.Skip("the adapter has no seed hook for overrides");
        var series = await target.Provider.CreateEventAsync(target.Connection, target.CalendarId,
            new EventData("Gym", "", CalendarTime.Local("2026-11-02T08:00", Zone), CalendarTime.Local("2026-11-02T08:30", Zone), RRule: "FREQ=WEEKLY;COUNT=4"), Cancel);
        var original = CalendarTime.Local("2026-11-09T08:00", Zone);
        var moved = new EventData("Gym", "", CalendarTime.Local("2026-11-10T18:00", Zone), CalendarTime.Local("2026-11-10T18:30", Zone));

        await target.SeedOverride(target.CalendarId, series.Id, original, moved, Cancel);
        var full = await target.Provider.ChangesAsync(target.Connection, target.CalendarId, null, Cancel);

        var single = Assert.Single(full.Changed, each => each.SeriesId == series.Id);
        Assert.NotEqual(series.Id, single.Id);
        Assert.Equal(original, single.OriginalStart);
        AssertSameEvent(moved, single.Data);
        var master = Assert.Single(full.Changed, each => each.Id == series.Id && each.SeriesId is null);
        if (!target.Provider.Capabilities.SeriesListsOverrides) return;

        // A provider that lists a changed series with its overrides does so after a change to the series too.
        await target.Provider.UpdateEventAsync(target.Connection, target.CalendarId, master, master.Data with { Summary = "Gym (renamed)" }, Cancel);
        var since = await target.Provider.ChangesAsync(target.Connection, target.CalendarId, full.SyncToken, Cancel);
        Assert.Contains(since.Changed, each => each.SeriesId == series.Id && each.OriginalStart == original);
    }

    [Fact]
    public async Task A_wrong_password_is_an_auth_problem()
    {
        var target = await TargetAsync(Cancel);
        if (target.WrongPassword is null) Assert.Skip("the test service takes any password");

        var problem = await Assert.ThrowsAsync<CalendarProblem>(() => target.Provider.CalendarsAsync(target.WrongPassword, Cancel));

        Assert.Equal(CalendarProblemKind.Auth, problem.Kind);
        Assert.DoesNotContain(target.WrongPassword.Secret, problem.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task The_calendar_is_listed_and_a_created_one_is_too()
    {
        var target = await TargetAsync(Cancel);
        Assert.Contains(await target.Provider.CalendarsAsync(target.Connection, Cancel), each => each.Id == target.CalendarId && !each.ReadOnly);
        if (!target.Provider.Capabilities.CreateCalendar) return;

        var made = await target.Provider.CreateCalendarAsync(target.Connection, "PeckList", Cancel);

        var listed = Assert.Single(await target.Provider.CalendarsAsync(target.Connection, Cancel), each => each.Id == made.Id);
        Assert.Equal("PeckList", listed.Name);
        Assert.False(listed.ReadOnly);
        var created = await target.Provider.CreateEventAsync(target.Connection, made.Id,
            new EventData("First", "", CalendarTime.Date("2026-11-03"), CalendarTime.Date("2026-11-04")), Cancel);
        Assert.Contains((await target.Provider.ChangesAsync(target.Connection, made.Id, null, Cancel)).Changed, each => each.Id == created.Id);
    }

    [Fact]
    public async Task Watching_opens_a_channel_exactly_when_the_provider_can_push()
    {
        var target = await TargetAsync(Cancel);

        var channel = await target.Provider.WatchAsync(target.Connection, target.CalendarId, new Uri("https://pecklist.example.com/api/calendars/push"), "channel-token", Cancel);

        if (!target.Provider.Capabilities.Push)
        {
            Assert.Null(channel);
            return;
        }
        Assert.NotNull(channel);
        Assert.True(channel.Expires > DateTimeOffset.UtcNow);
        await target.Provider.StopWatchAsync(target.Connection, channel, Cancel);
        await target.Provider.StopWatchAsync(target.Connection, channel, Cancel);
    }

    /// <summary>The event as a full listing reads it now.</summary>
    protected static async Task<RemoteEvent> ReadAsync(CalendarTestTarget target, string eventId)
    {
        var full = await target.Provider.ChangesAsync(target.Connection, target.CalendarId, null, Cancel);
        return Assert.Single(full.Changed, each => each.Id == eventId);
    }

    private static Task<RemoteEvent> CreateAsync(CalendarTestTarget target, string summary) =>
        target.Provider.CreateEventAsync(target.Connection, target.CalendarId,
            new EventData(summary, "", CalendarTime.Local("2026-11-03T09:00", Zone), CalendarTime.Local("2026-11-03T09:30", Zone)), Cancel);

    /// <summary>Every mapped field the same (records with lists do not compare by value).</summary>
    protected static void AssertSameEvent(EventData expected, EventData actual)
    {
        Assert.Equal(expected.Summary, actual.Summary);
        Assert.Equal(expected.Description, actual.Description);
        Assert.Equal(expected.Start, actual.Start);
        Assert.Equal(expected.End, actual.End);
        Assert.Equal(expected.RRule, actual.RRule);
        Assert.Equal(expected.ExDates ?? [], actual.ExDates ?? []);
        Assert.Equal(expected.Marker, actual.Marker);
    }
}
