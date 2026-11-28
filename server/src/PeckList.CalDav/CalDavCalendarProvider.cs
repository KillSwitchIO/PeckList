using System.Globalization;
using System.Text.RegularExpressions;
using PeckList.CalDav.Dav;
using PeckList.CalDav.ICalendar;
using PeckList.Core.Calendars;

namespace PeckList.CalDav;

/// <summary>
/// The CalDAV calendar adapter (spec: PL-134 decision 4): one connector for iCloud (app-specific
/// password), Fastmail, Nextcloud and other CalDAV servers, behind the calendar port.
/// </summary>
/// <remarks>
/// <para>
/// Ids: a calendar's id is its collection's address; an event's is its resource's name in the
/// calendar (<c>9f2c.ics</c>), and a changed occurrence's is that name, <c>#</c>, and its
/// RECURRENCE-ID value (<c>9f2c.ics#20261109T080000</c>). An event and its changed occurrences share
/// one resource, so they share an etag.
/// </para>
/// <para>
/// Sync tokens are the server's own (RFC 6578). A server without them gets a token made from its
/// ctag instead: unchanged means nothing changed, changed means a full listing.
/// </para>
/// <para>
/// <see cref="RemoteEvent.Raw"/> is the whole resource, so an update edits the event in place and
/// keeps what the port doesn't map: alarms, attendees, location, RDATEs, changed occurrences.
/// </para>
/// </remarks>
public sealed partial class CalDavCalendarProvider(HttpClient http, TimeProvider time) : ICalendarProvider
{
    /// <summary>The prefix of the tokens this adapter makes from a ctag, for servers without sync tokens.</summary>
    public const string CTagTokenPrefix = "pecklist-ctag:";

    /// <summary>An HTTP client for this adapter: through the network policy's handler, with a time limit per request.</summary>
    public static HttpClient CreateHttpClient(CalDavNetworkPolicy policy) =>
        new(policy.CreateHandler()) { Timeout = TimeSpan.FromSeconds(60) };

    /// <inheritdoc />
    public string Kind => "caldav";

    /// <inheritdoc />
    public CalendarCapabilities Capabilities { get; } = new(Push: false, CreateCalendar: true, SeriesListsOverrides: true);

    /// <inheritdoc />
    public Task<IReadOnlyList<RemoteCalendar>> CalendarsAsync(CalendarConnection connection, CancellationToken cancellation) =>
        Guard(async () =>
        {
            var client = Client(connection);
            var account = await client.DiscoverAsync(connection.ServerUrl, cancellation);
            var calendars = await client.CalendarsAsync(account.Home, cancellation);
            return (IReadOnlyList<RemoteCalendar>)calendars.Select(Calendar).ToList();
        });

    /// <inheritdoc />
    public Task<RemoteCalendar> CreateCalendarAsync(CalendarConnection connection, string name, CancellationToken cancellation) =>
        Guard(async () =>
        {
            var client = Client(connection);
            var account = await client.DiscoverAsync(connection.ServerUrl, cancellation);
            return Calendar(await client.MakeCalendarAsync(account.Home, name, cancellation));
        });

    /// <inheritdoc />
    public Task<RemoteChanges> ChangesAsync(CalendarConnection connection, string calendarId, string? syncToken, CancellationToken cancellation) =>
        Guard(async () =>
        {
            var client = Client(connection);
            var calendar = CalendarUrl(calendarId);
            if (syncToken is not null && syncToken.StartsWith(CTagTokenPrefix, StringComparison.Ordinal))
                return await CTagChangesAsync(client, connection, calendar, syncToken[CTagTokenPrefix.Length..], cancellation);
            DavChanges changes;
            try
            {
                changes = await client.ChangesAsync(calendar, syncToken, cancellation);
            }
            catch (CalDavException e) when (syncToken is null && e.Failure is CalDavFailure.Rejected or CalDavFailure.Forbidden)
            {
                // No sync-collection on this server: list everything, and remember its ctag.
                return await CTagChangesAsync(client, connection, calendar, null, cancellation);
            }
            var objects = await client.GetAsync(calendar, changes.Changed.Select(c => c.Href).ToList(), cancellation);
            var own = await OwnAddressesAsync(client, connection, objects, cancellation);
            var events = objects.SelectMany(o => Events(calendar, o, own)).ToList();
            // A resource changed and gone again before it was fetched counts as removed.
            var fetched = objects.Select(o => o.Href).ToHashSet();
            var removed = changes.Removed.Concat(changes.Changed.Select(c => c.Href).Where(h => !fetched.Contains(h)))
                .Select(h => EventId(calendar, h)).OfType<string>().Distinct(StringComparer.Ordinal).ToList();
            return new RemoteChanges(events, syncToken is null ? [] : removed, changes.Token, Reset: syncToken is null);
        });

