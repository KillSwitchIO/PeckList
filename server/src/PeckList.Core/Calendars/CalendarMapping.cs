using System.Globalization;
using System.Text.Json.Nodes;
using PeckList.Core.Tasks;

namespace PeckList.Core.Calendars;

/// <summary>
/// Tasks to events and back (spec: PL-134, Task to Event Mapping, decision 5). Pure functions on the
/// task's JSON, so the engine and its tests read the same rules.
/// </summary>
/// <remarks>
/// A task's date is its schedule, or its due date when it has none; an event coming in sets the
/// schedule. In the workspace an all-day schedule's end is its last day, inclusive (null for one day);
/// in a calendar it is the day after. A time with no end is 30 minutes. Times are local times in the
/// task's zone; a task with no zone takes the person's.
/// </remarks>
public static class CalendarMapping
{
    /// <summary>The task fields the mapping reads and writes; the engine watches their clocks.</summary>
    public static readonly IReadOnlyList<string> TaskFields = ["title", "notes", "schedule", "due", "recurrence"];

    /// <summary>The most a task's notes hold (workspace schema, 0.14.0).</summary>
    public const int MaxNotes = 100_000;

    /// <summary>How long a time with no end lasts on a calendar (decision 5).</summary>
    public static readonly TimeSpan DefaultLength = TimeSpan.FromMinutes(30);

    /// <summary>
    /// The event a task maps to, or null when it has no date (a calendar needs one; such a task has no
    /// event). <paramref name="zone"/> is the person's, for a task whose date has no zone.
    /// </summary>
    public static EventData? EventOf(JsonObject task, EventMarker marker, string zone)
    {
        if (When(task) is not { } when) return null;
        var timeZone = string.IsNullOrEmpty(when.TimeZone) ? zone : when.TimeZone;
        CalendarTime start;
        CalendarTime end;
        if (when.AllDay || IsDay(when.Start))
        {
            var first = DayOf(when.Start);
            var last = when.End is { Length: >= 10 } endText && DayOf(endText) > first ? DayOf(endText) : first;
            start = CalendarTime.Date(DayText(first));
            end = CalendarTime.Date(DayText(last.AddDays(1)));
        }
        else
        {
            var from = LocalOf(when.Start);
            var to = when.End is { } endText && !IsDay(endText) && LocalOf(endText) > from ? LocalOf(endText) : from + DefaultLength;
            start = CalendarTime.Local(LocalText(from), timeZone);
            end = CalendarTime.Local(LocalText(to), timeZone);
        }
        var (rrule, exDates) = RuleOf((string?)task["recurrence"], start);
        return new EventData(Plain(task["title"]), Plain(task["notes"]), start, end, rrule, exDates, marker);
    }

    /// <summary>
    /// A task's text as a calendar keeps it: line breaks as LF (a calendar writes CR and CRLF as one),
    /// and no control characters but tab and LF (a calendar's text can't hold them). Compared as
    /// written, notes with CRLF would read as changed after every write and be sent again (QA F6).
    /// Text of another JSON kind counts as empty.
    /// </summary>
    public static string Plain(JsonNode? node)
    {
        if (node is not JsonValue value || !value.TryGetValue<string>(out var text) || text.Length == 0) return "";
        var builder = new System.Text.StringBuilder(text.Length);
        for (var i = 0; i < text.Length; i++)
        {
            var c = text[i];
            if (c == '\r')
            {
                builder.Append('\n');
                if (i + 1 < text.Length && text[i + 1] == '\n') i++;
            }
            else if (c == '\n' || c == '\t' || (c >= ' ' && c != '\u007f')) builder.Append(c);
        }
        return builder.ToString();
    }

    /// <summary>
    /// The task fields an event maps to: <c>title</c>, <c>notes</c>, <c>schedule</c> and
    /// <c>recurrence</c>. A task made from an event gets them all; a changed event writes those that changed.
    /// </summary>
    public static JsonObject TaskFieldsOf(EventData data, string zone)
    {
        JsonObject schedule;
        if (data.AllDay)
        {
            var first = DayOf(data.Start.Value);
            // The calendar's end is the day after; ours is the last day, or null for one day.
            var last = data.End is { IsDate: true } end ? DayOf(end.Value).AddDays(-1) : first;
            schedule = new JsonObject
            {
                ["start"] = DayText(first),
                ["end"] = last > first ? DayText(last) : null,
                ["allDay"] = true,
                ["timeZone"] = zone,
            };
        }
        else
        {
            var timeZone = data.Start.TimeZone ?? zone;
            var from = LocalOf(data.Start.Value);
            var to = data.End is { IsDate: false } end ? InZone(end, timeZone, zone) : from + DefaultLength;
            schedule = new JsonObject
            {
                ["start"] = LocalText(from),
                ["end"] = LocalText(to > from ? to : from + DefaultLength),
                ["allDay"] = false,
                ["timeZone"] = timeZone,
            };
        }
        return new JsonObject
        {
            ["title"] = data.Summary,
            // A task's notes hold at most what the schema allows; a longer description is cut, not refused.
            ["notes"] = data.Description.Length > MaxNotes ? data.Description[..MaxNotes] : data.Description,
            ["schedule"] = schedule,
            ["recurrence"] = RecurrenceOf(data),
        };
    }

