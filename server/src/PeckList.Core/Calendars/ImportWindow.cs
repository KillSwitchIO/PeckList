using System.Globalization;
using PeckList.Core.Tasks;

namespace PeckList.Core.Calendars;

/// <summary>
/// Which of a calendar's events become tasks when it syncs with a tag (spec: PL-134, decision 8, Ben
/// 2026-11-27): events from today on, and only the person's own. Every run applies it, the first and
/// the later ones, and the import preview counts by the same rule. Tasks still go to the calendar
/// whatever their date: the window limits only the calendar's side.
/// </summary>
public static class ImportWindow
{
    /// <summary>
    /// The most days looked at for one series, all its occurrences together (about thirty years).
    /// Past it the series is taken to go on unless its UNTIL has passed: the calendar's server decides
    /// what a listed rule says, and one event must not hold a run or a preview.
    /// </summary>
    internal const int MostDays = 366 * 30;

    /// <summary>Today in <paramref name="zone"/> (an IANA name; UTC when the server doesn't know it).</summary>
    public static DateOnly Today(DateTimeOffset now, string zone) => DateOnly.FromDateTime(InZone(now, zone).DateTime);

    /// <summary>
    /// Whether an event with no task of its own becomes one: the person's own (not
    /// <see cref="RemoteEvent.Foreign"/>), a whole event rather than one moved occurrence, and
    /// <see cref="InWindow"/>.
    /// </summary>
    public static bool Importable(RemoteEvent remote, DateOnly today, string zone) =>
        !remote.Foreign && remote.SeriesId is null && !remote.Cancelled && InWindow(remote.Data, today, zone);

    /// <summary>
    /// Whether an event starts today or later in the person's zone (one that started earlier today
    /// still counts), or for a repeating one, whether it still has an occurrence today or later.
    /// </summary>
    public static bool InWindow(EventData data, DateOnly today, string zone)
    {
        if (data.RRule is null) return StartDay(data.Start, zone) >= today;
        if (DayOf(data.Start.Value) >= today) return true;
        // A rule a task can't read (an unknown FREQ), or one not told within the days looked at, is
        // taken to go on unless its UNTIL has passed.
        return FirstFrom(data, today, out _, out _) ?? (UntilOf(data.RRule) is not { } until || until >= today);
    }

    /// <summary>
    /// A series that began before today as its task starts: on its first occurrence from today on,
    /// with its COUNT less the occurrences passed (left-out ones too) and the left-out days before it
    /// dropped, as completing a repeating task moves it on (spec: PL-134, decision 8). The calendar's
    /// series is left as it is: a task on a later occurrence of it reads as moved on, not as an edit.
    /// Anything else, and a series whose next occurrence can't be told, comes back as it is.
    /// </summary>
    public static EventData Onward(EventData data, DateOnly today)
    {
        if (data.RRule is null) return data;
        var first = DayOf(data.Start.Value);
        if (first >= today || FirstFrom(data, today, out var found, out var passed) != true) return data;
        var days = found.DayNumber - first.DayNumber;
        var rule = Recurrence.Parse(data.RRule)!;
        try
        {
            return data with
            {
                Start = Shifted(data.Start, days),
                End = data.End is { } end ? Shifted(end, days) : null,
                RRule = rule.Count is { } count ? (rule with { Count = count - passed }).Format() : data.RRule,
                ExDates = data.ExDates?.Where(each => DayOf(each.Value) >= found).ToList(),
            };
        }
        catch (Exception error) when (error is ArgumentOutOfRangeException or OverflowException)
        {
            // An end so far out that moving it passes the last date there is: the task keeps the
            // event's own dates rather than failing the run every time.
            return data;
        }
    }

