namespace PeckList.CalDav.ICalendar;

/// <summary>
/// Writes an event into a calendar object (spec: PL-134 decision 5 and Task to Event Mapping).
/// A new event gets a new object; an edited one is written into the object it came from, so its
/// alarms, attendees, changed occurrences and other properties are kept.
/// </summary>
public static class EventWriter
{
    /// <summary>The PRODID of objects PeckList creates.</summary>
    public const string ProductId = "-//PeckList//PeckList//EN";

    /// <summary>How long a timed event with no end lasts (decision 5).</summary>
    public static readonly TimeSpan DefaultLength = TimeSpan.FromMinutes(30);

    /// <summary>A new calendar object holding one event.</summary>
    public static string Create(CalEvent calEvent, DateTimeOffset now) => Write(null, calEvent, now);

    /// <summary>
    /// The calendar object <paramref name="existing"/> with its series (the VEVENT without a
    /// RECURRENCE-ID) replaced by <paramref name="calEvent"/>. Null makes a new object.
    /// </summary>
    public static string Write(string? existing, CalEvent calEvent, DateTimeOffset now)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(calEvent.Uid);
        var root = existing is null ? NewCalendar() : CalText.Parse(existing);
        var vevent = root.Components("VEVENT").FirstOrDefault(e => e.Property("RECURRENCE-ID") is null);
        var isNew = vevent is null;
        if (vevent is null)
        {
            vevent = new CalComponent("VEVENT");
            root.Children.Add(vevent);
        }
        Fill(vevent, calEvent, now, isNew);
        SyncZones(root, calEvent.Start.Date.Year);
        return CalText.Write(root);
    }

    private static CalComponent NewCalendar()
    {
        var root = new CalComponent("VCALENDAR");
        root.Properties.Add(new CalProperty("VERSION", "2.0"));
        root.Properties.Add(new CalProperty("PRODID", ProductId));
        root.Properties.Add(new CalProperty("CALSCALE", "GREGORIAN"));
        return root;
    }

    private static void Fill(CalComponent vevent, CalEvent calEvent, DateTimeOffset now, bool isNew)
    {
        var stamp = CalValues.FormatUtc(now);
        vevent.Set(new CalProperty("UID", calEvent.Uid.Trim()));
        vevent.Set(new CalProperty("DTSTAMP", stamp));
        vevent.Set(new CalProperty("LAST-MODIFIED", stamp));
        var sequence = isNew ? 0 : (int.TryParse(vevent.Property("SEQUENCE")?.Value, out var s) ? s + 1 : 1);
        vevent.Set(new CalProperty("SEQUENCE", sequence.ToString(System.Globalization.CultureInfo.InvariantCulture)));
        SetText(vevent, "SUMMARY", calEvent.Summary);
        SetText(vevent, "DESCRIPTION", calEvent.Description);
        vevent.Set(TimeProperty("DTSTART", calEvent.Start));
        vevent.Remove("DURATION");
        vevent.Set(TimeProperty("DTEND", EndOf(calEvent.Start, calEvent.End)));
        foreach (var name in EventReader.RecurrenceNames) vevent.Remove(name);
        foreach (var line in calEvent.Recurrence) vevent.Properties.Add(RecurrenceProperty(line));
        SetText(vevent, "X-PECKLIST-TASK", calEvent.PeckListTask);
        if (calEvent.Cancelled) vevent.Set(new CalProperty("STATUS", "CANCELLED"));
        else if (string.Equals(vevent.Property("STATUS")?.Value.Trim(), "CANCELLED", StringComparison.OrdinalIgnoreCase)) vevent.Remove("STATUS");
    }

    /// <summary>
    /// The end to write: the given one when it is the same kind as the start and after it, else a
    /// day after an all-day start, or 30 minutes after a timed one.
    /// </summary>
    public static EventTime EndOf(EventTime start, EventTime? end)
    {
        if (start.AllDay)
            return end is { AllDay: true } && end.Date > start.Date ? end : EventTime.Day(start.Date.AddDays(1));
        if (end is { AllDay: false } && (end.TimeZone != start.TimeZone || end.Local > start.Local)) return end;
        return EventTime.At(start.Local + DefaultLength, start.TimeZone);
    }

    private static void SetText(CalComponent vevent, string name, string? text)
    {
        if (string.IsNullOrEmpty(text)) vevent.Remove(name);
        else vevent.Set(new CalProperty(name, CalText.Escape(text)));
    }

    /// <summary>DTSTART, DTEND or RECURRENCE-ID for a time.</summary>
    public static CalProperty TimeProperty(string name, EventTime time)
    {
        if (time.AllDay) return new CalProperty(name, CalValues.FormatDate(time.Date), [new CalParameter("VALUE", ["DATE"])]);
        if (time.TimeZone == EventTime.Utc) return new CalProperty(name, CalValues.FormatDateTime(time.Local, utc: true));
        if (time.TimeZone is null) return new CalProperty(name, CalValues.FormatDateTime(time.Local));
        if (CalZones.Find(time.TimeZone) is null) throw new ArgumentException($"unknown time zone {time.TimeZone}");
        return new CalProperty(name, CalValues.FormatDateTime(time.Local), [new CalParameter("TZID", [time.TimeZone])]);
    }

    private static CalProperty RecurrenceProperty(string line)
    {
        var parsed = CalText.Parse("BEGIN:VCALENDAR\r\n" + line.Trim() + "\r\nEND:VCALENDAR\r\n").Properties;
        if (parsed.Count != 1 || !EventReader.RecurrenceNames.Contains(parsed[0].Name))
            throw new ArgumentException("a recurrence line must be one RRULE, EXRULE, RDATE or EXDATE line", nameof(line));
        return parsed[0];
    }

    // Every TZID an event uses needs its VTIMEZONE (RFC 5545 3.6.5): keep the ones already there,
    // build the missing IANA ones, and drop those nothing refers to any more.
    private static void SyncZones(CalComponent root, int year)
    {
        var used = root.Components("VEVENT")
            .SelectMany(e => e.Properties)
            .Select(p => p.Param("TZID"))
            .OfType<string>()
            .ToHashSet(StringComparer.Ordinal);
        root.Children.RemoveAll(c => c.Name == "VTIMEZONE" && (c.Property("TZID")?.Value is not { } id || !used.Contains(id)));
        var have = root.Components("VTIMEZONE").Select(z => z.Property("TZID")!.Value).ToHashSet(StringComparer.Ordinal);
        var insertAt = 0;
        foreach (var tzid in used.Order(StringComparer.Ordinal))
        {
            if (have.Contains(tzid) || CalZones.IanaName(tzid) != tzid || tzid == EventTime.Utc) continue;
            root.Children.Insert(insertAt++, CalZones.Build(tzid, year));
        }
    }
}
