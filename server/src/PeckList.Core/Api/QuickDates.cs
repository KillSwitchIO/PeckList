using System.Globalization;
using System.Text.RegularExpressions;

namespace PeckList.Core.Api;

/// <summary>A local day and, when the text gave one, a time (<c>HH:mm</c>).</summary>
public sealed record QuickMoment(string Date, string? Time)
{
    public string Value => Time is null ? Date : $"{Date}T{Time}";
}

/// <summary>A date (or a range) found in text: where it sits and what it means.</summary>
public sealed record QuickDateMatch(int Index, int Length, QuickMoment Start, QuickMoment? End);

/// <summary>
/// Dates in free text for quick add on the server (PL-137). The app uses chrono, which has no C#
/// twin; this reads the common English forms the same way, pinned by the shared fixtures
/// (<c>schema/fixtures/quick-add/cases.json</c>): today, tonight, tomorrow, weekdays (with this and
/// next), "in 3 days", "next week", month-name and numeric dates, times, and ranges. Dates in the
/// past move forward, as chrono's <c>forwardDate</c>. Anything else is not a date here.
/// </summary>
public static partial class QuickDates
{
    private const RegexOptions Options = RegexOptions.IgnoreCase | RegexOptions.CultureInvariant;
    private const int TimeoutMs = 200;

    private const string Weekday = "(?:sunday|sun|monday|mon|tuesday|tue|wednesday|wed|thursday|thurs|thur|thu|friday|fri|saturday|sat)";
    private const string Month = "(?:january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)";
    private const string Day = "(?:3[01]|[12][0-9]|0?[1-9])";
    private const string End = "(?![\\p{L}\\p{N}_])";

    [GeneratedRegex(@"\G(\d{4})[-/](\d{1,2})[-/](\d{1,2})" + End, Options, TimeoutMs)]
    private static partial Regex Iso();

    [GeneratedRegex(@"\G(\d{1,2})/(\d{1,2})(?:/(\d{4}))?(?![\p{L}\p{N}_/])", Options, TimeoutMs)]
    private static partial Regex Numeric();

    [GeneratedRegex(@"\G(" + Month + @")\.?\s+(" + Day + @")(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?" + End, Options, TimeoutMs)]
    private static partial Regex MonthDay();

    [GeneratedRegex(@"\G(" + Day + @")(?:st|nd|rd|th)?\s+(" + Month + @")\.?(?:,?\s+(\d{4}))?" + End, Options, TimeoutMs)]
    private static partial Regex DayMonth();

    [GeneratedRegex(@"\G(today|tomorrow|tmrw|tonight|yesterday)" + End, Options, TimeoutMs)]
    private static partial Regex DayWord();

    [GeneratedRegex(@"\Gin\s+(\d{1,3})\s+(days?|weeks?|months?)" + End, Options, TimeoutMs)]
    private static partial Regex InSome();

    [GeneratedRegex(@"\Gnext\s+(week|month)" + End, Options, TimeoutMs)]
    private static partial Regex NextUnit();

    [GeneratedRegex(@"\G(?:(this|next)\s+)?(" + Weekday + ")" + End, Options, TimeoutMs)]
    private static partial Regex WeekdayWord();

    [GeneratedRegex(@"\G(at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)(?![\p{L}\p{N}_])", Options, TimeoutMs)]
    private static partial Regex Meridiem();

    [GeneratedRegex(@"\G(at\s+)?(\d{1,2}):(\d{2})(?![\p{L}\p{N}_:])", Options, TimeoutMs)]
    private static partial Regex Clock();

    [GeneratedRegex(@"\G(at\s+)?(noon|midnight)" + End, Options, TimeoutMs)]
    private static partial Regex NamedTime();

    [GeneratedRegex(@"\G(at\s+)(\d{1,2})(?![\p{L}\p{N}_:])", Options, TimeoutMs)]
    private static partial Regex AtHour();

    [GeneratedRegex(@"\G(\d{1,2})(?::(\d{2}))?\s*-\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)" + End, Options, TimeoutMs)]
    private static partial Regex HourRange();

    [GeneratedRegex(@"\G(?:\s+to\s+|\s*-\s*)", Options, TimeoutMs)]
    private static partial Regex RangeWord();

    [GeneratedRegex(@"\G\s+", Options, TimeoutMs)]
    private static partial Regex Space();

    private static readonly string[] MonthNames = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    private static readonly string[] DayNames = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

    /// <summary>A time of day as read, and whether "at" came before it.</summary>
    private sealed record TimePart(int End, TimeOnly Value, bool At, int AtLength);

