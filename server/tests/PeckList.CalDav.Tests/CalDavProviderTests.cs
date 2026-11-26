using System.Net;
using PeckList.CalDav.Dav;
using PeckList.CalDav.ICalendar;
using PeckList.Core.Calendars;
using static PeckList.CalDav.Tests.CalDavClientTests;

namespace PeckList.CalDav.Tests;

/// <summary>The adapter's own rules beyond the contract, against a scripted fake server.</summary>
public sealed class CalDavProviderTests
{
    private static CancellationToken Token => TestContext.Current.CancellationToken;
    private const string Calendar = "https://dav.example.com/cal/";
    private static readonly CalendarConnection Connection = new("https://dav.example.com/", "ben", "app-password");

    private static CalDavCalendarProvider Provider(FakeServer server) => new(new HttpClient(server), TimeProvider.System);

    private static readonly string Event = string.Join("\r\n", "BEGIN:VCALENDAR", "VERSION:2.0", "BEGIN:VEVENT", "UID:a@example.com",
        "DTSTAMP:20261120T100000Z", "DTSTART;VALUE=DATE:20261127", "SUMMARY:Bins out", "END:VEVENT", "END:VCALENDAR") + "\r\n";

    private static HttpResponseMessage CalendarWithCTag(string ctag) => Multistatus(
        $"<d:response><d:href>/cal/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/><c:calendar/></d:resourcetype>" +
        $"<cs:getctag xmlns:cs=\"http://calendarserver.org/ns/\">{ctag}</cs:getctag></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>");

    private static FakeServer WithoutSyncTokens(Func<string> ctag) => new FakeServer()
        .On("REPORT", Calendar, _ => new HttpResponseMessage(HttpStatusCode.NotImplemented), bodyHas: "sync-collection")
        .On("PROPFIND", "https://dav.example.com/", _ => CalendarWithCTag(ctag()))
        .On("REPORT", Calendar, _ => Multistatus(
            "<d:response><d:href>/cal/a.ics</d:href><d:propstat><d:prop><d:getetag>\"1\"</d:getetag></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>"),
            bodyHas: "calendar-query")
        .On("REPORT", Calendar, _ => Multistatus(
            $"<d:response><d:href>/cal/a.ics</d:href><d:propstat><d:prop><d:getetag>\"1\"</d:getetag><c:calendar-data>{WebUtility.HtmlEncode(Event)}</c:calendar-data></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>"),
            bodyHas: "calendar-multiget");

    [Fact]
    public async Task Falls_back_to_the_ctag_on_a_server_without_sync_tokens()
    {
        var ctag = "c1";
        var provider = Provider(WithoutSyncTokens(() => ctag));

        var full = await provider.ChangesAsync(Connection, Calendar, null, Token);
        var unchanged = await provider.ChangesAsync(Connection, Calendar, full.SyncToken, Token);
        ctag = "c2";
        var changed = await provider.ChangesAsync(Connection, Calendar, unchanged.SyncToken, Token);

        Assert.True(full.Reset);
        Assert.Equal("Bins out", Assert.Single(full.Changed).Data.Summary);
        Assert.Equal(CalDavCalendarProvider.CTagTokenPrefix + "c1", full.SyncToken);
        Assert.False(unchanged.Reset);
        Assert.Empty(unchanged.Changed);
        Assert.True(changed.Reset);
        Assert.Equal(CalDavCalendarProvider.CTagTokenPrefix + "c2", changed.SyncToken);
    }

    [Theory]
    [InlineData("../other/x.ics")]
    [InlineData("%2F..%2Fother%2Fx.ics")]
    [InlineData("x.ics?query")]
    [InlineData("..")]
    public async Task Refuses_an_event_id_that_points_outside_the_calendar_before_sending_anything(string eventId)
    {
        var server = new FakeServer();

        var refused = await Assert.ThrowsAsync<CalendarProblem>(() => Provider(server).DeleteEventAsync(Connection, Calendar, eventId, "\"1\"", Token));

        Assert.Equal(CalendarProblemKind.NotFound, refused.Kind);
        Assert.Empty(server.Requests);
    }

    [Fact]
    public async Task Refuses_to_edit_a_changed_occurrence_on_its_own()
    {
        var occurrence = new RemoteEvent("a.ics#20261127", "\"1\"", new EventData("x", "", CalendarTime.Date("2026-11-27"), null), DateTimeOffset.UnixEpoch, SeriesId: "a.ics");

        var refused = await Assert.ThrowsAsync<CalendarProblem>(() =>
            Provider(new FakeServer()).UpdateEventAsync(Connection, Calendar, occurrence, occurrence.Data, Token));

        Assert.Equal(CalendarProblemKind.Refused, refused.Kind);
    }

    [Theory]
    [InlineData("01JDZK6Q1Y9V3W5T7R8P0N2M4K/01JDZK7A2B3C4D5E6F7G8H9J0K", true)]
    [InlineData("../../etc/passwd", false)]
    [InlineData("only-one-part", false)]
    [InlineData("a/b/c", false)]
    [InlineData("has space/id", false)]
    public void Reads_the_marker_only_when_it_is_two_ids(string text, bool read)
    {
        var data = CalDavCalendarProvider.ToData(new CalEvent { Uid = "u", Start = EventTime.Day(new DateOnly(2026, 11, 27)), PeckListTask = text });

        Assert.Equal(read, data.Marker is not null);
    }

