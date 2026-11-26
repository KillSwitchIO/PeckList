using PeckList.CalDav.ICalendar;

namespace PeckList.CalDav.Tests;

public sealed class EventReaderTests
{
    private static CalObject Read(params string[] eventLines) => EventReader.Read(Calendar([], eventLines));

    internal static string Calendar(string[] before, string[] eventLines) =>
        string.Join("\r\n", ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Example//Test//EN", .. before,
            "BEGIN:VEVENT", "UID:event-1@example.com", "DTSTAMP:20261120T100000Z", .. eventLines, "END:VEVENT", "END:VCALENDAR"]) + "\r\n";

    [Fact]
    public void Reads_an_all_day_event_with_its_exclusive_end()
    {
        var calEvent = Read("DTSTART;VALUE=DATE:20261127", "DTEND;VALUE=DATE:20261129", "SUMMARY:Trip").Master!;

        Assert.Equal(EventTime.Day(new DateOnly(2026, 11, 27)), calEvent.Start);
        Assert.Equal(EventTime.Day(new DateOnly(2026, 11, 29)), calEvent.End);
        Assert.True(calEvent.Start.AllDay);
    }

    [Fact]
    public void Reads_a_date_without_VALUE_DATE_as_all_day_too()
    {
        Assert.True(Read("DTSTART:20261127").Master!.Start.AllDay);
    }

    [Fact]
    public void Reads_a_time_in_an_IANA_zone_by_name()
    {
        var calEvent = Read("DTSTART;TZID=America/Chicago:20261127T090000", "DTEND;TZID=America/Chicago:20261127T103000").Master!;

        Assert.Equal(new EventTime(new DateOnly(2026, 11, 27), new TimeOnly(9, 0), "America/Chicago"), calEvent.Start);
        Assert.Equal(new EventTime(new DateOnly(2026, 11, 27), new TimeOnly(10, 30), "America/Chicago"), calEvent.End);
    }

    [Theory]
    [InlineData("/mozilla.org/20050126_1/America/New_York", "America/New_York")]
    [InlineData("/softwarestudio.org/Olson_20011030_5/Europe/Berlin", "Europe/Berlin")]
    [InlineData("/citadel.org/20210210_1/America/Argentina/Buenos_Aires", "America/Argentina/Buenos_Aires")]
    [InlineData("Etc/UTC", "UTC")]
    public void Takes_the_IANA_name_from_behind_a_vendor_prefix(string tzid, string zone)
    {
        Assert.Equal(zone, Read($"DTSTART;TZID={tzid}:20261127T090000").Master!.Start.TimeZone);
    }

    [Fact]
    public void Reads_UTC_and_floating_times()
    {
        Assert.Equal(EventTime.Utc, Read("DTSTART:20261127T150000Z").Master!.Start.TimeZone);
        Assert.Null(Read("DTSTART:20261127T090000").Master!.Start.TimeZone);
    }

    // Outlook names its zones the Windows way and sends the rules along.
    private static readonly string[] OutlookZone =
    [
        "BEGIN:VTIMEZONE", "TZID:Central Standard Time",
        "BEGIN:STANDARD", "DTSTART:16010101T020000", "TZOFFSETFROM:-0500", "TZOFFSETTO:-0600",
        "RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=1SU;BYMONTH=11", "END:STANDARD",
        "BEGIN:DAYLIGHT", "DTSTART:16010101T020000", "TZOFFSETFROM:-0600", "TZOFFSETTO:-0500",
        "RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=2SU;BYMONTH=3", "END:DAYLIGHT",
        "END:VTIMEZONE",
    ];

    [Theory]
    [InlineData("20260715T090000", "2026-07-15T14:00")]  // summer, -5
    [InlineData("20261127T090000", "2026-11-27T15:00")]  // winter, -6
    [InlineData("20261101T013000", "2026-11-01T06:30")]  // the repeated hour reads as daylight time
    [InlineData("20260308T030000", "2026-03-08T08:00")]  // just after the spring change
    public void Reads_a_time_in_a_zone_it_does_not_know_by_name_through_its_VTIMEZONE_in_UTC(string local, string utc)
    {
        var start = EventReader.Read(Calendar(OutlookZone, [$"DTSTART;TZID=Central Standard Time:{local}"])).Master!.Start;

        Assert.Equal(EventTime.Utc, start.TimeZone);
        Assert.Equal(DateTime.Parse(utc, System.Globalization.CultureInfo.InvariantCulture), start.Local);
    }

    [Fact]
    public void Reads_a_zone_it_cannot_resolve_at_all_as_floating()
    {
        Assert.Null(Read("DTSTART;TZID=Somewhere Odd:20261127T090000").Master!.Start.TimeZone);
    }

    [Fact]
    public void Leaves_the_end_empty_when_the_event_has_neither_DTEND_nor_DURATION()
    {
        Assert.Null(Read("DTSTART;TZID=Europe/Berlin:20261127T090000").Master!.End);
    }

    [Fact]
    public void Turns_a_DURATION_into_an_end()
    {
        Assert.Equal(new EventTime(new DateOnly(2026, 11, 28), new TimeOnly(0, 15), "Europe/Berlin"),
            Read("DTSTART;TZID=Europe/Berlin:20261127T233000", "DURATION:PT45M").Master!.End);
        Assert.Equal(EventTime.Day(new DateOnly(2026, 11, 30)), Read("DTSTART;VALUE=DATE:20261127", "DURATION:P3D").Master!.End);
    }

    [Fact]
    public void Keeps_the_repeat_rule_as_content_lines()
    {
        var calEvent = Read("DTSTART;TZID=America/Chicago:20261127T090000", "RRULE:FREQ=WEEKLY;BYDAY=FR;COUNT=10",
            "EXDATE;TZID=America/Chicago:20261204T090000,20261211T090000").Master!;

        Assert.Equal(["RRULE:FREQ=WEEKLY;BYDAY=FR;COUNT=10", "EXDATE;TZID=America/Chicago:20261204T090000,20261211T090000"], calEvent.Recurrence);
    }

    [Fact]
    public void Keeps_changed_occurrences_apart_from_the_series()
    {
        var text = Calendar([], ["DTSTART;TZID=Europe/Berlin:20261127T090000", "RRULE:FREQ=DAILY", "SUMMARY:Standup"])
            .Replace("END:VCALENDAR", string.Join("\r\n", "BEGIN:VEVENT", "UID:event-1@example.com", "DTSTAMP:20261120T100000Z",
                "RECURRENCE-ID;TZID=Europe/Berlin:20261128T090000", "DTSTART;TZID=Europe/Berlin:20261128T100000", "SUMMARY:Standup, later",
                "END:VEVENT", "END:VCALENDAR"), StringComparison.Ordinal);

        var read = EventReader.Read(text);

        Assert.Equal("Standup", read.Master!.Summary);
        var moved = Assert.Single(read.Overrides);
        Assert.Equal(new EventTime(new DateOnly(2026, 11, 28), new TimeOnly(9, 0), "Europe/Berlin"), moved.RecurrenceId);
        Assert.Equal("Standup, later", moved.Summary);
        Assert.Equal("event-1@example.com", read.Uid);
    }

    [Fact]
    public void Reads_the_text_status_and_change_stamp()
    {
        var calEvent = Read("DTSTART;VALUE=DATE:20261127", @"SUMMARY:Pick up\, drop off", @"DESCRIPTION:Line one\nLine two",
            "STATUS:CANCELLED", "LAST-MODIFIED:20261125T080910Z", "SEQUENCE:3").Master!;

        Assert.Equal("Pick up, drop off", calEvent.Summary);
        Assert.Equal("Line one\nLine two", calEvent.Description);
        Assert.True(calEvent.Cancelled);
        Assert.Equal(new DateTimeOffset(2026, 11, 25, 8, 9, 10, TimeSpan.Zero), calEvent.LastModified);
        Assert.Equal(3, calEvent.Sequence);
    }

    [Fact]
    public void Falls_back_to_DTSTAMP_for_the_change_stamp()
    {
        Assert.Equal(new DateTimeOffset(2026, 11, 20, 10, 0, 0, TimeSpan.Zero), Read("DTSTART;VALUE=DATE:20261127").Master!.LastModified);
    }

    [Fact]
    public void Ignores_tasks_and_journals_in_the_same_object()
    {
        var read = EventReader.Read("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VTODO\r\nUID:t\r\nSUMMARY:x\r\nEND:VTODO\r\nEND:VCALENDAR\r\n");

        Assert.Null(read.Master);
        Assert.Empty(read.Overrides);
    }

    [Theory]
    [InlineData("SUMMARY:No UID or start")]
    [InlineData("DTSTART:yesterday")]
    public void Refuses_an_event_without_a_usable_start(string line)
    {
        Assert.Throws<CalendarFormatException>(() => Read(line));
    }
}