    /// <summary>Every date in <paramref name="text"/>, left to right, relative to the wall clock <paramref name="reference"/>.</summary>
    public static IReadOnlyList<QuickDateMatch> Find(string text, DateTime reference)
    {
        var found = new List<QuickDateMatch>();
        var today = DateOnly.FromDateTime(reference);
        var now = TimeOnly.FromDateTime(reference);
        var at = 0;
        while (at < text.Length)
        {
            var startsWord = at == 0 || !char.IsLetterOrDigit(text[at - 1]) && text[at - 1] != '_';
            if (!startsWord || char.IsWhiteSpace(text[at]) || Moment(text, at, today, now) is not { } match)
            {
                at++;
                continue;
            }
            found.Add(match);
            at = match.Index + match.Length;
        }
        return found;
    }

    /// <summary>A date, a time, or both, maybe followed by the end of a range, starting at <paramref name="at"/>.</summary>
    private static QuickDateMatch? Moment(string text, int at, DateOnly today, TimeOnly now)
    {
        int index = at, end;
        DateOnly date;
        TimeOnly? time = null;
        TimeOnly? rangeEnd = null;
        if (Date(text, at, today) is { } day)
        {
            (date, end) = (day.Date, day.End);
            if (Space().Match(text, end) is { Success: true } gap)
            {
                if (Hours(text, gap.Index + gap.Length) is { } hours)
                {
                    (time, rangeEnd, end) = (hours.From, hours.To, hours.End);
                }
                else if (Time(text, gap.Index + gap.Length) is { } said)
                {
                    (time, end) = (said.Value, said.End);
                }
            }
        }
        else if (Hours(text, at) is { } hours)
        {
            (time, rangeEnd, end) = (hours.From, hours.To, hours.End);
            date = hours.From < now ? today.AddDays(1) : today;
        }
        else if (Time(text, at) is { } said)
        {
            time = said.Value;
            end = said.End;
            date = said.Value < now ? today.AddDays(1) : today;
            // A date after the time ("10pm tomorrow"): chrono leaves a leading "at" out of the match.
            if (Space().Match(text, end) is { Success: true } gap && Date(text, gap.Index + gap.Length, today) is { } after)
            {
                date = after.Date;
                end = after.End;
                if (said.At) index += said.AtLength;
            }
        }
        else
        {
            return null;
        }

        var start = new QuickMoment(Iso(date), time is { } t ? Clock(t) : null);
        QuickMoment? finish = rangeEnd is { } until ? new QuickMoment(Iso(date), Clock(until)) : null;
        if (finish is null && RangeWord().Match(text, end) is { Success: true } joint)
        {
            var from = joint.Index + joint.Length;
            if (Date(text, from, today) is { } endDay)
            {
                var endTime = (TimeOnly?)null;
                var stop = endDay.End;
                if (Space().Match(text, stop) is { Success: true } gap && Time(text, gap.Index + gap.Length) is { } endSaid)
                {
                    endTime = endSaid.Value;
                    stop = endSaid.End;
                }
                finish = new QuickMoment(Iso(endDay.Date), endTime is { } e ? Clock(e) : null);
                end = stop;
            }
            else if (Time(text, from) is { } endSaid)
            {
                finish = new QuickMoment(Iso(date), Clock(endSaid.Value));
                end = endSaid.End;
            }
        }
        return new QuickDateMatch(index, end - index, start, finish);
    }

    private static (DateOnly Date, int End)? Date(string text, int at, DateOnly today)
    {
        Match m;
        if ((m = Iso().Match(text, at)).Success)
        {
            return Valid(Int(m, 1), Int(m, 2), Int(m, 3)) is { } date ? (date, m.Index + m.Length) : null;
        }
        if ((m = MonthDay().Match(text, at)).Success)
        {
            return OnDay(MonthOf(m.Groups[1].Value), Int(m, 2), m.Groups[3].Success ? Int(m, 3) : null, today) is { } date ? (date, m.Index + m.Length) : null;
        }
        if ((m = DayMonth().Match(text, at)).Success)
        {
            return OnDay(MonthOf(m.Groups[2].Value), Int(m, 1), m.Groups[3].Success ? Int(m, 3) : null, today) is { } date ? (date, m.Index + m.Length) : null;
        }
        if ((m = Numeric().Match(text, at)).Success)
        {
            return OnDay(Int(m, 1), Int(m, 2), m.Groups[3].Success ? Int(m, 3) : null, today) is { } date ? (date, m.Index + m.Length) : null;
        }
        if ((m = DayWord().Match(text, at)).Success)
        {
            var word = m.Groups[1].Value.ToLowerInvariant();
            var date = word switch { "tomorrow" or "tmrw" => today.AddDays(1), "yesterday" => today.AddDays(-1), _ => today };
            return (date, m.Index + m.Length);
        }
        if ((m = InSome().Match(text, at)).Success)
        {
            var count = Int(m, 1);
            var unit = m.Groups[2].Value.ToLowerInvariant().TrimEnd('s');
            var date = unit switch { "day" => today.AddDays(count), "week" => today.AddDays(7 * count), _ => today.AddMonths(count) };
            return (date, m.Index + m.Length);
        }
        if ((m = NextUnit().Match(text, at)).Success)
        {
            return (m.Groups[1].Value.Equals("week", StringComparison.OrdinalIgnoreCase) ? today.AddDays(7) : today.AddMonths(1), m.Index + m.Length);
        }
        if ((m = WeekdayWord().Match(text, at)).Success)
        {
            var wanted = Array.IndexOf(DayNames, m.Groups[2].Value[..3].ToLowerInvariant());
            var modifier = m.Groups[1].Success ? m.Groups[1].Value.ToLowerInvariant() : null;
            return (today.AddDays(DaysTo((int)today.DayOfWeek, wanted, modifier)), m.Index + m.Length);
        }
        return null;
    }

