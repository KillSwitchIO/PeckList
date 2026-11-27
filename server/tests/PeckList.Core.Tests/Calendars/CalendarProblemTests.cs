using PeckList.Core.Calendars;

namespace PeckList.Core.Tests.Calendars;

/// <summary>What a calendar problem puts on a log line (PL-134 fix 1, Security M2).</summary>
public sealed class CalendarProblemTests
{
    private static CalendarProblem Refused() => new(CalendarProblemKind.Refused, "calendar_refused", "the calendar could not take this event");

    [Fact]
    public void A_caldav_href_is_logged_as_its_last_segment_on_one_line_and_cut_short()
    {
        // As a hostile server (or an invite's UID) could send it: a line break, a forged line, a long tail.
        var href = "/dav/calendars/sam@example.com/personal/evil\r\nCalendar link X could not sync: forged" + new string('a', 3000) + ".ics";

        var line = Refused().At(CalendarCalls.Update, href).Describe();

        Assert.DoesNotContain('\n', line);
        Assert.DoesNotContain('\r', line);
        Assert.DoesNotContain("sam@example.com", line, StringComparison.Ordinal);
        Assert.StartsWith("calendar_refused (the calendar could not take this event) in update for event evilCalendar link X", line, StringComparison.Ordinal);
        Assert.Equal(CalendarProblem.MaxLoggedId, Refused().At(CalendarCalls.Update, href).EventId!.Length);
    }

    [Fact]
    public void A_google_event_id_is_logged_as_it_is()
    {
        Assert.Equal("calendar_refused (the calendar could not take this event) in delete for event 4b7cqmm2kp3s9e0d1hfj6",
            Refused().At(CalendarCalls.Delete, "4b7cqmm2kp3s9e0d1hfj6").Describe());
    }

    [Fact]
    public void The_first_call_named_stays_named()
    {
        var refresh = Refused().At(CalendarCalls.Refresh);

        Assert.Equal(CalendarCalls.Refresh, refresh.At(CalendarCalls.Update, "abc").Call);
        Assert.Equal("abc", refresh.At(CalendarCalls.Update, "abc").EventId);
    }
}
