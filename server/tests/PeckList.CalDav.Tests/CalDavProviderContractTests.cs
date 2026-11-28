using PeckList.CalDav.Dav;
using PeckList.CalDav.ICalendar;
using PeckList.Calendars.Testing;
using PeckList.Core.Calendars;

namespace PeckList.CalDav.Tests;

/// <summary>
/// The calendar adapter contract on the CalDAV adapter, against Radicale (spec: PL-134, CalDAV is
/// tested against a Radicale container). Each test gets a fresh account with one new calendar.
/// </summary>
public sealed class CalDavProviderContractTests(RadicaleServer radicale) : CalendarProviderContract
{
    private static readonly DateTimeOffset Now = new(2026, 11, 1, 12, 0, 0, TimeSpan.Zero);

    protected override async Task<CalendarTestTarget> TargetAsync(CancellationToken cancellation)
    {
        var provider = new CalDavCalendarProvider(CalDavCalendarProvider.CreateHttpClient(new CalDavNetworkPolicy(allowPrivateNetwork: true)), TimeProvider.System);
        var connection = new CalendarConnection(radicale.Url.ToString(), RadicaleServer.NewUser(), "app-password");
        var calendar = await provider.CreateCalendarAsync(connection, "Work", cancellation);
        // Another client on the same account, writing through CalDAV directly.
        var other = RadicaleServer.Client(connection.Username!);
        return new CalendarTestTarget(
            provider,
            connection,
            calendar.Id,
            // Shaped as Radicale's own, but never issued.
            RejectedSyncToken: "http://radicale.org/ns/sync/" + new string('0', 64),
            // Radicale runs without passwords here; the client tests cover 401.
            WrongPassword: null,
            SeedWithExtras: async (calendarId, data, token) =>
            {
                await other.CreateAsync(new Uri(calendarId), "seeded.ics", WithExtras(data), token);
                var listed = await provider.ChangesAsync(connection, calendarId, null, token);
                return Assert.Single(listed.Changed, e => e.Id == "seeded.ics");
            },
            HasExtras: remote =>
            {
                var vevent = CalText.Parse(remote.Raw!).Components("VEVENT").First(e => e.Property("RECURRENCE-ID") is null);
                return vevent.Property("LOCATION")?.Value == "Main Street 1" && vevent.Components("VALARM").Any();
            },
            SeedOverride: async (calendarId, seriesId, original, moved, token) =>
            {
                var href = new Uri(new Uri(calendarId), seriesId);
                var current = await other.GetOneAsync(href, token) ?? throw new InvalidOperationException("the series is not there");
                await other.UpdateAsync(href, current.ETag, WithOverride(current.Data, original, moved), token);
            });
    }

    [Fact]
    public async Task An_invitation_someone_else_organises_comes_back_foreign_and_an_own_event_does_not()
    {
        var cancellation = TestContext.Current.CancellationToken;
        var provider = new CalDavCalendarProvider(CalDavCalendarProvider.CreateHttpClient(new CalDavNetworkPolicy(allowPrivateNetwork: true)), TimeProvider.System);
        var connection = new CalendarConnection(radicale.Url.ToString(), RadicaleServer.NewUser(), "app-password");
        var calendar = await provider.CreateCalendarAsync(connection, "Work", cancellation);
        var other = RadicaleServer.Client(connection.Username!);
        static string Ics(string uid, params string[] extra) => string.Join("\r\n",
            ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Example//Test//EN", "BEGIN:VEVENT", "UID:" + uid, "DTSTAMP:20261120T100000Z",
                "DTSTART;VALUE=DATE:20261205", "SUMMARY:" + uid, .. extra, "END:VEVENT", "END:VCALENDAR"]) + "\r\n";
        await other.CreateAsync(new Uri(calendar.Id), "invite.ics", Ics("invite", "ORGANIZER;CN=Kim:mailto:kim@example.com", "ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:ben@example.com"), cancellation);
        await other.CreateAsync(new Uri(calendar.Id), "mine.ics", Ics("mine"), cancellation);

        var listed = (await provider.ChangesAsync(connection, calendar.Id, null, cancellation)).Changed;

        Assert.True(Assert.Single(listed, e => e.Id == "invite.ics").Foreign);
        Assert.False(Assert.Single(listed, e => e.Id == "mine.ics").Foreign);
    }

    // The event as another app writes it: with a location and an alarm, which the port doesn't map.
    private static string WithExtras(EventData data)
    {
        var root = CalText.Parse(EventWriter.Create(CalDavCalendarProvider.ToCalEvent("seeded@example.com", data, [], cancelled: false), Now));
        var vevent = root.Components("VEVENT").Single();
        vevent.Properties.Add(new CalProperty("LOCATION", "Main Street 1"));
        var alarm = new CalComponent("VALARM");
        alarm.Properties.Add(new CalProperty("ACTION", "DISPLAY"));
        alarm.Properties.Add(new CalProperty("TRIGGER", "-PT15M"));
        alarm.Properties.Add(new CalProperty("DESCRIPTION", "Reminder"));
        vevent.Children.Add(alarm);
        return CalText.Write(root);
    }

    // One occurrence moved, the way a calendar app does it: a second VEVENT with the series' UID and a RECURRENCE-ID.
    private static string WithOverride(string series, CalendarTime original, EventData moved)
    {
        var root = CalText.Parse(series);
        var uid = root.Components("VEVENT").First().Property("UID")!.Value;
        var vevent = new CalComponent("VEVENT");
        vevent.Properties.Add(new CalProperty("UID", uid));
        vevent.Properties.Add(new CalProperty("DTSTAMP", CalValues.FormatUtc(Now)));
        vevent.Properties.Add(EventWriter.TimeProperty("RECURRENCE-ID", CalDavCalendarProvider.FromTime(original)));
        vevent.Properties.Add(EventWriter.TimeProperty("DTSTART", CalDavCalendarProvider.FromTime(moved.Start)));
        vevent.Properties.Add(EventWriter.TimeProperty("DTEND", CalDavCalendarProvider.FromTime(moved.End!)));
        vevent.Properties.Add(new CalProperty("SUMMARY", CalText.Escape(moved.Summary)));
        root.Children.Add(vevent);
        return CalText.Write(root);
    }
}
