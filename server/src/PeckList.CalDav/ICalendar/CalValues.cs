using System.Globalization;
using System.Text.RegularExpressions;

namespace PeckList.CalDav.ICalendar;

/// <summary>DATE, DATE-TIME, DURATION and UTC-OFFSET values (RFC 5545 3.3).</summary>
public static partial class CalValues
{
    private static readonly CultureInfo Invariant = CultureInfo.InvariantCulture;

    /// <summary>
    /// A DATE (<c>20261127</c>) or DATE-TIME (<c>20261127T090000</c>, with a trailing <c>Z</c> for
    /// UTC). Returns the clock reading, whether it was a date, and whether it was UTC.
    /// </summary>
    public static (DateTime Value, bool IsDate, bool IsUtc) ParseDateTime(string text)
    {
        var value = text.Trim();
        if (value.Length == 8 && DateTime.TryParseExact(value, "yyyyMMdd", Invariant, DateTimeStyles.None, out var day))
            return (day, true, false);
        var utc = value.EndsWith('Z') || value.EndsWith('z');
        if (utc) value = value[..^1];
        // Seconds are required by the RFC; a few writers leave them out.
        if (DateTime.TryParseExact(value, ["yyyyMMdd'T'HHmmss", "yyyyMMdd'T'HHmm"], Invariant, DateTimeStyles.None, out var at))
            return (at, false, utc);
        throw new CalendarFormatException("not a date or date-time");
    }

    /// <summary>
    /// A clock reading moved by <paramref name="span"/>. A sum outside the calendar (an event at the
    /// end of year 9999 with a long DURATION, a year-1 time less a zone offset) is a format error,
    /// not a crash.
    /// </summary>
    public static DateTime Add(DateTime value, TimeSpan span)
    {
        var ticks = value.Ticks + span.Ticks;
        if (ticks < DateTime.MinValue.Ticks || ticks > DateTime.MaxValue.Ticks || (span.Ticks > 0 && ticks < value.Ticks) || (span.Ticks < 0 && ticks > value.Ticks))
            throw new CalendarFormatException("a time outside the calendar");
        return new DateTime(ticks, value.Kind);
    }

    /// <summary>A day moved by <paramref name="days"/>, with the same refusal as <see cref="Add"/>.</summary>
    public static DateOnly AddDays(DateOnly day, long days)
    {
        var number = day.DayNumber + days;
        if (number < DateOnly.MinValue.DayNumber || number > DateOnly.MaxValue.DayNumber)
            throw new CalendarFormatException("a day outside the calendar");
        return DateOnly.FromDayNumber((int)number);
    }

    /// <summary>A DATE value.</summary>
    public static string FormatDate(DateOnly date) => date.ToString("yyyyMMdd", Invariant);

    /// <summary>A DATE-TIME value, with <c>Z</c> when <paramref name="utc"/>.</summary>
    public static string FormatDateTime(DateTime local, bool utc = false) =>
        local.ToString("yyyyMMdd'T'HHmmss", Invariant) + (utc ? "Z" : "");

    /// <summary>An instant as a UTC DATE-TIME (DTSTAMP, LAST-MODIFIED, time-range filters).</summary>
    public static string FormatUtc(DateTimeOffset instant) => FormatDateTime(instant.UtcDateTime, utc: true);

    /// <summary>The longest DURATION read: far longer than any event, short enough to add to any date safely.</summary>
    public static readonly TimeSpan MaxDuration = TimeSpan.FromDays(366 * 100);

    /// <summary>A DURATION (<c>PT30M</c>, <c>P1D</c>, <c>-P1W</c>), at most <see cref="MaxDuration"/> either way.</summary>
    public static TimeSpan ParseDuration(string text)
    {
        var match = DurationPattern().Match(text.Trim());
        if (!match.Success) throw new CalendarFormatException("not a duration");
        // Each part is at most nine digits (the pattern), so the sum in seconds fits a long.
        static long Part(Group group) => group.Success ? long.Parse(group.Value, Invariant) : 0;
        var seconds = (Part(match.Groups["w"]) * 7 + Part(match.Groups["d"])) * 86_400
            + Part(match.Groups["h"]) * 3_600 + Part(match.Groups["m"]) * 60 + Part(match.Groups["s"]);
        if (seconds > (long)MaxDuration.TotalSeconds) throw new CalendarFormatException("a duration too long to be an event");
        var span = TimeSpan.FromSeconds(seconds);
        return match.Groups["sign"].Value == "-" ? -span : span;
    }

    /// <summary>A UTC-OFFSET (<c>-0600</c>, <c>+0530</c>, <c>+013045</c>).</summary>
    public static TimeSpan ParseOffset(string text)
    {
        var match = OffsetPattern().Match(text.Trim());
        if (!match.Success) throw new CalendarFormatException("not a UTC offset");
        var span = new TimeSpan(int.Parse(match.Groups["h"].Value, Invariant), int.Parse(match.Groups["m"].Value, Invariant),
            match.Groups["s"].Success ? int.Parse(match.Groups["s"].Value, Invariant) : 0);
        return match.Groups["sign"].Value == "-" ? -span : span;
    }

    /// <summary>A UTC-OFFSET value.</summary>
    public static string FormatOffset(TimeSpan offset)
    {
        var sign = offset < TimeSpan.Zero ? "-" : "+";
        var abs = offset.Duration();
        return sign + abs.Hours.ToString("00", Invariant) + abs.Minutes.ToString("00", Invariant)
            + (abs.Seconds != 0 ? abs.Seconds.ToString("00", Invariant) : "");
    }

    [GeneratedRegex(@"^(?<sign>[+-])?P(?:(?<w>\d{1,9})W)?(?:(?<d>\d{1,9})D)?(?:T(?:(?<h>\d{1,9})H)?(?:(?<m>\d{1,9})M)?(?:(?<s>\d{1,9})S)?)?$", RegexOptions.CultureInvariant)]
    private static partial Regex DurationPattern();

    [GeneratedRegex(@"^(?<sign>[+-])(?<h>\d\d)(?<m>\d\d)(?<s>\d\d)?$", RegexOptions.CultureInvariant)]
    private static partial Regex OffsetPattern();
}
