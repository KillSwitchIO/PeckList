using System.Globalization;
using System.Text.Json;
using PeckList.Core.Tasks;

namespace PeckList.Core.Calendars;

/// <summary>One occurrence of a shown event in a range (spec: PL-134, decision 2).</summary>
/// <param name="Occurrence">The day this occurrence starts, as the series has it (an override's original day).</param>
/// <param name="Recurring">It belongs to a repeating series: read-only in PeckList this batch (Q4).</param>
public sealed record ShownEvent(string LinkId, string EventId, string Occurrence, EventData Data, bool Recurring);

/// <summary>What a person ticked on a shown event: the whole event, or some occurrences by day.</summary>
public sealed record HiddenMarks(bool All, IReadOnlyList<string> Days)
{
    private static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web);

    /// <summary>Nothing hidden.</summary>
    public static readonly HiddenMarks None = new(false, []);

    /// <summary>The marks as stored, or none.</summary>
    public static HiddenMarks Read(string? json) =>
        json is null ? None : JsonSerializer.Deserialize<HiddenMarks>(json, Options) ?? None;

    /// <summary>As stored.</summary>
    public string Write() => JsonSerializer.Serialize(this, Options);

    /// <summary>With one occurrence hidden, or the whole event when <paramref name="day"/> is null.</summary>
    public HiddenMarks Hide(string? day) =>
        day is null ? this with { All = true } : this with { Days = [.. Days.Append(day).Distinct(StringComparer.Ordinal).Order(StringComparer.Ordinal)] };

    /// <summary>Whether the occurrence on <paramref name="day"/> is hidden.</summary>
    public bool Hides(string day) => All || Days.Contains(day, StringComparer.Ordinal);
}

/// <summary>
/// Shown events expanded into the occurrences that touch a range of days: repeating events by their
/// rule (with <see cref="Recurrence"/>, as tasks repeat), exceptions left out, moved occurrences in
/// their new place, hidden ones gone.
/// </summary>
public static class CalendarOccurrences
{
    /// <summary>The most days one request may ask for.</summary>
    public const int MaxDays = 62;

    private const int MaxSteps = 5000;

    /// <summary>
    /// The most rule steps one link may take in one request, all its series together (Security N4): a
    /// calendar of thousands of repeating events must not make every read of the events cost seconds.
    /// Enough for dozens of daily series running for years.
    /// </summary>
    public const int MaxStepsPerLink = 200_000;

    /// <summary>The most occurrences one link shows in one request (Security N4); the earliest are kept.</summary>
    public const int MaxShownPerLink = 2000;

    /// <summary>The occurrences of a link's items from <paramref name="from"/> to <paramref name="to"/>, both included, by start.</summary>
    public static IReadOnlyList<ShownEvent> Expand(string linkId, IEnumerable<CalendarItem> items, DateOnly from, DateOnly to) =>
        Expand(linkId, items, from, to, out _);

