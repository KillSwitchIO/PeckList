using System.Globalization;
using System.Text.Json.Nodes;
using PeckList.Core.Calendars;

namespace PeckList.Google;

/// <summary>
/// Google Calendar events to and from the port's <see cref="EventData"/> (spec: PL-134, Task to Event
/// Mapping). Only the mapped fields are read or written; everything else stays in
/// <see cref="RemoteEvent.Raw"/>, Google's own JSON, and an update patches the mapped fields alone.
/// </summary>
internal static class GoogleEvents
{
    /// <summary>Where PeckList's marker lives in <c>extendedProperties.private</c>.</summary>
    public const string InstanceKey = "pecklistInstance";

    public const string TaskKey = "pecklistTask";

    /// <summary>An event as Google listed it. <paramref name="calendarZone"/> reads a time that gives only an offset.</summary>
    public static RemoteEvent Read(JsonObject item, string? calendarZone)
    {
        var start = Time(item["start"] as JsonObject, calendarZone);
        var original = item["originalStartTime"] is JsonObject originalStart ? Time(originalStart, calendarZone) : null;
        var (rrule, exDates) = Recurrence(item["recurrence"] as JsonArray);
        var data = new EventData(
            Text(item, "summary") ?? "",
            Text(item, "description") ?? "",
            // A cancelled occurrence comes with no times of its own: it stands where it would have been.
            start ?? original ?? CalendarTime.Date("1970-01-01"),
            Time(item["end"] as JsonObject, calendarZone),
            rrule,
            exDates,
            Marker(item));
        return new RemoteEvent(
            Text(item, "id") ?? throw new FormatException("an event without an id"),
            Text(item, "etag") ?? "",
            data,
            Updated(item),
            Text(item, "recurringEventId"),
            original,
            Text(item, "status") == "cancelled",
            item.ToJsonString(),
            Foreign(item));
    }

    /// <summary>
    /// Not the person's to own (spec: PL-134, decision 8): any kind but a plain event (Google's
    /// <c>birthday</c>, <c>outOfOffice</c>, <c>focusTime</c>, <c>workingLocation</c>, <c>fromGmail</c>,
    /// and any kind added later), or an event this calendar didn't organise (<c>organizer.self</c> not
    /// true: an invitation). Google names the organizer on every event.
    /// </summary>
    internal static bool Foreign(JsonObject item) =>
        (Text(item, "eventType") ?? "default") != "default"
        || !(item["organizer"] is JsonObject organizer && organizer["self"] is JsonValue self && self.TryGetValue<bool>(out var mine) && mine);

    /// <summary>A new event's body. An event without an end gets 30 minutes or one day (decision 5): Google needs one.</summary>
    public static JsonObject Create(EventData data)
    {
        var body = new JsonObject
        {
            ["summary"] = data.Summary,
            ["description"] = data.Description,
            ["start"] = WriteTime(data.Start, patch: false),
            ["end"] = WriteTime(data.End ?? DefaultEnd(data.Start), patch: false),
        };
        if (RecurrenceLines(data, []) is { Count: > 0 } lines) body["recurrence"] = lines;
        if (MarkerProperties(data.Marker) is { } marker) body["extendedProperties"] = marker;
        return body;
    }

