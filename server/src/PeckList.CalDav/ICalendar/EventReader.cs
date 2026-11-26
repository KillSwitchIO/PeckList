namespace PeckList.CalDav.ICalendar;

/// <summary>
/// Reads the events of a calendar object (spec: PL-134, Task to Event Mapping). Times come back
/// exactly as the object gives them: an all-day event as days with an exclusive end, a timed one in
/// its IANA zone (or UTC, or floating), and an event with no DTEND or DURATION with no end at all.
/// </summary>
public static class EventReader
{
    /// <summary>The names of the properties that make up <see cref="CalEvent.Recurrence"/>.</summary>
    public static readonly IReadOnlySet<string> RecurrenceNames = new HashSet<string>(StringComparer.Ordinal) { "RRULE", "EXRULE", "RDATE", "EXDATE" };

    /// <summary>Parses a calendar object and reads its events.</summary>
    /// <exception cref="CalendarFormatException">The text isn't a calendar object, or an event in it lacks a UID or start.</exception>
    public static CalObject Read(string text) => Read(CalText.Parse(text));

    /// <summary>Reads the events of a parsed calendar object.</summary>
    public static CalObject Read(CalComponent root)
    {
        var zones = root.Components("VTIMEZONE")
            .Select(z => (Id: z.Property("TZID")?.Value, Zone: z))
            .Where(z => z.Id is not null)
            .GroupBy(z => z.Id!, StringComparer.Ordinal)
            .ToDictionary(g => g.Key, g => g.First().Zone, StringComparer.Ordinal);
        CalEvent? master = null;
        var overrides = new List<CalEvent>();
        foreach (var component in root.Components("VEVENT"))
        {
            CalEvent read;
            try
            {
                read = Event(component, zones);
            }
            catch (Exception e) when (e is ArgumentException or FormatException or OverflowException)
            {
                // Values the checks above didn't foresee still mean "not an event we can read".
                throw new CalendarFormatException("an event with a value out of range");
            }
            if (read.RecurrenceId is not null) overrides.Add(read);
            else master ??= read;
        }
        return new CalObject(root, master, overrides);
    }

    private static CalEvent Event(CalComponent vevent, Dictionary<string, CalComponent> zones)
    {
        var uid = vevent.Property("UID")?.Value.Trim();
        if (string.IsNullOrEmpty(uid)) throw new CalendarFormatException("VEVENT without a UID");
        var startProperty = vevent.Property("DTSTART") ?? throw new CalendarFormatException("VEVENT without a DTSTART");
        var start = Time(startProperty, zones);
        EventTime? end = null;
        if (vevent.Property("DTEND") is { } dtend) end = Time(dtend, zones);
        else if (vevent.Property("DURATION") is { } duration)
        {
            var span = CalValues.ParseDuration(duration.Value);
            end = start.AllDay
                ? EventTime.Day(CalValues.AddDays(start.Date, (long)Math.Ceiling(span.TotalDays)))
                : EventTime.At(CalValues.Add(start.Local, span), start.TimeZone);
        }
        var stamp = vevent.Property("LAST-MODIFIED") ?? vevent.Property("DTSTAMP");
        return new CalEvent
        {
            Uid = uid,
            Summary = Text(vevent, "SUMMARY"),
            Description = Text(vevent, "DESCRIPTION"),
            Start = start,
            End = end,
            Recurrence = vevent.Properties.Where(p => RecurrenceNames.Contains(p.Name)).Select(CalText.ContentLine).ToList(),
            ExDates = vevent.All("EXDATE")
                .SelectMany(p => p.Value.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries)
                    .Select(value => Time(new CalProperty("EXDATE", value, p.Parameters), zones)))
                .ToList(),
            PeckListTask = Text(vevent, "X-PECKLIST-TASK"),
            RecurrenceId = vevent.Property("RECURRENCE-ID") is { } rid ? Time(rid, zones) : null,
            Cancelled = string.Equals(vevent.Property("STATUS")?.Value.Trim(), "CANCELLED", StringComparison.OrdinalIgnoreCase),
            LastModified = stamp is null ? null : Instant(stamp.Value),
            Sequence = int.TryParse(vevent.Property("SEQUENCE")?.Value, System.Globalization.NumberStyles.None, System.Globalization.CultureInfo.InvariantCulture, out var sequence) ? sequence : 0,
        };
    }

    private static string? Text(CalComponent vevent, string name) =>
        vevent.Property(name) is { } property ? CalText.Unescape(property.Value) : null;

    private static DateTimeOffset? Instant(string value)
    {
        try
        {
            var (at, isDate, _) = CalValues.ParseDateTime(value);
            // Both properties are UTC by the RFC; a missing Z is read as UTC too.
            return isDate ? null : new DateTimeOffset(at, TimeSpan.Zero);
        }
        catch (CalendarFormatException)
        {
            return null;
        }
    }

    /// <summary>
    /// A DTSTART, DTEND or RECURRENCE-ID. A TZID that names an IANA zone keeps it; any other TZID
    /// is turned into UTC through the object's VTIMEZONE, or read as floating when there is none.
    /// </summary>
    internal static EventTime Time(CalProperty property, IReadOnlyDictionary<string, CalComponent> zones)
    {
        var (value, isDate, isUtc) = CalValues.ParseDateTime(property.Value);
        if (isDate || string.Equals(property.Param("VALUE"), "DATE", StringComparison.OrdinalIgnoreCase))
            return EventTime.Day(DateOnly.FromDateTime(value));
        if (isUtc) return EventTime.At(value, EventTime.Utc);
        if (property.Param("TZID") is not { } tzid) return EventTime.At(value, null);
        if (CalZones.IanaName(tzid) is { } iana) return EventTime.At(value, iana);
        if (zones.TryGetValue(tzid, out var vtimezone) && CalZones.Offset(vtimezone, value) is { } offset)
            return EventTime.At(CalValues.Add(value, -offset), EventTime.Utc);
        return EventTime.At(value, null);
    }
}