    /// <summary>
    /// Whether a series began before <paramref name="day"/> and has no occurrence on or after it: cut
    /// short on the calendar (an UNTIL or a lower COUNT) before a task's own day.
    /// </summary>
    public static bool EndsBefore(EventData data, DateOnly day) =>
        data.RRule is not null && DayOf(data.Start.Value) < day && FirstFrom(data, day, out _, out _) == false;

    /// <summary>
    /// A series' first occurrence from today on: true with it, false when the series has ended, null
    /// when it can't be told (a rule a task can't read, or past the days looked at).
    /// <paramref name="passed"/> counts the occurrences before it, left-out ones too.
    /// </summary>
    private static bool? FirstFrom(EventData data, DateOnly today, out DateOnly found, out int passed)
    {
        found = default;
        passed = 0;
        if (Recurrence.Parse(data.RRule) is not { } rule) return null;
        var first = DayOf(data.Start.Value);
        var skipped = (data.ExDates ?? []).Select(each => DayOf(each.Value)).ToHashSet();
        var budget = MostDays;
        try
        {
            if (rule.Count is not { } most)
            {
                // Each occurrence stands on its own without a COUNT, so look from yesterday on.
                var after = today.AddDays(-1);
                while (rule.NextOccurrence(first, after, ref budget) is { } next)
                {
                    if (!skipped.Contains(next))
                    {
                        found = next;
                        return true;
                    }
                    after = next;
                }
                return budget <= 0 ? null : false;
            }
            // A COUNT counts from the start (left-out occurrences too), so walk it.
            var date = first;
            var count = 1;
            for (; date < today || skipped.Contains(date); count++)
            {
                if (count >= most) return false;
                if (rule.NextOccurrence(first, date, ref budget) is not { } next) return budget <= 0 ? null : false;
                date = next;
            }
            found = date;
            passed = count - 1;
            return true;
        }
        catch (Exception error) when (error is ArgumentOutOfRangeException or OverflowException)
        {
            // The next occurrence would fall past the last date there is: the series has ended.
            return false;
        }
    }

    /// <summary>A day or local time moved by whole days: the time of day and the zone stay.</summary>
    private static CalendarTime Shifted(CalendarTime time, int days) =>
        time with { Value = DayOf(time.Value).AddDays(days).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) + time.Value[10..] };

    /// <summary>The day an event starts on, as the person sees it: a timed start in another zone is moved into theirs.</summary>
    private static DateOnly StartDay(CalendarTime start, string zone)
    {
        if (start.IsDate) return DayOf(start.Value);
        var local = DateTime.ParseExact(start.Value, ["yyyy-MM-dd'T'HH:mm", "yyyy-MM-dd'T'HH:mm:ss"], CultureInfo.InvariantCulture, DateTimeStyles.None);
        if (start.TimeZone is not { } from || from == zone || Find(from) is not { } source) return DateOnly.FromDateTime(local);
        var instant = new DateTimeOffset(local, source.GetUtcOffset(local));
        return DateOnly.FromDateTime(InZone(instant, zone).DateTime);
    }

    private static DateTimeOffset InZone(DateTimeOffset instant, string zone) =>
        Find(zone) is { } found ? TimeZoneInfo.ConvertTime(instant, found) : instant.ToUniversalTime();

    private static TimeZoneInfo? Find(string zone) => TimeZoneInfo.TryFindSystemTimeZoneById(zone, out var found) ? found : null;

    private static DateOnly DayOf(string value) => DateOnly.ParseExact(value[..10], "yyyy-MM-dd", CultureInfo.InvariantCulture);

    private static DateOnly? UntilOf(string rule)
    {
        foreach (var part in rule.Split(';'))
        {
            var pair = part.Split('=', 2);
            if (pair.Length == 2 && pair[0].Trim().Equals("UNTIL", StringComparison.OrdinalIgnoreCase) && pair[1].Trim().Length >= 8
                && DateOnly.TryParseExact(pair[1].Trim()[..8], "yyyyMMdd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var until))
            {
                return until;
            }
        }
        return null;
    }
}
