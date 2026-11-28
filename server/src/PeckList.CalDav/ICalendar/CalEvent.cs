namespace PeckList.CalDav.ICalendar;

/// <summary>
/// When an event starts or ends: a day (all day), or a day and a time in a zone.
/// </summary>
/// <param name="Date">The day.</param>
/// <param name="Time">The time of day; null for an all-day event.</param>
/// <param name="TimeZone">
/// An IANA zone name, <c>UTC</c>, or null for a floating time (the same clock time wherever the
/// reader is, RFC 5545 3.3.5 form 1). Always null for an all-day time.
/// </param>
public sealed record EventTime(DateOnly Date, TimeOnly? Time = null, string? TimeZone = null)
{
    /// <summary>The zone name for UTC times.</summary>
    public const string Utc = "UTC";

    /// <summary>True for a day with no time.</summary>
    public bool AllDay => Time is null;

    /// <summary>The day and time as a clock reading in its own zone (midnight for a day).</summary>
    public DateTime Local => Date.ToDateTime(Time ?? TimeOnly.MinValue);

    /// <summary>An all-day time.</summary>
    public static EventTime Day(DateOnly date) => new(date);

    /// <summary>A timed instant in <paramref name="zone"/> (IANA name, <c>UTC</c> or null for floating).</summary>
    public static EventTime At(DateTime local, string? zone) =>
        new(DateOnly.FromDateTime(local), TimeOnly.FromDateTime(local), zone);
}

/// <summary>
/// One VEVENT as PeckList reads and writes it (spec: PL-134, Task to Event Mapping). Everything
/// else in the event (alarms, attendees, a client's own properties) stays in the calendar object
/// and is written back untouched.
/// </summary>
public sealed record CalEvent
{
    /// <summary>The event's UID, the same for a series and its changed occurrences.</summary>
    public required string Uid { get; init; }

    /// <summary>SUMMARY, the title.</summary>
    public string? Summary { get; init; }

    /// <summary>DESCRIPTION, the notes.</summary>
    public string? Description { get; init; }

    /// <summary>DTSTART.</summary>
    public required EventTime Start { get; init; }

    /// <summary>
    /// The end, exclusive: DTEND, or DTSTART plus DURATION. Null when the event has neither; the
    /// writer then makes a 30-minute event (a day for an all-day one), spec: PL-134 decision 5.
    /// </summary>
    public EventTime? End { get; init; }

    /// <summary>
    /// The repeat rule as content lines (<c>RRULE:FREQ=WEEKLY;BYDAY=MO</c>,
    /// <c>EXDATE;TZID=Europe/Berlin:20261130T090000</c>), the same shape as Google Calendar's
    /// <c>recurrence</c> list. Only RRULE, EXRULE, RDATE and EXDATE lines.
    /// </summary>
    public IReadOnlyList<string> Recurrence { get; init; } = [];

    /// <summary>
    /// The EXDATE lines of <see cref="Recurrence"/> read as times, the same way as the start. Only
    /// read; the writer goes by <see cref="Recurrence"/>.
    /// </summary>
    public IReadOnlyList<EventTime> ExDates { get; init; } = [];

    /// <summary>
    /// <c>X-PECKLIST-TASK</c>: which server and task wrote the event (spec: PL-134, events remember
    /// their task), as text. Null on events PeckList didn't write; the writer removes the property
    /// when it is null.
    /// </summary>
    public string? PeckListTask { get; init; }

    /// <summary>
    /// ORGANIZER's address, without <c>mailto:</c> and in lower case; null when the event names none
    /// (an event with no attendees usually doesn't).
    /// </summary>
    public string? Organizer { get; init; }

    /// <summary>RECURRENCE-ID: set on a changed occurrence of a series, null on the series itself.</summary>
    public EventTime? RecurrenceId { get; init; }

    /// <summary>STATUS:CANCELLED.</summary>
    public bool Cancelled { get; init; }

    /// <summary>LAST-MODIFIED, else DTSTAMP: when the event last changed, for latest-edit-wins.</summary>
    public DateTimeOffset? LastModified { get; init; }

    /// <summary>SEQUENCE, the revision the organizer's client counts.</summary>
    public int Sequence { get; init; }
}

/// <summary>
/// One calendar object resource (one <c>.ics</c> on the server): the series, the occurrences that
/// were changed, and the parsed tree the writer edits so nothing else in it is lost.
/// </summary>
public sealed record CalObject(CalComponent Root, CalEvent? Master, IReadOnlyList<CalEvent> Overrides)
{
    /// <summary>The object's UID.</summary>
    public string? Uid => Master?.Uid ?? Overrides.FirstOrDefault()?.Uid;
}
