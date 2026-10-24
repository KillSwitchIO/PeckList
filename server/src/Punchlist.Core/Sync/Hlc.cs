using System.Text.RegularExpressions;

namespace Punchlist.Core.Sync;

/// <summary>
/// Hybrid logical clock timestamps: <c>&lt;ISO wall time&gt;-&lt;4-digit counter&gt;-&lt;node id&gt;</c>, e.g.
/// <c>2026-10-20T16:15:02.113Z-0001-dev7</c>. Fixed width up to the node id, so plain ordinal string
/// comparison orders them, as in web/src/core/hlc.ts.
/// </summary>
public static partial class Hlc
{
    [GeneratedRegex(@"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z-\d{4}-[A-Za-z0-9]{1,32}$")]
    private static partial Regex Pattern();

    public static bool IsValid(string? value) => value is not null && Pattern().IsMatch(value);

    /// <summary>Compare two HLCs; a missing one sorts before everything.</summary>
    public static int Compare(string? a, string? b) => Math.Sign(string.CompareOrdinal(a ?? "", b ?? ""));

    /// <summary>The wall time an HLC carries.</summary>
    public static DateTimeOffset WallTime(string value) =>
        DateTimeOffset.Parse(value[..24], System.Globalization.CultureInfo.InvariantCulture);
}
