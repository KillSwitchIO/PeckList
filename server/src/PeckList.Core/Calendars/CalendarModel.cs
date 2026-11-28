using System.Text.Json.Serialization;

namespace PeckList.Core.Calendars;

/// <summary>What a provider can do beyond reading and writing events.</summary>
/// <param name="Push">It can call the server when a calendar changes (Google watch channels).</param>
/// <param name="CreateCalendar">It can make a new calendar in the account.</param>
/// <param name="SeriesListsOverrides">
/// A changed series comes with all its overrides (CalDAV, where they are one resource), so a stored
/// override missing from it is gone. Off (Google): overrides come and go on their own. Either way,
/// a deleted series takes its overrides with it, announced or not.
/// </param>
public sealed record CalendarCapabilities(bool Push, bool CreateCalendar, bool SeriesListsOverrides = false);

/// <summary>
/// How to reach one connected account. Built by the engine from the stored account, with the secret
/// decrypted only for the call.
/// </summary>
/// <param name="ServerUrl">The CalDAV address the person gave, or the service's own for Google.</param>
/// <param name="Username">The CalDAV username; null for Google.</param>
/// <param name="Secret">The CalDAV app password, or Google's token JSON. Never logged.</param>
/// <param name="SecretChanged">
/// Called with a new secret when the adapter gets one (a refreshed Google token), so it is stored
/// encrypted in place of the old one. Null when nobody needs to hear.
/// </param>
public sealed record CalendarConnection(string ServerUrl, string? Username, string Secret, Func<string, Task>? SecretChanged = null)
{
    /// <summary>The secret stays out of logs and test output, whatever prints the connection.</summary>
    public override string ToString() => $"CalendarConnection {{ ServerUrl = {ServerUrl}, Username = {Username} }}";
}

/// <summary>One calendar in an account.</summary>
/// <param name="Id">The provider's id (a CalDAV collection path, a Google calendar id).</param>
/// <param name="Color">A CSS colour (<c>#RRGGBB</c>) when the calendar has one.</param>
/// <param name="ReadOnly">Events cannot be written (a subscription, holidays): only Off and Show are offered.</param>
/// <param name="TimeZone">The calendar's own IANA zone, when it says.</param>
public sealed record RemoteCalendar(string Id, string Name, string? Color, bool ReadOnly, string? TimeZone);

/// <summary>A page of a calendar's changes: everything since the token asked with.</summary>
/// <param name="Changed">New and changed events, overrides of single occurrences included.</param>
/// <param name="Deleted">Ids of events gone. A provider may report a deletion as a <see cref="RemoteEvent.Cancelled"/> event instead.</param>
/// <param name="SyncToken">Pass this next time; null when the service gave none.</param>
/// <param name="Reset">A full listing: any event not in <see cref="Changed"/> is gone.</param>
public sealed record RemoteChanges(IReadOnlyList<RemoteEvent> Changed, IReadOnlyList<string> Deleted, string? SyncToken, bool Reset);

/// <summary>An event as the service holds it.</summary>
/// <param name="Id">The provider's id. An override of one occurrence has an id of its own.</param>
/// <param name="Etag">Sent back as If-Match on the next write.</param>
/// <param name="UpdatedAt">When it last changed on the service (LAST-MODIFIED, Google's <c>updated</c>): latest edit wins on it.</param>
/// <param name="SeriesId">For an override of one occurrence, the id of the repeating event it belongs to.</param>
/// <param name="OriginalStart">For an override, the start of the occurrence it replaces (RECURRENCE-ID).</param>
/// <param name="Cancelled">The event, or for an override its occurrence, is cancelled.</param>
/// <param name="Raw">
/// The adapter's own copy (ICS text, Google's JSON). The engine stores it unread and hands it back as
/// the basis of an update, so what the engine does not map survives.
/// </param>
/// <param name="Foreign">
/// An event the person can't own, so it never becomes a task (spec: PL-134, decision 8): a kind the
/// service keeps to itself (Google's birthdays, out of office, focus time, working location, events
/// from Gmail) or an invitation someone else organises.
/// </param>
public sealed record RemoteEvent(
    string Id,
    string Etag,
    EventData Data,
    DateTimeOffset UpdatedAt,
    string? SeriesId = null,
    CalendarTime? OriginalStart = null,
    bool Cancelled = false,
    string? Raw = null,
    bool Foreign = false);

/// <summary>The parts of an event PeckList maps to a task (spec: PL-134, Task to Event Mapping).</summary>
/// <param name="Description">Plain text; a task's notes go here as written.</param>
/// <param name="End">
/// Exclusive, as in iCalendar and Google. Null when the event has none: the engine reads that as 30
/// minutes, or one day when all-day (decision 5). Adapters report what the calendar says.
/// </param>
/// <param name="RRule">The RFC 5545 rule without the <c>RRULE:</c> prefix, as text; null when it does not repeat.</param>
/// <param name="ExDates">Occurrences left out of the rule, in the same form as <see cref="Start"/>.</param>
/// <param name="Marker">
/// Which task on which server wrote the event. Every event PeckList writes carries one, so a new link
/// pairs PeckList's own events with their tasks instead of making copies (after a restore, or a
/// disconnect and reconnect). Null on events PeckList did not write. RDATE and anything else
/// unmapped stays in <see cref="RemoteEvent.Raw"/>.
/// </param>
public sealed record EventData(
    string Summary,
    string Description,
    CalendarTime Start,
    CalendarTime? End,
    string? RRule = null,
    IReadOnlyList<CalendarTime>? ExDates = null,
    EventMarker? Marker = null)
{
    /// <summary>A day with no time: the event is all-day.</summary>
    [JsonIgnore]
    public bool AllDay => Start.IsDate;
}

/// <summary>
/// A moment as the calendar gives it: <c>2026-11-03</c> (a day, for all-day events) or
/// <c>2026-11-03T09:00</c> (a local time in <see cref="TimeZone"/>; seconds only when they are not
/// zero, so the same moment always reads as the same text).
/// </summary>
/// <param name="TimeZone">An IANA name, <c>UTC</c>, or null for a floating time (and for a day).</param>
public sealed record CalendarTime(string Value, string? TimeZone = null)
{
    /// <summary>Whether this is a day with no time.</summary>
    [JsonIgnore]
    public bool IsDate => Value.Length == 10;

    /// <summary>A day.</summary>
    public static CalendarTime Date(string value) => new(value);

    /// <summary>A local time in a zone.</summary>
    public static CalendarTime Local(string value, string? timeZone) => new(value, timeZone);
}

/// <summary>
/// The task an event was written for, and the server that wrote it. CalDAV keeps it in
/// <c>X-PECKLIST-TASK</c>, Google in <c>extendedProperties.private</c>. The instance keeps two servers
/// syncing one calendar (a test copy beside the real one) from taking each other's events.
/// </summary>
public sealed record EventMarker(string Instance, string TaskId);

/// <summary>A push channel a provider opened (Google watch).</summary>
/// <param name="Id">The channel's id, chosen by the server.</param>
/// <param name="ResourceId">The service's id for what is watched, needed to stop it.</param>
/// <param name="Expires">When the service stops calling; the engine opens a new one before.</param>
public sealed record PushChannel(string Id, string ResourceId, DateTimeOffset Expires);
