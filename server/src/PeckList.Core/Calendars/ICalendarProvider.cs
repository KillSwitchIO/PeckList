namespace PeckList.Core.Calendars;

/// <summary>
/// One kind of calendar service (spec: PL-134, Shape): CalDAV, Google, and the fake the engine is
/// tested against. Provider-neutral and Google-shaped: changes come by sync token, writes carry the
/// etag they were based on, and a provider that can push says so in <see cref="Capabilities"/>.
/// Paging is the adapter's job: each call returns everything it was asked for. Every adapter passes
/// the contract kit (<c>PeckList.Calendars.Testing</c>, <c>CalendarProviderContract</c>).
/// </summary>
/// <remarks>
/// Failures are thrown as <see cref="CalendarProblem"/>, whose kind the engine switches on. Nothing an
/// adapter throws or logs may carry a secret, a URL with its query, or event content.
/// </remarks>
public interface ICalendarProvider
{
    /// <summary>The name stored with an account (<c>caldav</c>, <c>google</c>, <c>fake</c>).</summary>
    string Kind { get; }

    /// <summary>What this provider can do beyond reading and writing events.</summary>
    CalendarCapabilities Capabilities { get; }

    /// <summary>The account's calendars that can hold events.</summary>
    Task<IReadOnlyList<RemoteCalendar>> CalendarsAsync(CalendarConnection connection, CancellationToken cancellation);

    /// <summary>
    /// A new calendar in the account ("Make a PeckList calendar"). Only called when
    /// <see cref="CalendarCapabilities.CreateCalendar"/> is set.
    /// </summary>
    Task<RemoteCalendar> CreateCalendarAsync(CalendarConnection connection, string name, CancellationToken cancellation);

    /// <summary>
    /// What changed in a calendar since <paramref name="syncToken"/>. Null asks for a full listing
    /// (<see cref="RemoteChanges.Reset"/> set: anything not listed is gone). A token the service no
    /// longer accepts throws <see cref="CalendarProblemKind.SyncTokenExpired"/>, and the engine asks
    /// again with null.
    /// </summary>
    Task<RemoteChanges> ChangesAsync(CalendarConnection connection, string calendarId, string? syncToken, CancellationToken cancellation);

    /// <summary>A new event, as the service stored it (its id, etag and time of change).</summary>
    Task<RemoteEvent> CreateEventAsync(CalendarConnection connection, string calendarId, EventData data, CancellationToken cancellation);

    /// <summary>
    /// Change an event to <paramref name="data"/>, sending the etag of <paramref name="basis"/> as
    /// If-Match: a stale one throws <see cref="CalendarProblemKind.Conflict"/>. <paramref name="basis"/>
    /// is the event as last read, so the adapter keeps everything the engine does not map (location,
    /// alarms, attendees, overrides) from its <see cref="RemoteEvent.Raw"/>.
    /// </summary>
    Task<RemoteEvent> UpdateEventAsync(CalendarConnection connection, string calendarId, RemoteEvent basis, EventData data, CancellationToken cancellation);

    /// <summary>
    /// Delete an event with If-Match <paramref name="etag"/>: a stale one throws
    /// <see cref="CalendarProblemKind.Conflict"/>. An event already gone counts as deleted.
    /// </summary>
    Task DeleteEventAsync(CalendarConnection connection, string calendarId, string eventId, string etag, CancellationToken cancellation);

    /// <summary>
    /// Ask the service to call <paramref name="callback"/> when the calendar changes, carrying
    /// <paramref name="channelToken"/> so the server can tell the call is real. Null exactly when
    /// <see cref="CalendarCapabilities.Push"/> is off.
    /// </summary>
    Task<PushChannel?> WatchAsync(CalendarConnection connection, string calendarId, Uri callback, string channelToken, CancellationToken cancellation);

    /// <summary>Stop a channel <see cref="WatchAsync"/> opened. One already gone counts as stopped.</summary>
    Task StopWatchAsync(CalendarConnection connection, PushChannel channel, CancellationToken cancellation);
}
