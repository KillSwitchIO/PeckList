using PeckList.CalDav.Dav;
using PeckList.CalDav.ICalendar;

namespace PeckList.CalDav.Tests;

/// <summary>The CalDAV client against a real server (Radicale).</summary>
public sealed class RadicaleTests(RadicaleServer radicale)
{
    private static CancellationToken Token => TestContext.Current.CancellationToken;
    private static readonly DateTimeOffset Now = new(2026, 11, 26, 12, 0, 0, TimeSpan.Zero);

    private static CalEvent Event(string uid, string summary, EventTime start, EventTime? end = null) =>
        new() { Uid = uid, Summary = summary, Start = start, End = end };

    private static EventTime Chicago(int month, int day, int hour, int minute = 0) =>
        new(new DateOnly(2026, month, day), new TimeOnly(hour, minute), "America/Chicago");

    private static async Task<DavEtag> PutAsync(CalDavClient client, DavCalendar calendar, CalEvent calEvent) =>
        await client.CreateAsync(calendar.Url, calEvent.Uid + ".ics", EventWriter.Create(calEvent, Now), Token);

    [Fact]
    public async Task Finds_the_principal_and_calendar_home_from_a_bare_server_address()
    {
        var user = RadicaleServer.NewUser();

        var account = await RadicaleServer.Client(user).DiscoverAsync(radicale.Url.ToString(), Token);

        Assert.Equal($"/{user}/", account.Principal.AbsolutePath);
        Assert.Equal($"/{user}/", account.Home.AbsolutePath);
    }

    [Fact]
    public async Task Finds_the_calendar_home_from_a_full_address_without_the_trailing_slash()
    {
        var user = RadicaleServer.NewUser();

        var account = await RadicaleServer.Client(user).DiscoverAsync(new Uri(radicale.Url, user).ToString(), Token);

        Assert.Equal($"/{user}/", account.Home.AbsolutePath);
    }

    [Fact]
    public async Task Refuses_a_server_on_a_private_address_unless_the_policy_allows_it()
    {
        var client = RadicaleServer.Client(RadicaleServer.NewUser(), allowPrivateNetwork: false);

        var refused = await Assert.ThrowsAsync<CalDavException>(() => client.DiscoverAsync(radicale.Url.ToString(), Token));

        Assert.Equal(CalDavFailure.Blocked, refused.Failure);
    }

    [Fact]
    public async Task Makes_a_PeckList_calendar_and_lists_it_with_its_sync_token()
    {
        var (client, account, made) = await radicale.NewCalendarAsync("PeckList");

        var calendars = await client.CalendarsAsync(account.Home, Token);

        var listed = Assert.Single(calendars);
        Assert.Equal(made.Url, listed.Url);
        Assert.Equal("PeckList", listed.Name);
        Assert.True(listed.CanWrite);
        Assert.NotNull(listed.SyncToken);
        Assert.NotNull(listed.CTag);
    }

    [Fact]
    public async Task Creates_an_event_and_reads_it_back_with_the_same_etag()
    {
        var (client, _, calendar) = await radicale.NewCalendarAsync();

        var created = await PutAsync(client, calendar, Event("one", "Dentist", Chicago(11, 27, 9)));
        var read = await client.GetOneAsync(created.Href, Token);

        Assert.NotNull(read);
        Assert.Equal(created.ETag, read.ETag);
        Assert.Equal("Dentist", EventReader.Read(read.Data).Master!.Summary);
    }

    [Fact]
    public async Task Will_not_create_over_an_event_that_is_already_there()
    {
        var (client, _, calendar) = await radicale.NewCalendarAsync();
        await PutAsync(client, calendar, Event("one", "First", Chicago(11, 27, 9)));

        var refused = await Assert.ThrowsAsync<CalDavException>(() => PutAsync(client, calendar, Event("one", "Second", Chicago(11, 27, 9))));

        Assert.Equal(CalDavFailure.Conflict, refused.Failure);
    }