    /// <summary>
    /// A patch of the mapped fields that differ from <paramref name="basis"/>, the event as last read,
    /// and nothing else: empty when nothing differs. A marker written alone patches only
    /// <c>extendedProperties</c>, so an event the person has is never rewritten from PeckList's reading
    /// of it (a zone, a rule's wording, a description), and Google takes it even where it limits what
    /// may change (a birthday). Location, attendees, reminders and the rest are never sent. Changed times
    /// name both forms, the unused one null, so a timed event can become all-day and back. Recurrence
    /// lines the port does not map (RDATE, EXRULE) are kept from the basis.
    /// </summary>
    public static JsonObject Patch(EventData data, RemoteEvent basis)
    {
        var was = basis.Data;
        var body = new JsonObject();
        if (data.Summary != was.Summary) body["summary"] = data.Summary;
        if (data.Description != was.Description) body["description"] = data.Description;
        if (data.Start != was.Start || data.End != was.End)
        {
            body["start"] = WriteTime(data.Start, patch: true);
            body["end"] = WriteTime(data.End ?? DefaultEnd(data.Start), patch: true);
        }
        if (data.RRule != was.RRule || !(data.ExDates ?? []).SequenceEqual(was.ExDates ?? []))
        {
            var kept = new List<string>();
            if (basis.Raw is not null && JsonNode.Parse(basis.Raw) is JsonObject raw && raw["recurrence"] is JsonArray lines)
            {
                kept.AddRange(lines.OfType<JsonValue>().Select(line => line.GetValue<string>())
                    .Where(line => !line.StartsWith("RRULE", StringComparison.OrdinalIgnoreCase) && !line.StartsWith("EXDATE", StringComparison.OrdinalIgnoreCase)));
            }
            body["recurrence"] = RecurrenceLines(data, kept);
        }
        // Google merges the keys of extendedProperties.private, so other apps' keys stay.
        if (data.Marker != was.Marker && MarkerProperties(data.Marker) is { } marker) body["extendedProperties"] = marker;
        return body;
    }

    /// <summary>A Google time: <c>{date}</c> is a day; <c>{dateTime, timeZone}</c> a local time in that zone, or in UTC when only an offset is given.</summary>
    public static CalendarTime? Time(JsonObject? time, string? calendarZone)
    {
        if (time is null) return null;
        if (Text(time, "date") is { } date) return CalendarTime.Date(date);
        if (Text(time, "dateTime") is not { } text) return null;
        var zoneName = Text(time, "timeZone") ?? calendarZone;
        var zone = zoneName is not null && TimeZoneInfo.TryFindSystemTimeZoneById(zoneName, out var found) ? found : null;
        if (!HasOffset(text))
        {
            // Google answers with an offset; a time without one is already local to its zone.
            var local = DateTime.Parse(text, CultureInfo.InvariantCulture, DateTimeStyles.None);
            return CalendarTime.Local(LocalText(local), zone is null ? "UTC" : zoneName);
        }
        var instant = DateTimeOffset.Parse(text, CultureInfo.InvariantCulture, DateTimeStyles.None);
        if (zone is null) return CalendarTime.Local(LocalText(instant.UtcDateTime), "UTC");
        return CalendarTime.Local(LocalText(TimeZoneInfo.ConvertTime(instant, zone).DateTime), zoneName);
    }

    // RFC 3339 ends in Z or +hh:mm / -hh:mm after the time.
    private static bool HasOffset(string text)
    {
        var time = text.IndexOf('T', StringComparison.Ordinal);
        return time > 0 && (text.EndsWith('Z') || text.EndsWith('z') || text.AsSpan(time).IndexOfAny('+', '-') > 0);
    }

    /// <summary>The port's text for a local moment: minutes, and seconds only when they are not zero.</summary>
    public static string LocalText(DateTime local) =>
        local.ToString(local.Second == 0 ? "yyyy-MM-dd'T'HH:mm" : "yyyy-MM-dd'T'HH:mm:ss", CultureInfo.InvariantCulture);

    private static JsonObject WriteTime(CalendarTime time, bool patch)
    {
        if (time.IsDate)
        {
            var day = new JsonObject { ["date"] = time.Value };
            if (patch)
            {
                day["dateTime"] = null;
                day["timeZone"] = null;
            }
            return day;
        }
        var value = time.Value.Length == 16 ? time.Value + ":00" : time.Value;
        // A floating time has no zone in Google; UTC is the honest reading of one.
        var timed = new JsonObject { ["dateTime"] = value, ["timeZone"] = time.TimeZone ?? "UTC" };
        if (patch) timed["date"] = null;
        return timed;
    }

