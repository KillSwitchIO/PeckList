using System.Globalization;
using System.Text.RegularExpressions;

namespace Punchlist.Core.Tasks;

/// <summary>A weekday (0 Sunday) and, in a month or year, which one (1 first, -1 last).</summary>
public sealed record ByDay(int Weekday, int? Nth = null);

/// <summary>
/// Repeating tasks (spec: PL-060), worked out as the web app does (web/src/core/recurrence.ts):
/// RFC 5545 RRULE text on the task's local dates. Both pass the same fixtures
/// (schema/fixtures/recurrence), so a task completed from a notification moves where the app
/// would have moved it.
/// </summary>
public sealed partial record Recurrence(
    string Freq,
    int Interval,
    IReadOnlyList<ByDay>? ByDays = null,
    IReadOnlyList<int>? ByMonthDay = null,
    IReadOnlyList<int>? ByMonth = null,
    int? Count = null,
    string? Until = null,
    bool FromCompletion = false,
    IReadOnlyList<string>? Skip = null)
{
    private static readonly string[] DayCodes = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
    private static readonly string[] Freqs = ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"];

    /// <summary>Years, in days, to look ahead: enough for Feb 29 every four years at any interval.</summary>
    private const int LookAheadDays = 366 * 8;

    [GeneratedRegex("^([+-]?\\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$")]
    private static partial Regex DayPattern();

    [GeneratedRegex("^(\\d{4})(\\d{2})(\\d{2})")]
    private static partial Regex UntilPattern();

    [GeneratedRegex("^(\\d{4})(\\d{2})(\\d{2})$")]
    private static partial Regex SkipPattern();

    [GeneratedRegex("^RRULE:", RegexOptions.IgnoreCase)]
    private static partial Regex Prefix();

    /// <summary>A rule from RRULE text (with or without the "RRULE:" prefix), or null when it is not one we keep.</summary>
    public static Recurrence? Parse(string? text)
    {
        if (string.IsNullOrEmpty(text)) return null;
        var parts = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var part in Prefix().Replace(text, "").Split(';'))
        {
            var pieces = part.Split('=');
            if (pieces.Length < 2 || pieces[0].Length == 0) continue;
            parts[pieces[0].ToUpperInvariant()] = pieces[1].ToUpperInvariant();
        }
        var freq = parts.GetValueOrDefault("FREQ");
        if (freq is null || !Freqs.Contains(freq)) return null;
        var interval = parts.TryGetValue("INTERVAL", out var intervalText) ? Number(intervalText) : 1;
        if (interval is not { } every || every < 1) return null;
        IReadOnlyList<ByDay>? byDays = null;
        if (parts.GetValueOrDefault("BYDAY") is { Length: > 0 } byDayText)
        {
            var days = new List<ByDay>();
            foreach (var each in byDayText.Split(','))
            {
                var match = DayPattern().Match(each);
                if (!match.Success) return null;
                var weekday = Array.IndexOf(DayCodes, match.Groups[2].Value);
                days.Add(match.Groups[1].Success ? new ByDay(weekday, Number(match.Groups[1].Value)) : new ByDay(weekday));
            }
            byDays = days;
        }
        var byMonthDay = Numbers(parts, "BYMONTHDAY", day => day != 0 && day >= -31 && day <= 31, out var monthDaysOk);
        var byMonth = Numbers(parts, "BYMONTH", month => month >= 1 && month <= 12, out var monthsOk);
        if (!monthDaysOk || !monthsOk) return null;
        int? count = null;
        if (parts.GetValueOrDefault("COUNT") is { Length: > 0 } countText)
        {
            if (Number(countText) is not { } value || value < 1) return null;
            count = value;
        }
        string? until = null;
        if (parts.GetValueOrDefault("UNTIL") is { Length: > 0 } untilText)
        {
            var match = UntilPattern().Match(untilText);
            if (!match.Success) return null;
            until = $"{match.Groups[1].Value}-{match.Groups[2].Value}-{match.Groups[3].Value}";
        }
        List<string>? skip = null;
        if (parts.GetValueOrDefault("X-PL-SKIP") is { Length: > 0 } skipText)
        {
            var dates = new SortedSet<string>(StringComparer.Ordinal);
            foreach (var each in skipText.Split(','))
            {
                var match = SkipPattern().Match(each);
                if (!match.Success) return null;
                dates.Add($"{match.Groups[1].Value}-{match.Groups[2].Value}-{match.Groups[3].Value}");
            }
            skip = [.. dates];
        }
        return new Recurrence(freq, every, byDays, byMonthDay, byMonth, count, until,
            parts.GetValueOrDefault("X-PL-FROM") == "COMPLETION", skip);
    }

    /// <summary>RRULE text for the rule (in a stable order, so the same rule is the same text).</summary>
    public string Format()
    {
        var parts = new List<string> { $"FREQ={Freq}" };
        if (Interval != 1) parts.Add($"INTERVAL={Interval}");
        if (ByDays is { Count: > 0 })
        {
            parts.Add("BYDAY=" + string.Join(',', ByDays.Select(day => (day.Nth?.ToString(CultureInfo.InvariantCulture) ?? "") + DayCodes[day.Weekday])));
        }
        if (ByMonthDay is { Count: > 0 }) parts.Add("BYMONTHDAY=" + string.Join(',', ByMonthDay));
        if (ByMonth is { Count: > 0 }) parts.Add("BYMONTH=" + string.Join(',', ByMonth));
        if (Count is { } count) parts.Add($"COUNT={count}");
        if (!string.IsNullOrEmpty(Until)) parts.Add("UNTIL=" + Until.Replace("-", ""));
        if (FromCompletion) parts.Add("X-PL-FROM=COMPLETION");
        if (Skip is { Count: > 0 }) parts.Add("X-PL-SKIP=" + string.Join(',', Skip.Select(date => date.Replace("-", ""))));
        return string.Join(';', parts);
    }

    /// <summary>
    /// Where a repeating task goes next when one occurrence is done: its next date, and the rule
    /// to keep (COUNT less the occurrences passed, skipped ones too; skips before the new date
    /// dropped), or null when this was the last.
    /// </summary>
    public (DateOnly Date, Recurrence Rule)? Advance(DateOnly current, DateOnly doneOn)
    {
        var skipped = new HashSet<string>(Skip ?? [], StringComparer.Ordinal);
        var left = Count;
        var date = current;
        do
        {
            if (left is <= 1) return null;
            DateOnly? next = FromCompletion ? NextFromCompletion(date == current ? doneOn : date) : NextOccurrence(current, date);
            if (next is not { } found || (UntilDate is { } until && found > until)) return null;
            date = found;
            if (left is { } count) left = count - 1;
        }
        while (skipped.Contains(Text(date)));
        var later = (Skip ?? []).Where(each => string.CompareOrdinal(each, Text(date)) > 0).ToList();
        return (date, this with { Count = left, Skip = later.Count > 0 ? later : null });
    }

    private static string Text(DateOnly date) => date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    /// <summary>The date after <paramref name="after"/> the series falls on, counted from <paramref name="start"/>.</summary>
    public DateOnly? NextOccurrence(DateOnly start, DateOnly after)
    {
        var limit = LookAheadDays * Interval;
        var date = after.AddDays(1);
        for (var step = 0; step < limit; step++, date = date.AddDays(1))
        {
            if (UntilDate is { } until && date > until) return null;
            if (date >= start && Matches(start, date)) return date;
        }
        return null;
    }

    /// <summary>"Every interval units" counted from the day it was done (TickTick's from-completion).</summary>
    public DateOnly NextFromCompletion(DateOnly done) => Freq switch
    {
        "DAILY" => done.AddDays(Interval),
        "WEEKLY" => done.AddDays(Interval * 7),
        "MONTHLY" => Clamped(done.Year, done.Month - 1 + Interval, done.Day),
        _ => Clamped(done.Year + Interval, done.Month - 1, done.Day),
    };

    private DateOnly? UntilDate =>
        string.IsNullOrEmpty(Until) ? null : DateOnly.ParseExact(Until, "yyyy-MM-dd", CultureInfo.InvariantCulture);

    /// <summary>A day in month <paramref name="monthIndex"/> (0-based, may run past December), kept within the month.</summary>
    private static DateOnly Clamped(int year, int monthIndex, int day)
    {
        var y = year + monthIndex / 12;
        var m = monthIndex % 12 + 1;
        return new DateOnly(y, m, Math.Min(day, DateTime.DaysInMonth(y, m)));
    }

    /// <summary>Whether <paramref name="date"/> is an occurrence of the series that <paramref name="start"/> is one of.</summary>
    private bool Matches(DateOnly start, DateOnly date)
    {
        var day = (int)date.DayOfWeek;
        var inMonth = DateTime.DaysInMonth(date.Year, date.Month);
        bool DayFits()
        {
            if (ByDays is null) return false;
            var first = (date.Day + 6) / 7;
            var last = -((inMonth - date.Day + 1 + 6) / 7);
            return ByDays.Any(each => each.Weekday == day && (each.Nth is not { } nth || nth == first || nth == last));
        }
        bool MonthDayFits() =>
            ByMonthDay is not null && ByMonthDay.Any(each => each > 0 ? each == date.Day : inMonth + each + 1 == date.Day);
        switch (Freq)
        {
            case "DAILY":
                return (date.DayNumber - start.DayNumber) % Interval == 0 && (ByDays is null || DayFits());
            case "WEEKLY":
            {
                var weeks = (WeekOf(date).DayNumber - WeekOf(start).DayNumber) / 7;
                if (weeks % Interval != 0) return false;
                return ByDays is { Count: > 0 } ? DayFits() : day == (int)start.DayOfWeek;
            }
            case "MONTHLY":
            {
                var months = (date.Year - start.Year) * 12 + (date.Month - start.Month);
                if (months % Interval != 0) return false;
                if (ByMonthDay is { Count: > 0 }) return MonthDayFits();
                if (ByDays is { Count: > 0 }) return DayFits();
                return date.Day == start.Day;
            }
            default:
                if ((date.Year - start.Year) % Interval != 0) return false;
                if (!(ByMonth ?? [start.Month]).Contains(date.Month)) return false;
                if (ByMonthDay is { Count: > 0 }) return MonthDayFits();
                if (ByDays is { Count: > 0 }) return DayFits();
                return date.Day == start.Day;
        }
    }

    /// <summary>RFC 5545 weeks start on Monday unless WKST says otherwise.</summary>
    private static DateOnly WeekOf(DateOnly date) => date.AddDays(-(((int)date.DayOfWeek + 6) % 7));

    /// <summary>A whole number as JavaScript's Number() reads one (blank is 0), or null.</summary>
    private static int? Number(string text)
    {
        var trimmed = text.Trim();
        if (trimmed.Length == 0) return 0;
        return double.TryParse(trimmed, NumberStyles.Float, CultureInfo.InvariantCulture, out var value)
            && value == Math.Floor(value) && Math.Abs(value) <= int.MaxValue ? (int)value : null;
    }

    /// <summary>A comma list of whole numbers that pass <paramref name="ok"/>: null when absent, <paramref name="valid"/> false when one does not.</summary>
    private static List<int>? Numbers(Dictionary<string, string> parts, string key, Func<int, bool> ok, out bool valid)
    {
        valid = true;
        if (parts.GetValueOrDefault(key) is not { Length: > 0 } text) return null;
        var list = new List<int>();
        foreach (var each in text.Split(','))
        {
            if (Number(each) is not { } value || !ok(value))
            {
                valid = false;
                return null;
            }
            list.Add(value);
        }
        return list;
    }
}