    /// <inheritdoc />
    public Task<RemoteEvent> CreateEventAsync(CalendarConnection connection, string calendarId, EventData data, CancellationToken cancellation) =>
        Guard(async () =>
        {
            var client = Client(connection);
            var calendar = CalendarUrl(calendarId);
            var uid = Guid.NewGuid().ToString("N") + "@pecklist";
            var name = Guid.NewGuid().ToString("N") + ".ics";
            var now = time.GetUtcNow();
            var text = EventWriter.Create(ToCalEvent(uid, data, [], cancelled: false), now);
            var created = await client.CreateAsync(calendar, name, text, cancellation);
            return Events(calendar, new DavObject(created.Href, created.ETag, text)).First();
        });

    /// <inheritdoc />
    public Task<RemoteEvent> UpdateEventAsync(CalendarConnection connection, string calendarId, RemoteEvent basis, EventData data, CancellationToken cancellation) =>
        Guard(async () =>
        {
            if (basis.SeriesId is not null || basis.Id.Contains('#', StringComparison.Ordinal))
                throw new CalendarProblem(CalendarProblemKind.Refused, "calendar_occurrence_read_only", "a changed occurrence of a repeating event can't be edited here");
            var client = Client(connection);
            var calendar = CalendarUrl(calendarId);
            var href = ResourceUrl(calendar, basis.Id);
            var raw = basis.Raw;
            if (raw is null)
            {
                // No copy kept: read it, and treat a newer version as the conflict it is.
                var current = await client.GetOneAsync(href, cancellation)
                    ?? throw new CalendarProblem(CalendarProblemKind.NotFound, "calendar_event_not_found", "the event is gone");
                if (CalDavClient.ETag(current.ETag) != CalDavClient.ETag(basis.Etag))
                    throw new CalendarProblem(CalendarProblemKind.Conflict, "calendar_conflict", "the event changed on the calendar");
                raw = current.Data;
            }
            var master = Read(raw).Master ?? throw new CalendarProblem(CalendarProblemKind.Refused, "calendar_not_an_event", "the resource holds no event");
            string text;
            if (data.Marker is { } marker && CalendarJson.Same(data with { Marker = basis.Data.Marker }, basis.Data))
            {
                // Only the marker changes: the event's own lines stay as the calendar wrote them.
                text = EventWriter.Mark(raw, marker.Instance + "/" + marker.TaskId, time.GetUtcNow())
                    ?? throw new CalendarProblem(CalendarProblemKind.Refused, "calendar_not_an_event", "the resource holds no event");
            }
            else
            {
                // RDATE and EXRULE aren't mapped: keep them from the event as it was.
                var kept = master.Recurrence.Where(l => !l.StartsWith("RRULE", StringComparison.OrdinalIgnoreCase) && !l.StartsWith("EXDATE", StringComparison.OrdinalIgnoreCase)).ToList();
                text = EventWriter.Write(raw, ToCalEvent(master.Uid, data, kept, master.Cancelled), time.GetUtcNow());
            }
            var etag = await client.UpdateAsync(href, basis.Etag, text, cancellation);
            return Events(calendar, new DavObject(href, etag, text)).First(e => e.SeriesId is null);
        });

    /// <inheritdoc />
    public Task DeleteEventAsync(CalendarConnection connection, string calendarId, string eventId, string etag, CancellationToken cancellation) =>
        Guard(async () =>
        {
            if (eventId.Contains('#', StringComparison.Ordinal))
                throw new CalendarProblem(CalendarProblemKind.Refused, "calendar_occurrence_read_only", "a changed occurrence of a repeating event can't be deleted here");
            var client = Client(connection);
            var href = ResourceUrl(CalendarUrl(calendarId), eventId);
            try
            {
                await client.DeleteAsync(href, etag, cancellation);
            }
            catch (CalDavException e) when (e.Failure == CalDavFailure.Conflict)
            {
                // Some servers answer If-Match on a resource that is gone with 412: gone is done.
                if (await client.GetOneAsync(href, cancellation) is not null) throw;
            }
            return true;
        });

    /// <inheritdoc />
    public Task<PushChannel?> WatchAsync(CalendarConnection connection, string calendarId, Uri callback, string channelToken, CancellationToken cancellation) =>
        Task.FromResult<PushChannel?>(null);

    /// <inheritdoc />
    public Task StopWatchAsync(CalendarConnection connection, PushChannel channel, CancellationToken cancellation) => Task.CompletedTask;