    [Fact]
    public async Task Updates_only_while_the_etag_still_matches()
    {
        var (client, _, calendar) = await radicale.NewCalendarAsync();
        var created = await PutAsync(client, calendar, Event("one", "First", Chicago(11, 27, 9)));
        var original = (await client.GetOneAsync(created.Href, Token))!.Data;

        var newEtag = await client.UpdateAsync(created.Href, created.ETag,
            EventWriter.Write(original, Event("one", "Second", Chicago(11, 27, 10)), Now), Token);
        var stale = await Assert.ThrowsAsync<CalDavException>(() => client.UpdateAsync(created.Href, created.ETag,
            EventWriter.Write(original, Event("one", "Third", Chicago(11, 27, 11)), Now), Token));

        Assert.NotEqual(created.ETag, newEtag);
        Assert.Equal(CalDavFailure.Conflict, stale.Failure);
        Assert.Equal("Second", EventReader.Read((await client.GetOneAsync(created.Href, Token))!.Data).Master!.Summary);
    }

    [Fact]
    public async Task Deletes_only_while_the_etag_still_matches_and_counts_a_gone_event_as_deleted()
    {
        var (client, _, calendar) = await radicale.NewCalendarAsync();
        var created = await PutAsync(client, calendar, Event("one", "First", Chicago(11, 27, 9)));

        var stale = await Assert.ThrowsAsync<CalDavException>(() => client.DeleteAsync(created.Href, "\"not-the-etag\"", Token));
        await client.DeleteAsync(created.Href, created.ETag, Token);
        await client.DeleteAsync(created.Href, created.ETag, Token);

        Assert.Equal(CalDavFailure.Conflict, stale.Failure);
        Assert.Null(await client.GetOneAsync(created.Href, Token));
    }

    [Fact]
    public async Task Reports_what_changed_and_what_was_removed_since_a_sync_token()
    {
        var (client, _, calendar) = await radicale.NewCalendarAsync();
        var kept = await PutAsync(client, calendar, Event("kept", "Kept", Chicago(11, 27, 9)));
        var edited = await PutAsync(client, calendar, Event("edited", "Edited", Chicago(11, 28, 9)));
        var removed = await PutAsync(client, calendar, Event("removed", "Removed", Chicago(11, 29, 9)));

        var first = await client.ChangesAsync(calendar.Url, null, Token);
        var newEtag = await client.UpdateAsync(edited.Href, edited.ETag, EventWriter.Create(Event("edited", "Edited again", Chicago(11, 28, 10)), Now), Token);
        await client.DeleteAsync(removed.Href, removed.ETag, Token);
        var added = await PutAsync(client, calendar, Event("added", "Added", Chicago(11, 30, 9)));
        var second = await client.ChangesAsync(calendar.Url, first.Token, Token);

        Assert.Equal(new[] { kept.Href, edited.Href, removed.Href }.OrderBy(h => h.ToString()), first.Changed.Select(c => c.Href).OrderBy(h => h.ToString()));
        Assert.Empty(first.Removed);
        Assert.Equal(new[] { new DavEtag(edited.Href, newEtag), added }.OrderBy(e => e.Href.ToString()), second.Changed.OrderBy(e => e.Href.ToString()));
        Assert.Equal([removed.Href], second.Removed);
        Assert.NotEqual(first.Token, second.Token);
        Assert.Empty((await client.ChangesAsync(calendar.Url, second.Token, Token)).Changed);
    }

    [Fact]
    public async Task Says_to_start_over_when_the_server_no_longer_takes_the_sync_token()
    {
        var (client, _, calendar) = await radicale.NewCalendarAsync();

        var refused = await Assert.ThrowsAsync<CalDavException>(() => client.ChangesAsync(calendar.Url, "http://radicale.org/ns/sync/unknown", Token));

        Assert.Equal(CalDavFailure.SyncTokenInvalid, refused.Failure);
    }

    [Fact]
    public async Task Fetches_several_events_at_once_and_skips_ones_that_are_gone()
    {
        var (client, _, calendar) = await radicale.NewCalendarAsync();
        var a = await PutAsync(client, calendar, Event("a", "A", Chicago(11, 27, 9)));
        var b = await PutAsync(client, calendar, Event("b", "B", Chicago(11, 28, 9)));

        var objects = await client.GetAsync(calendar.Url, [a.Href, b.Href, new Uri(calendar.Url, "missing.ics")], Token);

        Assert.Equal(["A", "B"], objects.Select(o => EventReader.Read(o.Data).Master!.Summary).Order());
        Assert.Equal([a.ETag, b.ETag], objects.OrderBy(o => o.Href.ToString()).Select(o => o.ETag));
    }

