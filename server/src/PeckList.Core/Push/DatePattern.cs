using System.Globalization;
using System.Text.RegularExpressions;

namespace PeckList.Core.Push;

/// <summary>
/// A date in the pattern a person picked under Settings &gt; Dates (settings' <c>dateFormat</c>), as
/// the app shows it (web/src/core/dateFormat.ts, kept the same): the tokens people know from ISO 8601
/// and moment.js, in either case where that is not ambiguous. YYYY 2026, YY 26, MMMM October, MMM Oct,
/// MM 10, M 10, DD 05, D 5, dddd Monday, ddd Mon; text in [brackets] shows as is, anything else (- / .
/// , spaces) too. Names in English, as the rest of what the server sends.
/// </summary>
public static partial class DatePattern
{
    /// <summary>The language's own format (the default): no pattern.</summary>
    public const string Auto = "auto";

    /// <summary>The longest pattern a person may type.</summary>
    public const int MaxLength = 40;

    // Longest first, so MMMM is not read as MM MM, and dddd (a weekday) before dd (a day).
    [GeneratedRegex(@"\[[^\]]*\]|YYYY|yyyy|YY|yy|MMMM|MMM|MM|M|dddd|ddd|EEEE|EEE|DD|dd|D|d")]
    private static partial Regex Tokens();

    /// <summary>Whether a pattern can be used: not too long, and showing at least one part of a date.</summary>
    public static bool IsPattern(string? pattern) =>
        pattern is { Length: > 0 and <= MaxLength } && Tokens().Matches(pattern).Any(match => !match.Value.StartsWith('['));

    /// <summary>The person's pattern from their settings, or null for the automatic style (or none, or one that cannot be used).</summary>
    public static string? Of(string? dateFormat) => dateFormat is not null && dateFormat != Auto && IsPattern(dateFormat) ? dateFormat : null;

    /// <summary><paramref name="date"/> in <paramref name="pattern"/>.</summary>
    public static string Format(DateOnly date, string pattern)
    {
        var names = CultureInfo.InvariantCulture.DateTimeFormat;
        return Tokens().Replace(pattern, match => match.Value switch
        {
            "YYYY" or "yyyy" => date.Year.ToString(CultureInfo.InvariantCulture),
            "YY" or "yy" => (date.Year % 100).ToString("00", CultureInfo.InvariantCulture),
            "MMMM" => names.GetMonthName(date.Month),
            "MMM" => names.GetAbbreviatedMonthName(date.Month),
            "MM" => date.Month.ToString("00", CultureInfo.InvariantCulture),
            "M" => date.Month.ToString(CultureInfo.InvariantCulture),
            "dddd" or "EEEE" => names.GetDayName(date.DayOfWeek),
            "ddd" or "EEE" => names.GetAbbreviatedDayName(date.DayOfWeek),
            "DD" or "dd" => date.Day.ToString("00", CultureInfo.InvariantCulture),
            "D" or "d" => date.Day.ToString(CultureInfo.InvariantCulture),
            // [literal text]
            var literal => literal[1..^1],
        });
    }
}
