using PeckList.Core.Calendars;

namespace PeckList.Core.Tests.Calendars;

public sealed class CalendarOccurrencesTests
{
    private static readonly DateTimeOffset At = new(2026, 11, 26, 9, 0, 0, TimeSpan.Zero);

    private static CalendarItem Item(RemoteEvent remote, HiddenMarks? hidden = null) =>
        new("link1", remote.Id, null, remote.Etag, CalendarJson.Write(remote), CalendarJson.Write(remote.Data), hidden?.Write(), At);

    private static readonly RemoteEvent Gym = new("gym", "\"1\"",
        new EventData("Gym", "", CalendarTime.Local("2026-11-02T07:00", "Europe/London"), CalendarTime.Local("2026-11-02T08:00", "Europe/London"),
            "FREQ=WEEKLY;BYDAY=MO;COUNT=6", [CalendarTime.Local("2026-11-16T07:00", "Europe/London")]), At);

    private static string[] Days(IEnumerable<ShownEvent> shown) => [.. shown.Select(each => $"{each.Occurrence} {each.Data.Start.Value}")];

    [Fact]
    public void A_repeating_event_shows_each_occurrence_in_range_without_its_exceptions_or_past_its_count()
    {
        var shown = CalendarOccurrences.Expand("link1", [Item(Gym)], new DateOnly(2026, 11, 9), new DateOnly(2026, 12, 31));

        Assert.Equal(["2026-11-09 2026-11-09T07:00", "2026-11-23 2026-11-23T07:00", "2026-11-30 2026-11-30T07:00", "2026-12-07 2026-12-07T07:00"], Days(shown));
        Assert.All(shown, each => Assert.True(each.Recurring));
    }

    [Fact]
    public void One_calendar_shows_at_most_its_share_and_says_it_was_cut_short()
    {
        // Security N4: 3000 single events on one day, and 100 daily series running since 2020.
        var singles = Enumerable.Range(0, 3000).Select(each => Item(new RemoteEvent($"e{each:D4}", "\"1\"",
            new EventData("Busy", "", CalendarTime.Date("2026-11-10"), null), At)));
        var daily = Enumerable.Range(0, 100).Select(each => Item(new RemoteEvent($"d{each:D3}", "\"1\"",
            new EventData("Daily", "", CalendarTime.Date("2020-01-01"), null, "FREQ=DAILY"), At)));

        var many = CalendarOccurrences.Expand("link1", singles, new DateOnly(2026, 11, 1), new DateOnly(2026, 11, 30), out var manyCut);
        var longRunning = CalendarOccurrences.Expand("link1", daily, new DateOnly(2026, 11, 1), new DateOnly(2026, 11, 30), out var longCut);
        var few = CalendarOccurrences.Expand("link1", [Item(Gym)], new DateOnly(2026, 11, 1), new DateOnly(2026, 11, 30), out var fewCut);

        Assert.Equal(CalendarOccurrences.MaxShownPerLink, many.Count);
        Assert.True(manyCut);
        Assert.True(longCut, "the step budget ran out before every series reached the range");
        Assert.True(longRunning.Count < 100 * 30);
        Assert.False(fewCut);
        Assert.NotEmpty(few);
    }

    [Fact]
    public void A_moved_occurrence_shows_in_its_new_place_and_a_cancelled_one_not_at_all()
    {
        var moved = new RemoteEvent("gym@2026-11-09", "\"2\"",
            new EventData("Gym (late)", "", CalendarTime.Local("2026-11-10T18:00", "Europe/London"), CalendarTime.Local("2026-11-10T19:00", "Europe/London")),
            At, "gym", CalendarTime.Local("2026-11-09T07:00", "Europe/London"));
        var cancelled = new RemoteEvent("gym@2026-11-23", "\"3\"", Gym.Data, At, "gym", CalendarTime.Local("2026-11-23T07:00", "Europe/London"), Cancelled: true);

        var shown = CalendarOccurrences.Expand("link1", [Item(Gym), Item(moved), Item(cancelled)], new DateOnly(2026, 11, 9), new DateOnly(2026, 11, 29));

        Assert.Equal(["2026-11-09 2026-11-10T18:00"], Days(shown));
        Assert.Equal("gym@2026-11-09", shown[0].EventId);
    }

    [Fact]
    public void Hidden_occurrences_and_hidden_events_stay_out()
    {
        var dentist = new RemoteEvent("dentist", "\"4\"", new EventData("Dentist", "", CalendarTime.Date("2026-11-30"), CalendarTime.Date("2026-12-01")), At);

        var shown = CalendarOccurrences.Expand("link1",
            [Item(Gym, HiddenMarks.None.Hide("2026-11-09")), Item(dentist, HiddenMarks.None.Hide(null))],
            new DateOnly(2026, 11, 9), new DateOnly(2026, 11, 30));

        Assert.Equal(["2026-11-23 2026-11-23T07:00", "2026-11-30 2026-11-30T07:00"], Days(shown));
    }

    [Fact]
    public void An_event_spanning_into_the_range_shows_and_an_all_day_end_is_the_day_after()
    {
        var trip = new RemoteEvent("trip", "\"5\"", new EventData("Trip", "", CalendarTime.Date("2026-11-27"), CalendarTime.Date("2026-12-02")), At);
        var day = new RemoteEvent("day", "\"6\"", new EventData("Day off", "", CalendarTime.Date("2026-11-30"), CalendarTime.Date("2026-12-01")), At);

        var shown = CalendarOccurrences.Expand("link1", [Item(trip), Item(day)], new DateOnly(2026, 12, 1), new DateOnly(2026, 12, 7));

        Assert.Equal(["2026-11-27 2026-11-27"], Days(shown));
    }
}