    /// <summary>
    /// Days from a weekday to a wanted one, as chrono counts them: a bare weekday or "this" is the
    /// next one on or after today; "next" is the one in the coming week.
    /// </summary>
    private static int DaysTo(int from, int wanted, string? modifier)
    {
        var forward = (wanted - from + 7) % 7;
        if (modifier != "next") return forward;
        if (from == 0) return wanted == 0 ? 7 : wanted;
        if (from == 6) return wanted == 6 ? 7 : wanted == 0 ? 8 : 1 + wanted;
        return wanted < from && wanted != 0 ? forward : forward + 7;
    }

    private static TimePart? Time(string text, int at)
    {
        Match m;
        if ((m = Meridiem().Match(text, at)).Success)
        {
            var hour = Int(m, 2);
            var minute = m.Groups[3].Success ? Int(m, 3) : 0;
            if (hour is < 1 or > 12 || minute > 59) return null;
            var pm = m.Groups[4].Value.StartsWith('p') || m.Groups[4].Value.StartsWith('P');
            return new TimePart(m.Index + m.Length, new TimeOnly(hour % 12 + (pm ? 12 : 0), minute), m.Groups[1].Success, m.Groups[1].Length);
        }
        if ((m = Clock().Match(text, at)).Success)
        {
            var hour = Int(m, 2);
            var minute = Int(m, 3);
            if (hour > 23 || minute > 59) return null;
            return new TimePart(m.Index + m.Length, new TimeOnly(hour, minute), m.Groups[1].Success, m.Groups[1].Length);
        }
        if ((m = NamedTime().Match(text, at)).Success)
        {
            var noon = m.Groups[2].Value.Equals("noon", StringComparison.OrdinalIgnoreCase);
            return new TimePart(m.Index + m.Length, new TimeOnly(noon ? 12 : 0, 0), m.Groups[1].Success, m.Groups[1].Length);
        }
        if ((m = AtHour().Match(text, at)).Success)
        {
            var hour = Int(m, 2);
            if (hour > 23) return null;
            return new TimePart(m.Index + m.Length, new TimeOnly(hour, 0), true, m.Groups[1].Length);
        }
        return null;
    }

    /// <summary>"9-11am", "3-5pm": two hours sharing one am or pm.</summary>
    private static (TimeOnly From, TimeOnly To, int End)? Hours(string text, int at)
    {
        var m = HourRange().Match(text, at);
        if (!m.Success) return null;
        var (fromHour, toHour) = (Int(m, 1), Int(m, 3));
        var (fromMinute, toMinute) = (m.Groups[2].Success ? Int(m, 2) : 0, m.Groups[4].Success ? Int(m, 4) : 0);
        if (fromHour is < 1 or > 12 || toHour is < 1 or > 12 || fromMinute > 59 || toMinute > 59) return null;
        var pm = m.Groups[5].Value.Equals("pm", StringComparison.OrdinalIgnoreCase) ? 12 : 0;
        return (new TimeOnly(fromHour % 12 + pm, fromMinute), new TimeOnly(toHour % 12 + pm, toMinute), m.Index + m.Length);
    }

    /// <summary>A month and day: in the year given, else this year, or next year once it has passed.</summary>
    private static DateOnly? OnDay(int month, int day, int? year, DateOnly today)
    {
        if (Valid(year ?? today.Year, month, day) is not { } date) return null;
        if (year is null && date < today) return Valid(today.Year + 1, month, day);
        return date;
    }

    private static DateOnly? Valid(int year, int month, int day) =>
        year is >= 1 and <= 9999 && month is >= 1 and <= 12 && day >= 1 && day <= DateTime.DaysInMonth(year, month) ? new DateOnly(year, month, day) : null;

    private static int MonthOf(string name) => Array.IndexOf(MonthNames, name[..3].ToLowerInvariant()) + 1;

    private static int Int(Match match, int group) => int.Parse(match.Groups[group].Value, CultureInfo.InvariantCulture);

    private static string Iso(DateOnly date) => date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    private static string Clock(TimeOnly time) => time.ToString("HH:mm", CultureInfo.InvariantCulture);
}