    private async Task<RemoteChanges> CTagChangesAsync(CalDavClient client, CalendarConnection connection, Uri calendar, string? known, CancellationToken cancellation)
    {
        var account = new Uri(calendar, "..");
        var listed = (await client.CalendarsAsync(account, cancellation)).FirstOrDefault(c => c.Url == calendar);
        var ctag = listed?.CTag;
        if (known is not null && ctag is not null && ctag == known) return new RemoteChanges([], [], CTagTokenPrefix + ctag, Reset: false);
        var etags = await client.EtagsAsync(calendar, cancellation);
        var objects = await client.GetAsync(calendar, etags.Select(e => e.Href).ToList(), cancellation);
        var own = await OwnAddressesAsync(client, connection, objects, cancellation);
        return new RemoteChanges(objects.SelectMany(o => Events(calendar, o, own)).ToList(), [], ctag is null ? null : CTagTokenPrefix + ctag, Reset: true);
    }

    /// <summary>
    /// Who the account is as an ORGANIZER, asked only when a listed event names one: the principal's
    /// calendar-user-address-set, and the username when it is an address. An event whose ORGANIZER is
    /// none of these is an invitation, never imported (spec: PL-134, decision 8). A server that won't
    /// say leaves the username alone; null when no event names an organizer.
    /// </summary>
    private static async Task<IReadOnlySet<string>?> OwnAddressesAsync(CalDavClient client, CalendarConnection connection, IReadOnlyList<DavObject> objects,
        CancellationToken cancellation)
    {
        if (!objects.Any(o => o.Data.Contains("ORGANIZER", StringComparison.OrdinalIgnoreCase))) return null;
        var own = new HashSet<string>(StringComparer.Ordinal);
        if (EventReader.Address(connection.Username) is { } username && username.Contains('@', StringComparison.Ordinal)) own.Add(username);
        try
        {
            var account = await client.DiscoverAsync(connection.ServerUrl, cancellation);
            foreach (var address in account.Addresses ?? []) if (EventReader.Address(address) is { } found) own.Add(found);
        }
        catch (CalDavException)
        {
            // Discovery worked when the account was connected; if it doesn't now, the username has to do.
        }
        return own;
    }

    private CalDavClient Client(CalendarConnection connection) =>
        new(http, new CalDavCredentials(connection.Username ?? "", connection.Secret));

    private static RemoteCalendar Calendar(DavCalendar calendar) =>
        new(calendar.Url.ToString(), calendar.Name ?? Uri.UnescapeDataString(calendar.Url.Segments[^1].TrimEnd('/')), Color(calendar.Color), !calendar.CanWrite, calendar.TimeZone);

    // #RRGGBB, from Apple's #RRGGBB or #RRGGBBAA; anything else is dropped.
    private static string? Color(string? color) =>
        color is not null && ColorPattern().Match(color.Trim()) is { Success: true } match ? "#" + match.Groups[1].Value.ToUpperInvariant() : null;

    private static Uri CalendarUrl(string calendarId)
    {
        if (!Uri.TryCreate(calendarId, UriKind.Absolute, out var url) || (url.Scheme != Uri.UriSchemeHttps && url.Scheme != Uri.UriSchemeHttp))
            throw new CalendarProblem(CalendarProblemKind.NotFound, "calendar_not_found", "not a CalDAV calendar id");
        return url.AbsolutePath.EndsWith('/') ? url : new UriBuilder(url) { Path = url.AbsolutePath + "/" }.Uri;
    }

    // An event id names a resource directly in the calendar, never a path out of it.
    private static Uri ResourceUrl(Uri calendar, string eventId)
    {
        var plain = Uri.UnescapeDataString(eventId);
        if (eventId.Length is 0 or > 512 || eventId.AsSpan().IndexOfAny("/\\?#") >= 0 || plain.AsSpan().IndexOfAny('/', '\\') >= 0 || plain is "." or "..")
            throw new CalendarProblem(CalendarProblemKind.NotFound, "calendar_event_not_found", "not an event id of this calendar");
        var url = new Uri(calendar, eventId);
        return url.AbsolutePath.StartsWith(calendar.AbsolutePath, StringComparison.Ordinal) && url.Host == calendar.Host
            ? url
            : throw new CalendarProblem(CalendarProblemKind.NotFound, "calendar_event_not_found", "not an event id of this calendar");
    }

