using System.Text.RegularExpressions;

namespace PeckList.Core.Sync;

/// <summary>
/// Hybrid logical clock timestamps: <c>&lt;ISO wall time&gt;-&lt;4-digit counter&gt;-&lt;node id&gt;</c>, e.g.
/// <c>2026-10-20T16:15:02.113Z-0001-dev7</c>. Fixed width up to the node id, so plain ordinal string
/// comparison orders them, as in web/src/core/hlc.ts.
/// </summary>
public static partial class Hlc
{
    [GeneratedRegex(@"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z-\d{4}-[A-Za-z0-9]{1,32}$")]
    private static partial Regex Pattern();

    /// <summary>The format, and a wall time that is a real date (<c>2026-13-45</c> matches the pattern but is not).</summary>
    public static bool IsValid(string? value) =>
        value is not null && Pattern().IsMatch(value)
        && DateTimeOffset.TryParse(value[..24], System.Globalization.CultureInfo.InvariantCulture,
            System.Globalization.DateTimeStyles.AssumeUniversal, out _);

    /// <summary>Compare two HLCs; a missing one sorts before everything.</summary>
    public static int Compare(string? a, string? b) => Math.Sign(string.CompareOrdinal(a ?? "", b ?? ""));

    /// <summary>The wall time an HLC carries; <paramref name="value"/> must be <see cref="IsValid"/>.</summary>
    public static DateTimeOffset WallTime(string value) =>
        DateTimeOffset.Parse(value[..24], System.Globalization.CultureInfo.InvariantCulture);

    /// <summary>The counter an HLC carries (the four digits after the wall time).</summary>
    public static int Counter(string value) =>
        int.Parse(value.AsSpan(25, 4), System.Globalization.CultureInfo.InvariantCulture);

    /// <summary>The first stamp after <paramref name="value"/>, for <paramref name="node"/>.</summary>
    public static string After(string value, string node)
    {
        var wall = WallTime(value);
        var counter = Counter(value) + 1;
        if (counter > 9999)
        {
            wall = wall.AddMilliseconds(1);
            counter = 0;
        }
        var text = wall.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", System.Globalization.CultureInfo.InvariantCulture);
        return $"{text}-{counter:D4}-{node}";
    }
}