    /// <summary>
    /// An event as a task holds it: through the task fields and back. Where a task can't hold an event
    /// exactly (an end in another zone, a rule's wording or parts a task has no room for, a time with
    /// no length), a task made from it and left alone maps to this, not to the event, so the engine
    /// compares with this to tell an edit from what the mapping drops.
    /// </summary>
    public static EventData AsTaskHolds(EventData data, string zone) =>
        EventOf(TaskFieldsOf(data, zone), data.Marker ?? NoMarker, zone)! with { Marker = data.Marker };

    private static readonly EventMarker NoMarker = new("", "");

    /// <summary>
    /// Whether <paramref name="day"/> is one of the series' occurrences (its start, or a date its rule
    /// reaches, not left out). A repeating task moved on to such a day was completed, not rescheduled,
    /// and its calendar series is left alone (spec: Repeating tasks).
    /// </summary>
    public static bool IsOccurrence(EventData series, string day)
    {
        if (Recurrence.Parse(series.RRule) is not { } rule) return false;
        var target = DayOf(day);
        var first = DayOf(series.Start.Value);
        if (target < first) return false;
        if ((series.ExDates ?? []).Any(each => DayOf(each.Value) == target)) return false;
        var date = first;
        while (date < target)
        {
            if (rule.NextOccurrence(first, date) is not { } next) return false;
            date = next;
        }
        return date == target;
    }

    /// <summary>
    /// Whether two rules are the same series, the second perhaps further along: a task that moves on
    /// counts down its COUNT and drops skips it has passed, which changes its rule's text but not the
    /// series on the calendar.
    /// </summary>
    public static bool SameSeries(string? a, string? b)
    {
        var left = Recurrence.Parse(a);
        var right = Recurrence.Parse(b);
        if (left is null || right is null) return left is null && right is null;
        return (left with { Count = null, Skip = null }).Format() == (right with { Count = null, Skip = null }).Format()
            && (left.Count is null) == (right.Count is null);
    }

    /// <summary>The day an event or a task's date falls on (<c>2026-11-03</c>).</summary>
    public static string Day(CalendarTime moment) => moment.Value[..10];

    /// <summary>A task's date: its schedule, or its due date when it has none.</summary>
    private static (string Start, string? End, bool AllDay, string? TimeZone)? When(JsonObject task)
    {
        if (task["schedule"] is JsonObject schedule && (string?)schedule["start"] is { } start)
        {
            return (start, (string?)schedule["end"], (bool?)schedule["allDay"] ?? false, (string?)schedule["timeZone"]);
        }
        if (task["due"] is JsonObject due && (string?)due["at"] is { } at)
        {
            return (at, null, (bool?)due["allDay"] ?? false, (string?)due["timeZone"]);
        }
        return null;
    }

    /// <summary>
    /// A task's rule as the calendar takes it: skips become EXDATEs. A rule counted from completion
    /// has no calendar form, so the task goes over as a single event that moves when it moves on.
    /// </summary>
    private static (string? RRule, IReadOnlyList<CalendarTime>? ExDates) RuleOf(string? recurrence, CalendarTime start)
    {
        if (Recurrence.Parse(recurrence) is not { FromCompletion: false } rule) return (null, null);
        var exDates = (rule.Skip ?? [])
            .Select(day => start.IsDate ? CalendarTime.Date(day) : CalendarTime.Local($"{day}{start.Value[10..]}", start.TimeZone))
            .ToList();
        return ((rule with { Skip = null }).Format(), exDates.Count > 0 ? exDates : null);
    }

    /// <summary>An event's rule as a task's: EXDATEs become skips. A rule the task cannot keep maps to none.</summary>
    private static string? RecurrenceOf(EventData data)
    {
        if (Recurrence.Parse(data.RRule) is not { FromCompletion: false } rule) return null;
        var skips = (data.ExDates ?? []).Select(Day).Distinct(StringComparer.Ordinal).Order(StringComparer.Ordinal).ToList();
        return (rule with { Skip = skips.Count > 0 ? skips : null }).Format();
    }

    /// <summary>An end given in another zone than the start's, as a local time in the start's.</summary>
    private static DateTime InZone(CalendarTime end, string timeZone, string zone)
    {
        var local = LocalOf(end.Value);
        var from = end.TimeZone ?? zone;
        if (from == timeZone) return local;
        try
        {
            var instant = TimeZoneInfo.ConvertTimeToUtc(DateTime.SpecifyKind(local, DateTimeKind.Unspecified), TimeZoneInfo.FindSystemTimeZoneById(from));
            return TimeZoneInfo.ConvertTimeFromUtc(instant, TimeZoneInfo.FindSystemTimeZoneById(timeZone));
        }
        catch (Exception error) when (error is TimeZoneNotFoundException or InvalidTimeZoneException)
        {
            // A zone this server does not know: the end read as written, rather than a run that fails every time.
            return local;
        }
    }

    private static bool IsDay(string text) => text.Length == 10;

    private static DateOnly DayOf(string text) => DateOnly.ParseExact(text[..10], "yyyy-MM-dd", CultureInfo.InvariantCulture);

    private static string DayText(DateOnly day) => day.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    private static DateTime LocalOf(string text) =>
        DateTime.ParseExact(text, ["yyyy-MM-dd'T'HH:mm", "yyyy-MM-dd'T'HH:mm:ss"], CultureInfo.InvariantCulture, DateTimeStyles.None);

    /// <summary>Seconds only when they are not zero, as the port writes times.</summary>
    private static string LocalText(DateTime local) =>
        local.ToString(local.Second == 0 ? "yyyy-MM-dd'T'HH:mm" : "yyyy-MM-dd'T'HH:mm:ss", CultureInfo.InvariantCulture);
}