    [Theory]
    [InlineData(CalDavFailure.Unauthorized, null, CalendarProblemKind.Auth, "calendar_auth_failed")]
    [InlineData(CalDavFailure.Conflict, 412, CalendarProblemKind.Conflict, "calendar_conflict")]
    [InlineData(CalDavFailure.SyncTokenInvalid, 403, CalendarProblemKind.SyncTokenExpired, "calendar_sync_token_expired")]
    [InlineData(CalDavFailure.RetryLater, 429, CalendarProblemKind.RateLimited, "calendar_rate_limited")]
    [InlineData(CalDavFailure.RetryLater, 503, CalendarProblemKind.Unavailable, "calendar_unavailable")]
    [InlineData(CalDavFailure.Unavailable, null, CalendarProblemKind.Unavailable, "calendar_unreachable")]
    [InlineData(CalDavFailure.Blocked, null, CalendarProblemKind.Refused, "calendar_address_blocked")]
    [InlineData(CalDavFailure.NotCalDav, null, CalendarProblemKind.Refused, "calendar_not_caldav")]
    public void Turns_each_failure_into_the_ports_problem(CalDavFailure failure, int? status, CalendarProblemKind kind, string code)
    {
        var problem = CalDavCalendarProvider.Problem(new CalDavException(failure, "dav.example.com: it failed") { Status = status, RetryAfter = TimeSpan.FromMinutes(2) });

        Assert.Equal(kind, problem.Kind);
        Assert.Equal(code, problem.Code);
        if (kind is CalendarProblemKind.RateLimited) Assert.Equal(TimeSpan.FromMinutes(2), problem.RetryAfter);
    }

    private static string Object(params string[] lines) =>
        string.Join("\r\n", ["BEGIN:VCALENDAR", "VERSION:2.0", .. lines, "END:VCALENDAR"]) + "\r\n";

    private static string Zone(string rule) => string.Join("\r\n", "BEGIN:VTIMEZONE", "TZID:Custom Zone", "BEGIN:STANDARD",
        "DTSTART:16010101T000000", "TZOFFSETFROM:+0100", "TZOFFSETTO:+0100", rule, "END:STANDARD", "END:VTIMEZONE");

    private static string Vevent(params string[] lines) =>
        string.Join("\r\n", ["BEGIN:VEVENT", "UID:bad@example.com", "DTSTAMP:20261120T100000Z", "SUMMARY:Bad", .. lines, "END:VEVENT"]);

    public static TheoryData<string, bool> HostileEvents => new()
    {
        { Object(Vevent("DTSTART:20261127T090000Z", "DURATION:P99999999999D")), false },
        { Object(Vevent("DTSTART:99991231T230000Z", "DURATION:PT2H")), false },
        { Object(Vevent("DTSTART;VALUE=DATE:99991231", "DURATION:P2D")), false },
        { Object(Zone("RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=XSU"), Vevent("DTSTART;TZID=Custom Zone:20261127T090000")), true },
        { Object(Zone("RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=0SU"), Vevent("DTSTART;TZID=Custom Zone:20261127T090000")), true },
        { Object(Zone("RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU"), Vevent("DTSTART;TZID=Custom Zone:00010101T000000")), false },
    };

    [Theory]
    [MemberData(nameof(HostileEvents))]
    public async Task Leaves_out_an_event_it_cannot_read_and_syncs_the_rest(string bad, bool readable)
    {
        static string Data(string href, string text) =>
            $"<d:response><d:href>{href}</d:href><d:propstat><d:prop><d:getetag>\"1\"</d:getetag><c:calendar-data>{WebUtility.HtmlEncode(text)}</c:calendar-data></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>";
        var server = new FakeServer()
            .On("REPORT", Calendar, _ => Multistatus(
                "<d:response><d:href>/cal/a.ics</d:href><d:propstat><d:prop><d:getetag>\"1\"</d:getetag></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>" +
                "<d:response><d:href>/cal/bad.ics</d:href><d:propstat><d:prop><d:getetag>\"1\"</d:getetag></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>" +
                "<d:sync-token>t1</d:sync-token>"), bodyHas: "sync-collection")
            .On("REPORT", Calendar, _ => Multistatus(Data("/cal/a.ics", Event) + Data("/cal/bad.ics", bad)), bodyHas: "calendar-multiget");

        var changes = await Provider(server).ChangesAsync(Connection, Calendar, null, Token);

        Assert.Contains(changes.Changed, e => e.Id == "a.ics" && e.Data.Summary == "Bins out");
        // A broken zone rule falls back to the zone's other offsets; a time off the calendar can't be read at all.
        Assert.Equal(readable, changes.Changed.Any(e => e.Id == "bad.ics"));
    }

    [Fact]
    public async Task Refuses_a_repeat_rule_with_a_line_break_before_sending_anything()
    {
        var server = new FakeServer();
        var data = new EventData("x", "", CalendarTime.Date("2026-11-27"), null, RRule: "FREQ=DAILY\rX-INJECTED:y");

        var refused = await Assert.ThrowsAsync<CalendarProblem>(() => Provider(server).CreateEventAsync(Connection, Calendar, data, Token));

        Assert.Equal(CalendarProblemKind.Refused, refused.Kind);
        Assert.Empty(server.Requests);
    }

    [Fact]
    public void Writes_times_with_seconds_only_when_they_are_not_zero()
    {
        Assert.Equal(CalendarTime.Local("2026-11-27T09:00", "Europe/Berlin"),
            CalDavCalendarProvider.ToTime(new EventTime(new DateOnly(2026, 11, 27), new TimeOnly(9, 0), "Europe/Berlin")));
        Assert.Equal(CalendarTime.Local("2026-11-27T09:00:30", null),
            CalDavCalendarProvider.ToTime(new EventTime(new DateOnly(2026, 11, 27), new TimeOnly(9, 0, 30))));
        Assert.Equal(CalendarTime.Date("2026-11-27"), CalDavCalendarProvider.ToTime(EventTime.Day(new DateOnly(2026, 11, 27))));
    }
}