    /// <summary>
    /// As <see cref="Expand(string, IEnumerable{CalendarItem}, DateOnly, DateOnly)"/>, within
    /// <see cref="MaxStepsPerLink"/> and <see cref="MaxShownPerLink"/>; <paramref name="truncated"/> says
    /// whether either cut something off.
    /// </summary>
    public static IReadOnlyList<ShownEvent> Expand(string linkId, IEnumerable<CalendarItem> items, DateOnly from, DateOnly to, out bool truncated)
    {
        var budget = new int[] { MaxStepsPerLink };
        var stored = items.Select(item => (Event: CalendarJson.ReadEvent(item.EventJson), Hidden: HiddenMarks.Read(item.HiddenJson))).ToList();
        var overrides = stored.Where(each => each.Event.SeriesId is not null && each.Event.OriginalStart is not null)
            .ToLookup(each => each.Event.SeriesId!, StringComparer.Ordinal);
        var masters = stored.Where(each => each.Event.SeriesId is null && !each.Event.Cancelled).ToList();
        var masterIds = masters.Select(each => each.Event.Id).ToHashSet(StringComparer.Ordinal);
        var shown = new List<ShownEvent>();

        foreach (var (remote, hidden) in masters)
        {
            if (hidden.All) continue;
            var data = remote.Data;
            var recurring = data.RRule is not null;
            var moved = overrides[remote.Id].ToDictionary(each => Day(each.Event.OriginalStart!), each => each, StringComparer.Ordinal);
            var excluded = (data.ExDates ?? []).Select(Day).ToHashSet(StringComparer.Ordinal);
            var first = DayOf(Day(data.Start));
            foreach (var day in Days(data, first, to, budget))
            {
                var text = DayText(day);
                if (excluded.Contains(text) || hidden.Hides(text)) continue;
                if (moved.TryGetValue(text, out var single))
                {
                    if (!single.Event.Cancelled && !single.Hidden.All && Touches(single.Event.Data, from, to))
                    {
                        shown.Add(new ShownEvent(linkId, single.Event.Id, text, single.Event.Data, true));
                    }
                    continue;
                }
                var shifted = Shift(data, day.DayNumber - first.DayNumber);
                if (Touches(shifted, from, to)) shown.Add(new ShownEvent(linkId, remote.Id, text, shifted, recurring));
            }
        }
        // A moved occurrence whose series is not here (outside what the calendar lists): on its own.
        foreach (var (remote, hidden) in stored.Where(each => each.Event.SeriesId is { } series && !masterIds.Contains(series)))
        {
            if (remote.Cancelled || hidden.All || !Touches(remote.Data, from, to)) continue;
            shown.Add(new ShownEvent(linkId, remote.Id, Day(remote.OriginalStart ?? remote.Data.Start), remote.Data, true));
        }
        var ordered = shown.OrderBy(each => each.Data.Start.Value, StringComparer.Ordinal).ThenBy(each => each.EventId, StringComparer.Ordinal).ToList();
        truncated = budget[0] <= 0 || ordered.Count > MaxShownPerLink;
        return ordered.Count > MaxShownPerLink ? ordered[..MaxShownPerLink] : ordered;
    }

    /// <summary>The days a series starts on, up to <paramref name="to"/>: the first only when it does not repeat (or its rule is not one we read).</summary>
    private static IEnumerable<DateOnly> Days(EventData data, DateOnly first, DateOnly to, int[] budget)
    {
        if (budget[0] <= 0) yield break;
        if (Recurrence.Parse(data.RRule) is not { } rule)
        {
            budget[0]--;
            yield return first;
            yield break;
        }
        DateOnly? until = rule.Until is { } text ? DayOf(text) : null;
        var date = first;
        for (var count = 1; count <= MaxSteps && date <= to; count++)
        {
            if (--budget[0] < 0) yield break;
            if (rule.Count is { } limit && count > limit) yield break;
            if (until is { } end && date > end) yield break;
            yield return date;
            if (rule.NextOccurrence(first, date) is not { } next) yield break;
            date = next;
        }
    }

    /// <summary>Whether an event's days meet the range (an all-day end is the day after).</summary>
    private static bool Touches(EventData data, DateOnly from, DateOnly to)
    {
        var start = DayOf(Day(data.Start));
        var last = data.End is not { } end ? start
            : data.AllDay ? DayOf(Day(end)).AddDays(-1)
            : end.Value.Length > 10 && end.Value[11..].StartsWith("00:00", StringComparison.Ordinal) && DayOf(Day(end)) > start ? DayOf(Day(end)).AddDays(-1)
            : DayOf(Day(end));
        if (last < start) last = start;
        return start <= to && last >= from;
    }

    private static EventData Shift(EventData data, int days) => days == 0 ? data : data with
    {
        Start = Shift(data.Start, days),
        End = data.End is { } end ? Shift(end, days) : null,
    };

    private static CalendarTime Shift(CalendarTime moment, int days) =>
        moment with { Value = DayText(DayOf(Day(moment)).AddDays(days)) + moment.Value[10..] };

    private static string Day(CalendarTime moment) => moment.Value[..10];

    private static DateOnly DayOf(string text) => DateOnly.ParseExact(text[..10], "yyyy-MM-dd", CultureInfo.InvariantCulture);

    private static string DayText(DateOnly day) => day.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
}
