using System.Diagnostics;
using PeckList.Core.Calendars;

namespace PeckList.Calendars.Tests;

/// <summary>
/// The import window's edges that a listed event can push on (spec: PL-134, decision 8): the calendar's
/// server decides how old a series is and what its rule says, and one event must not hold a run.
/// </summary>
public sealed class ImportWindowTests
{
    private static readonly DateOnly Today = new(2026, 11, 26);

    [Theory]
    // Daily since year 1 with no end: looked at from yesterday, not walked.
    [InlineData("0001-01-01", "FREQ=DAILY", true)]
    [InlineData("0001-01-01", "FREQ=DAILY;UNTIL=20261125", false)]
    // A COUNT walked from year 1 runs out of days to look at and goes by UNTIL.
    [InlineData("0001-01-01", "FREQ=DAILY;COUNT=999999999", true)]
    [InlineData("0001-01-01", "FREQ=DAILY;COUNT=999999999;UNTIL=20000101", false)]
    // An INTERVAL too large to look through goes by UNTIL.
    [InlineData("2020-01-01", "FREQ=YEARLY;INTERVAL=2000000000", true)]
    [InlineData("2020-01-01", "FREQ=YEARLY;INTERVAL=2000000000;UNTIL=20250101", false)]
    [InlineData("2020-01-01", "FREQ=DAILY;INTERVAL=100000", true)]
    // Within the days looked at, a COUNT still ends a series: a ten-year interval's second is in 2030.
    [InlineData("2020-01-01", "FREQ=YEARLY;INTERVAL=10;COUNT=2", true)]
    [InlineData("2020-01-01", "FREQ=YEARLY;INTERVAL=10;COUNT=1", false)]
    [InlineData("9999-12-30", "FREQ=DAILY", true)]
    public void A_listed_series_is_decided_quickly_whatever_its_rule_says(string start, string rule, bool inWindow)
    {
        var data = new EventData("Series", "", CalendarTime.Date(start), null, RRule: rule);
        var clock = Stopwatch.StartNew();

        var decided = ImportWindow.InWindow(data, Today, "UTC");

        Assert.Equal(inWindow, decided);
        Assert.True(clock.Elapsed < TimeSpan.FromSeconds(2), $"took {clock.Elapsed}");
    }

    [Fact]
    public void A_series_with_every_occurrence_left_out_is_decided_quickly()
    {
        // Every hundredth day from yesterday to the last date there is, each one left out (Security M3).
        var yesterday = Today.AddDays(-1);
        var left = new List<CalendarTime>();
        for (var date = yesterday; date.Year < 9999; date = date.AddDays(100)) left.Add(CalendarTime.Date(date.ToString("yyyy-MM-dd")));
        var data = new EventData("Series", "", CalendarTime.Date(yesterday.ToString("yyyy-MM-dd")), null, RRule: "FREQ=DAILY;INTERVAL=100", ExDates: left);
        var clock = Stopwatch.StartNew();

        var decided = ImportWindow.InWindow(data, Today, "UTC");

        // Not shown to end within the days looked at, so taken to go on, as an open rule is.
        Assert.True(decided);
        Assert.True(clock.Elapsed < TimeSpan.FromSeconds(2), $"took {clock.Elapsed}");
        Assert.False(ImportWindow.InWindow(data with { RRule = "FREQ=DAILY;INTERVAL=100;UNTIL=20400101" }, Today, "UTC"));
    }

    [Fact]
    public void A_series_moves_to_its_occurrence_from_today_unless_its_end_would_pass_the_last_date()
    {
        var weekly = new EventData("Choir", "", CalendarTime.Date("2026-10-01"), CalendarTime.Date("2026-10-02"), RRule: "FREQ=WEEKLY");
        var absurd = weekly with { End = CalendarTime.Date("9999-12-30") };

        Assert.Equal("2026-11-26", ImportWindow.Onward(weekly, Today).Start.Value);
        Assert.Equal("2026-11-27", ImportWindow.Onward(weekly, Today).End!.Value);
        // Security N5: one listed event must not fail every run.
        Assert.Equal(absurd, ImportWindow.Onward(absurd, Today));
    }

    [Fact]
    public void A_left_out_occurrence_today_moves_the_look_to_the_next_one()
    {
        var data = new EventData("Choir", "", CalendarTime.Date("2026-10-01"), null, RRule: "FREQ=WEEKLY;BYDAY=TH;UNTIL=20261126",
            ExDates: [CalendarTime.Date("2026-11-26")]);

        Assert.False(ImportWindow.InWindow(data, Today, "UTC"));
        Assert.True(ImportWindow.InWindow(data with { RRule = "FREQ=WEEKLY;BYDAY=TH;UNTIL=20261203" }, Today, "UTC"));
    }
}