    // The resource's name in the calendar, as the server spells it (escaped); null for anything not directly in it.
    private static string? EventId(Uri calendar, Uri href)
    {
        var path = href.GetComponents(UriComponents.Path | UriComponents.KeepDelimiter, UriFormat.UriEscaped);
        var parent = calendar.GetComponents(UriComponents.Path | UriComponents.KeepDelimiter, UriFormat.UriEscaped);
        if (!path.StartsWith(parent, StringComparison.Ordinal)) return null;
        var name = path[parent.Length..];
        return name.Length == 0 || name.Contains('/', StringComparison.Ordinal) ? null : name;
    }

    /// <param name="own">Who the account is as an ORGANIZER (<see cref="OwnAddressesAsync"/>); null when no event names one.</param>
    private static IReadOnlyList<RemoteEvent> Events(Uri calendar, DavObject resource, IReadOnlySet<string>? own = null)
    {
        if (EventId(calendar, resource.Href) is not { } id) return [];
        try
        {
            var read = Read(resource.Data);
            var events = new List<RemoteEvent>();
            if (read.Master is { } master) events.Add(Remote(id, resource, master, null, own));
            foreach (var moved in read.Overrides)
                events.Add(Remote(id + "#" + RecurrenceKey(moved.RecurrenceId!), resource, moved, read.Master is null ? null : id, own));
            return events;
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            // One event no reader could make sense of shouldn't stop the calendar syncing: whatever
            // reading it threw, only this resource is left out.
            return [];
        }
    }

    private static RemoteEvent Remote(string id, DavObject resource, CalEvent calEvent, string? seriesId, IReadOnlySet<string>? own) => new(
        id,
        resource.ETag,
        ToData(calEvent),
        calEvent.LastModified ?? DateTimeOffset.UnixEpoch,
        SeriesId: seriesId,
        OriginalStart: calEvent.RecurrenceId is { } rid ? ToTime(rid) : null,
        Cancelled: calEvent.Cancelled,
        Raw: resource.Data,
        Foreign: own is not null && calEvent.Organizer is { } organizer && !own.Contains(organizer));

    private static string RecurrenceKey(EventTime time) =>
        time.AllDay ? CalValues.FormatDate(time.Date) : CalValues.FormatDateTime(time.Local, time.TimeZone == EventTime.Utc);

    private static CalObject Read(string text)
    {
        try
        {
            return EventReader.Read(text);
        }
        catch (CalendarFormatException e)
        {
            throw new CalendarProblem(CalendarProblemKind.Refused, "calendar_bad_event", "the server sent an event that is not valid iCalendar", inner: e);
        }
    }

    /// <summary>The port's view of an event.</summary>
    internal static EventData ToData(CalEvent calEvent) => new(
        calEvent.Summary ?? "",
        calEvent.Description ?? "",
        ToTime(calEvent.Start),
        calEvent.End is { } end ? ToTime(end) : null,
        RRule: calEvent.Recurrence.Where(l => l.StartsWith("RRULE:", StringComparison.OrdinalIgnoreCase)).Select(l => l[6..]).FirstOrDefault(),
        ExDates: calEvent.ExDates.Select(ToTime).ToList(),
        Marker: Marker(calEvent.PeckListTask));

    /// <summary>The event to write for the port's data, with any repeat lines to keep from the event as it was.</summary>
    internal static CalEvent ToCalEvent(string uid, EventData data, IReadOnlyList<string> keptRecurrence, bool cancelled)
    {
        var recurrence = new List<string>();
        if (!string.IsNullOrWhiteSpace(data.RRule))
        {
            var rule = data.RRule.Trim();
            if (rule.StartsWith("RRULE:", StringComparison.OrdinalIgnoreCase)) rule = rule[6..];
            recurrence.Add("RRULE:" + rule);
        }
        foreach (var exDate in data.ExDates ?? []) recurrence.Add(CalText.ContentLine(EventWriter.TimeProperty("EXDATE", FromTime(exDate))));
        recurrence.AddRange(keptRecurrence);
        return new CalEvent
        {
            Uid = uid,
            Summary = data.Summary,
            Description = data.Description,
            Start = FromTime(data.Start),
            End = data.End is { } end ? FromTime(end) : null,
            Recurrence = recurrence,
            Cancelled = cancelled,
            PeckListTask = data.Marker is { } marker ? marker.Instance + "/" + marker.TaskId : null,
        };
    }