    private static CalendarTime DefaultEnd(CalendarTime start)
    {
        if (start.IsDate)
        {
            var day = DateOnly.ParseExact(start.Value, "yyyy-MM-dd", CultureInfo.InvariantCulture);
            return CalendarTime.Date(day.AddDays(1).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture));
        }
        var local = DateTime.Parse(start.Value, CultureInfo.InvariantCulture, DateTimeStyles.None);
        return CalendarTime.Local(LocalText(local + CalendarMapping.DefaultLength), start.TimeZone);
    }

    private static JsonArray RecurrenceLines(EventData data, IReadOnlyList<string> kept)
    {
        var lines = new JsonArray();
        if (data.RRule is { } rule) lines.Add("RRULE:" + rule);
        foreach (var exDate in data.ExDates ?? []) lines.Add(ExDateLine(exDate));
        foreach (var line in kept) lines.Add(line);
        return lines;
    }

    private static string ExDateLine(CalendarTime time)
    {
        var compact = time.Value.Replace("-", "", StringComparison.Ordinal).Replace(":", "", StringComparison.Ordinal);
        if (time.IsDate) return "EXDATE;VALUE=DATE:" + compact;
        if (compact.Length == 13) compact += "00";
        return time.TimeZone switch
        {
            null => "EXDATE:" + compact,
            "UTC" => "EXDATE:" + compact + "Z",
            var zone => $"EXDATE;TZID={zone}:{compact}",
        };
    }

    private static (string? RRule, IReadOnlyList<CalendarTime>? ExDates) Recurrence(JsonArray? lines)
    {
        if (lines is null) return (null, null);
        string? rule = null;
        var exDates = new List<CalendarTime>();
        foreach (var line in lines.OfType<JsonValue>().Select(each => each.GetValue<string>()))
        {
            if (line.StartsWith("RRULE:", StringComparison.OrdinalIgnoreCase)) rule = line[6..];
            else if (line.StartsWith("EXDATE", StringComparison.OrdinalIgnoreCase)) exDates.AddRange(ExDates(line));
        }
        return (rule, exDates.Count > 0 ? exDates : null);
    }

    // EXDATE[;TZID=zone|;VALUE=DATE]:value[,value...]
    private static IEnumerable<CalendarTime> ExDates(string line)
    {
        var colon = line.IndexOf(':', StringComparison.Ordinal);
        if (colon < 0) yield break;
        var parameters = line[..colon].Split(';').Skip(1).Select(part => part.Split('=', 2)).Where(pair => pair.Length == 2)
            .ToDictionary(pair => pair[0].ToUpperInvariant(), pair => pair[1], StringComparer.Ordinal);
        foreach (var raw in line[(colon + 1)..].Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            if (raw.Length == 8)
            {
                yield return CalendarTime.Date($"{raw[..4]}-{raw[4..6]}-{raw[6..8]}");
                continue;
            }
            if (raw.Length < 15) continue;
            var local = DateTime.ParseExact(raw[..15], "yyyyMMdd'T'HHmmss", CultureInfo.InvariantCulture);
            var zone = raw.EndsWith('Z') ? "UTC" : parameters.GetValueOrDefault("TZID");
            yield return CalendarTime.Local(LocalText(local), zone);
        }
    }

    private static JsonObject? MarkerProperties(EventMarker? marker) =>
        marker is null ? null : new JsonObject { ["private"] = new JsonObject { [InstanceKey] = marker.Instance, [TaskKey] = marker.TaskId } };

    private static EventMarker? Marker(JsonObject item) =>
        item["extendedProperties"] is JsonObject extended && extended["private"] is JsonObject properties
            && Text(properties, InstanceKey) is { } instance && Text(properties, TaskKey) is { } task
            ? new EventMarker(instance, task)
            : null;

    private static DateTimeOffset Updated(JsonObject item) =>
        Text(item, "updated") is { } text && DateTimeOffset.TryParse(text, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var at)
            ? at
            : DateTimeOffset.UnixEpoch;

    internal static string? Text(JsonObject node, string name) =>
        node[name] is JsonValue value && value.TryGetValue<string>(out var text) ? text : null;
}
