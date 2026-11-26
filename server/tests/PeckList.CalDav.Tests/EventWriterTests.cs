using PeckList.CalDav.ICalendar;

namespace PeckList.CalDav.Tests;

public sealed class EventWriterTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 26, 12, 0, 0, TimeSpan.Zero);

    private static CalEvent Event(EventTime start, EventTime? end = null) =>
        new() { Uid = "pecklist-1", Summary = "Dentist", Start = start, End = end };

    private static EventTime At(int day, int hour, int minute, string? zone = "America/Chicago") =>
        new(new DateOnly(2026, 11, day), new TimeOnly(hour, minute), zone);

    private static CalObject RoundTrip(CalEvent calEvent) => EventReader.Read(EventWriter.Create(calEvent, Now));

    [Fact]
    public void Gives_a_time_with_no_end_thirty_minutes()
    {
        var read = RoundTrip(Event(At(27, 9, 0)));

        Assert.Equal(At(27, 9, 0), read.Master!.Start);
        Assert.Equal(At(27, 9, 30), read.Master.End);
    }

    [Fact]
    public void Carries_the_thirty_minutes_past_midnight()
    {
        Assert.Equal(At(28, 0, 10), RoundTrip(Event(At(27, 23, 40))).Master!.End);
    }

    [Fact]
    public void Keeps_a_start_and_end_as_given()
    {
        Assert.Equal(At(27, 11, 15), RoundTrip(Event(At(27, 9, 0), At(27, 11, 15))).Master!.End);
    }

    [Fact]
    public void Replaces_an_end_that_is_not_after_the_start()
    {
        Assert.Equal(At(27, 9, 30), RoundTrip(Event(At(27, 9, 0), At(27, 8, 0))).Master!.End);
    }

    [Fact]
    public void Writes_a_date_with_no_time_as_a_one_day_all_day_event()
    {
        var text = EventWriter.Create(Event(EventTime.Day(new DateOnly(2026, 11, 27))), Now);

        Assert.Contains("DTSTART;VALUE=DATE:20261127\r\n", text, StringComparison.Ordinal);
        Assert.Contains("DTEND;VALUE=DATE:20261128\r\n", text, StringComparison.Ordinal);
        Assert.DoesNotContain("VTIMEZONE", text, StringComparison.Ordinal);
    }

    [Fact]
    public void Keeps_a_several_day_all_day_event()
    {
        var read = RoundTrip(Event(EventTime.Day(new DateOnly(2026, 11, 27)), EventTime.Day(new DateOnly(2026, 11, 30))));

        Assert.Equal(EventTime.Day(new DateOnly(2026, 11, 30)), read.Master!.End);
    }

    [Fact]
    public void Writes_UTC_with_a_Z_and_floating_times_bare_with_no_VTIMEZONE()
    {
        var utc = EventWriter.Create(Event(At(27, 15, 0, EventTime.Utc)), Now);
        var floating = EventWriter.Create(Event(At(27, 9, 0, null)), Now);

        Assert.Contains("DTSTART:20261127T150000Z\r\n", utc, StringComparison.Ordinal);
        Assert.Contains("DTSTART:20261127T090000\r\n", floating, StringComparison.Ordinal);
        Assert.DoesNotContain("VTIMEZONE", utc + floating, StringComparison.Ordinal);
    }

    [Fact]
    public void Adds_a_VTIMEZONE_whose_rules_give_the_zones_offsets()
    {
        var text = EventWriter.Create(Event(At(27, 9, 0)), Now);
        var zone = CalText.Parse(text).Components("VTIMEZONE").Single();

        Assert.Equal("America/Chicago", zone.Property("TZID")!.Value);
        Assert.Contains(zone.Children, c => c.Name == "DAYLIGHT" && c.Property("RRULE")!.Value == "FREQ=YEARLY;BYMONTH=3;BYDAY=2SU");
        Assert.Contains(zone.Children, c => c.Name == "STANDARD" && c.Property("RRULE")!.Value == "FREQ=YEARLY;BYMONTH=11;BYDAY=1SU");
        var chicago = TimeZoneInfo.FindSystemTimeZoneById("America/Chicago");
        for (var day = new DateTime(2026, 1, 1, 12, 0, 0); day.Year < 2030; day = day.AddDays(5))
            Assert.Equal(chicago.GetUtcOffset(day), CalZones.Offset(zone, day));
    }

    [Theory]
    [InlineData("Europe/Berlin")]
    [InlineData("Australia/Sydney")]
    [InlineData("America/Sao_Paulo")]
    [InlineData("Asia/Tokyo")]
    [InlineData("Asia/Kolkata")]
    public void Builds_VTIMEZONEs_that_agree_with_the_zone(string iana)
    {
        var zone = CalZones.Build(iana, 2026);
        var info = TimeZoneInfo.FindSystemTimeZoneById(iana);

        for (var day = new DateTime(2026, 1, 1, 12, 0, 0); day.Year < 2028; day = day.AddDays(3))
            Assert.Equal(info.GetUtcOffset(day), CalZones.Offset(zone, day));
    }

    [Fact]
    public void Refuses_a_zone_it_does_not_know()
    {
        Assert.Throws<ArgumentException>(() => EventWriter.Create(Event(At(27, 9, 0, "Mars/Olympus_Mons")), Now));
    }

    [Fact]
    public void Writes_the_repeat_rule_lines_it_is_given()
    {
        var read = RoundTrip(Event(At(27, 9, 0)) with { Recurrence = ["RRULE:FREQ=WEEKLY;BYDAY=FR", "EXDATE;TZID=America/Chicago:20261204T090000"] });

        Assert.Equal(["RRULE:FREQ=WEEKLY;BYDAY=FR", "EXDATE;TZID=America/Chicago:20261204T090000"], read.Master!.Recurrence);
    }

    [Theory]
    [InlineData("SUMMARY:not a rule")]
    [InlineData("RRULE:FREQ=DAILY\r\nATTENDEE:mailto:someone@example.com")]
    public void Refuses_a_repeat_line_that_is_anything_else(string line)
    {
        Assert.ThrowsAny<Exception>(() => EventWriter.Create(Event(At(27, 9, 0)) with { Recurrence = [line] }, Now));
    }

    [Fact]
    public void Writes_titles_and_notes_that_read_back_the_same()
    {
        var read = RoundTrip(Event(At(27, 9, 0)) with { Summary = "Call: Bob, Alice; and \\ co", Description = "First\nSecond\r\nThird" });

        Assert.Equal("Call: Bob, Alice; and \\ co", read.Master!.Summary);
        Assert.Equal("First\nSecond\nThird", read.Master.Description);
    }

    [Fact]
    public void Stamps_a_new_event()
    {
        var text = EventWriter.Create(Event(At(27, 9, 0)), Now);

        Assert.Contains("DTSTAMP:20261126T120000Z\r\n", text, StringComparison.Ordinal);
        Assert.Contains("SEQUENCE:0\r\n", text, StringComparison.Ordinal);
        Assert.Contains("PRODID:" + EventWriter.ProductId + "\r\n", text, StringComparison.Ordinal);
        Assert.Equal(Now, EventReader.Read(text).Master!.LastModified);
    }

    // An event made in another app, with an alarm, an attendee, an app's own property and one moved occurrence.
    private static readonly string Elsewhere = string.Join("\r\n",
        "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Example//Other app//EN",
        "BEGIN:VTIMEZONE", "TZID:Central Standard Time",
        "BEGIN:STANDARD", "DTSTART:16010101T020000", "TZOFFSETFROM:-0500", "TZOFFSETTO:-0600", "RRULE:FREQ=YEARLY;BYDAY=1SU;BYMONTH=11", "END:STANDARD",
        "BEGIN:DAYLIGHT", "DTSTART:16010101T020000", "TZOFFSETFROM:-0600", "TZOFFSETTO:-0500", "RRULE:FREQ=YEARLY;BYDAY=2SU;BYMONTH=3", "END:DAYLIGHT",
        "END:VTIMEZONE",
        "BEGIN:VEVENT", "UID:abc@example.com", "DTSTAMP:20261101T000000Z", "SEQUENCE:4",
        "DTSTART;TZID=Central Standard Time:20261127T090000", "DURATION:PT1H", "SUMMARY:Planning",
        "RRULE:FREQ=WEEKLY", "ATTENDEE;CN=Jane:mailto:jane@example.com", "X-OTHER-APP-COLOUR:teal",
        "BEGIN:VALARM", "ACTION:DISPLAY", "TRIGGER:-PT10M", "DESCRIPTION:Reminder", "END:VALARM",
        "END:VEVENT",
        "BEGIN:VEVENT", "UID:abc@example.com", "DTSTAMP:20261101T000000Z",
        "RECURRENCE-ID;TZID=Central Standard Time:20261204T090000", "DTSTART;TZID=Central Standard Time:20261204T100000", "DURATION:PT1H", "SUMMARY:Planning",
        "END:VEVENT",
        "END:VCALENDAR") + "\r\n";

    [Fact]
    public void Editing_an_event_keeps_everything_PeckList_does_not_manage()
    {
        var read = EventReader.Read(Elsewhere).Master!;

        var written = EventWriter.Write(Elsewhere, read with { Summary = "Planning (moved)", Start = At(27, 10, 0), End = null }, Now);
        var root = CalText.Parse(written);
        var series = root.Components("VEVENT").First();

        Assert.Equal("Planning (moved)", series.Property("SUMMARY")!.Value);
        Assert.Equal("mailto:jane@example.com", series.Property("ATTENDEE")!.Value);
        Assert.Equal("teal", series.Property("X-OTHER-APP-COLOUR")!.Value);
        Assert.Equal("-PT10M", series.Components("VALARM").Single().Property("TRIGGER")!.Value);
        Assert.Equal(2, root.Components("VEVENT").Count());
        Assert.Equal("5", series.Property("SEQUENCE")!.Value);
        Assert.Null(series.Property("DURATION"));
        // The moved occurrence still uses the Outlook zone, so its VTIMEZONE stays; the series now
        // uses Chicago by name, which gets its own.
        Assert.Equal(["America/Chicago", "Central Standard Time"],
            root.Components("VTIMEZONE").Select(z => z.Property("TZID")!.Value).Order(StringComparer.Ordinal));
    }

    [Fact]
    public void Drops_a_VTIMEZONE_nothing_uses_any_more()
    {
        var calendar = EventReaderTests.Calendar(["BEGIN:VTIMEZONE", "TZID:Old", "BEGIN:STANDARD", "DTSTART:19700101T000000",
            "TZOFFSETFROM:+0100", "TZOFFSETTO:+0100", "END:STANDARD", "END:VTIMEZONE"], ["DTSTART;TZID=Old:20261127T090000"]);
        var read = EventReader.Read(calendar).Master!;

        var written = EventWriter.Write(calendar, read with { Start = EventTime.Day(new DateOnly(2026, 11, 27)), End = null }, Now);

        Assert.DoesNotContain("VTIMEZONE", written, StringComparison.Ordinal);
    }

    [Fact]
    public void Cancelling_and_uncancelling_sets_and_clears_the_status()
    {
        var cancelled = EventWriter.Create(Event(At(27, 9, 0)) with { Cancelled = true }, Now);
        Assert.True(EventReader.Read(cancelled).Master!.Cancelled);

        var restored = EventWriter.Write(cancelled, Event(At(27, 9, 0)), Now);
        Assert.False(EventReader.Read(restored).Master!.Cancelled);
    }
}