    /// <summary>A port time: <c>2026-11-03</c>, or <c>2026-11-03T09:00</c> with seconds only when they aren't zero.</summary>
    internal static CalendarTime ToTime(EventTime time) =>
        time.AllDay
            ? CalendarTime.Date(time.Date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture))
            : CalendarTime.Local(time.Local.ToString(time.Time!.Value.Second == 0 ? "yyyy-MM-dd'T'HH:mm" : "yyyy-MM-dd'T'HH:mm:ss", CultureInfo.InvariantCulture), time.TimeZone);

    internal static EventTime FromTime(CalendarTime time)
    {
        if (time.IsDate && DateOnly.TryParseExact(time.Value, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var day))
            return EventTime.Day(day);
        if (DateTime.TryParseExact(time.Value, ["yyyy-MM-dd'T'HH:mm", "yyyy-MM-dd'T'HH:mm:ss"], CultureInfo.InvariantCulture, DateTimeStyles.None, out var at))
            return EventTime.At(at, string.IsNullOrEmpty(time.TimeZone) ? null : time.TimeZone);
        // Not the value: problem messages reach the log and the person (Security, PL-134 fix 1).
        throw new ArgumentException("not a calendar time", nameof(time));
    }

    // X-PECKLIST-TASK is "<instance>/<task id>". It comes back from the calendar, so anything not
    // made of two ids is ignored rather than trusted.
    private static EventMarker? Marker(string? text)
    {
        if (text is null) return null;
        var parts = text.Trim().Split('/');
        return parts.Length == 2 && IdPattern().IsMatch(parts[0]) && IdPattern().IsMatch(parts[1]) ? new EventMarker(parts[0], parts[1]) : null;
    }

    // Every failure leaves as a CalendarProblem the engine can act on; the messages name the host at
    // most, never a password, a query or event content.
    private static async Task<T> Guard<T>(Func<Task<T>> call)
    {
        try
        {
            return await call();
        }
        catch (CalDavException e)
        {
            throw Problem(e);
        }
        catch (CalendarFormatException e)
        {
            throw new CalendarProblem(CalendarProblemKind.Refused, "calendar_bad_event", "the event is not valid iCalendar", inner: e);
        }
        catch (ArgumentException e)
        {
            // A fixed message: an argument exception can quote what the calendar server sent (a time
            // zone name, a duplicate key), and problem messages reach the log and the person.
            throw new CalendarProblem(CalendarProblemKind.Refused, "calendar_refused", "the calendar could not take this event", inner: e);
        }
        catch (Exception e) when (e is not CalendarProblem and not OperationCanceledException)
        {
            // Anything not foreseen still leaves as a problem the engine records and backs off from.
            throw new CalendarProblem(CalendarProblemKind.Refused, "calendar_failed", "the calendar could not be read", inner: e);
        }
    }

    private static async Task Guard(Func<Task<bool>> call) => await Guard<bool>(call);

    /// <summary>The port's problem for a CalDAV failure.</summary>
    internal static CalendarProblem Problem(CalDavException e) => e.Failure switch
    {
        CalDavFailure.Unauthorized => new(CalendarProblemKind.Auth, "calendar_auth_failed", e.Message, inner: e),
        CalDavFailure.Forbidden => new(CalendarProblemKind.Refused, "calendar_forbidden", e.Message, inner: e),
        CalDavFailure.NotFound => new(CalendarProblemKind.NotFound, "calendar_not_found", e.Message, inner: e),
        CalDavFailure.Conflict => new(CalendarProblemKind.Conflict, "calendar_conflict", e.Message, inner: e),
        CalDavFailure.SyncTokenInvalid => new(CalendarProblemKind.SyncTokenExpired, "calendar_sync_token_expired", e.Message, inner: e),
        CalDavFailure.RetryLater when e.Status == 429 => new(CalendarProblemKind.RateLimited, "calendar_rate_limited", e.Message, e.RetryAfter, e),
        CalDavFailure.RetryLater => new(CalendarProblemKind.Unavailable, "calendar_unavailable", e.Message, e.RetryAfter, e),
        CalDavFailure.Unavailable => new(CalendarProblemKind.Unavailable, "calendar_unreachable", e.Message, inner: e),
        CalDavFailure.Blocked => new(CalendarProblemKind.Refused, "calendar_address_blocked", e.Message, inner: e),
        CalDavFailure.NotCalDav => new(CalendarProblemKind.Refused, "calendar_not_caldav", e.Message, inner: e),
        _ => new(CalendarProblemKind.Refused, "calendar_refused", e.Message, inner: e),
    };

    [GeneratedRegex(@"^#([0-9A-Fa-f]{6})(?:[0-9A-Fa-f]{2})?$", RegexOptions.CultureInvariant)]
    private static partial Regex ColorPattern();

    [GeneratedRegex(@"^[0-9A-Za-z_-]{1,64}$", RegexOptions.CultureInvariant)]
    private static partial Regex IdPattern();
}