    [Fact]
    public async Task Lists_the_events_in_a_time_range_including_a_series_that_started_before_it()
    {
        var (client, _, calendar) = await radicale.NewCalendarAsync();
        await PutAsync(client, calendar, Event("inside", "Inside", Chicago(12, 2, 9)));
        await PutAsync(client, calendar, Event("outside", "Outside", Chicago(12, 20, 9)));
        await PutAsync(client, calendar, Event("weekly", "Weekly", Chicago(11, 2, 9)) with { Recurrence = ["RRULE:FREQ=WEEKLY"] });
        await PutAsync(client, calendar, Event("allday", "All day", EventTime.Day(new DateOnly(2026, 12, 3))));

        var objects = await client.RangeAsync(calendar.Url, new DateTimeOffset(2026, 12, 1, 0, 0, 0, TimeSpan.Zero),
            new DateTimeOffset(2026, 12, 8, 0, 0, 0, TimeSpan.Zero), Token);

        Assert.Equal(["All day", "Inside", "Weekly"], objects.Select(o => EventReader.Read(o.Data).Master!.Summary).Order(StringComparer.Ordinal));
    }

    [Fact]
    public async Task Lists_every_events_etag_for_servers_without_sync_tokens()
    {
        var (client, _, calendar) = await radicale.NewCalendarAsync();
        var a = await PutAsync(client, calendar, Event("a", "A", Chicago(11, 27, 9)));
        var b = await PutAsync(client, calendar, Event("b", "B", Chicago(11, 28, 9)));

        var etags = await client.EtagsAsync(calendar.Url, Token);

        Assert.Equal(new[] { a, b }.OrderBy(e => e.Href.ToString()), etags.OrderBy(e => e.Href.ToString()));
    }

    [Fact]
    public async Task Events_keep_their_times_and_repeat_rule_through_the_server()
    {
        var (client, _, calendar) = await radicale.NewCalendarAsync();
        var timed = Event("timed", "Timed", Chicago(11, 27, 23, 45)) with { Description = "Notes, with commas; and\nlines" };
        var allDay = Event("allday", "All day", EventTime.Day(new DateOnly(2026, 11, 27)), EventTime.Day(new DateOnly(2026, 11, 30)));
        var series = Event("series", "Series", new EventTime(new DateOnly(2026, 11, 27), new TimeOnly(9, 0), "Europe/Berlin"))
            with { Recurrence = ["RRULE:FREQ=WEEKLY;BYDAY=FR;UNTIL=20270301T000000Z", "EXDATE;TZID=Europe/Berlin:20261204T090000"] };
        var utc = Event("utc", "UTC", new EventTime(new DateOnly(2026, 11, 27), new TimeOnly(15, 0), EventTime.Utc));
        var hrefs = new List<Uri>();
        foreach (var calEvent in new[] { timed, allDay, series, utc }) hrefs.Add((await PutAsync(client, calendar, calEvent)).Href);

        var read = (await client.GetAsync(calendar.Url, hrefs, Token)).Select(o => EventReader.Read(o.Data).Master!).ToDictionary(e => e.Uid);

        Assert.Equal(Chicago(11, 27, 23, 45), read["timed"].Start);
        Assert.Equal(Chicago(11, 28, 0, 15), read["timed"].End);
        Assert.Equal("Notes, with commas; and\nlines", read["timed"].Description);
        Assert.Equal(allDay.Start, read["allday"].Start);
        Assert.Equal(allDay.End, read["allday"].End);
        Assert.Equal(series.Start, read["series"].Start);
        // Servers may reorder the lines (Radicale puts EXDATE first); their order means nothing.
        Assert.Equal(series.Recurrence.Order(StringComparer.Ordinal), read["series"].Recurrence.Order(StringComparer.Ordinal));
        Assert.Equal(utc.Start, read["utc"].Start);
    }
}
