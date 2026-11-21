using System.Globalization;
using System.Text.RegularExpressions;

namespace PeckList.Core.Text;

/// <summary>
/// The languages a device asks for, from an <c>Accept-Language</c> header: "de-DE,de;q=0.9,en;q=0.8"
/// gives de-DE, de, en. A Web Push subscription keeps them (PL-148), so a push in the person's
/// automatic language follows the browser it goes to.
/// </summary>
public static partial class AcceptLanguage
{
    /// <summary>The most languages kept from one header; anything past them is noise.</summary>
    public const int MaxTags = 8;

    /// <summary>The longest stored list (<see cref="Join"/>), so a header can't grow a column.</summary>
    public const int MaxLength = 120;

    /// <summary>
    /// The tags of <paramref name="header"/>, most wanted first (by q, then by place), without
    /// <c>*</c>, q=0, duplicates or anything that isn't a language tag.
    /// </summary>
    public static IReadOnlyList<string> Tags(string? header)
    {
        if (string.IsNullOrWhiteSpace(header)) return [];
        var found = new List<(string Tag, double Q, int Place)>();
        var place = 0;
        foreach (var part in header.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            var pieces = part.Split(';', StringSplitOptions.TrimEntries);
            var tag = pieces[0].Replace('_', '-');
            if (!Tag().IsMatch(tag)) continue;
            var q = 1.0;
            foreach (var parameter in pieces.Skip(1))
            {
                if (parameter.StartsWith("q=", StringComparison.OrdinalIgnoreCase)
                    && !double.TryParse(parameter[2..], NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out q))
                {
                    q = 0;
                }
            }
            if (q > 0) found.Add((tag, q, place++));
        }
        return [.. found.OrderByDescending(each => each.Q).ThenBy(each => each.Place)
            .Select(each => each.Tag).Distinct(StringComparer.OrdinalIgnoreCase).Take(MaxTags)];
    }

    /// <summary>Tags as one stored value, "de-DE,de,en", cut to whole tags within <see cref="MaxLength"/>; null for none.</summary>
    public static string? Join(IEnumerable<string> tags)
    {
        var kept = new List<string>();
        var length = 0;
        foreach (var tag in tags)
        {
            if (length + tag.Length + (kept.Count > 0 ? 1 : 0) > MaxLength) break;
            length += tag.Length + (kept.Count > 0 ? 1 : 0);
            kept.Add(tag);
        }
        return kept.Count == 0 ? null : string.Join(',', kept);
    }

    /// <summary>A stored value back into tags (it is itself a valid header).</summary>
    public static IReadOnlyList<string> Split(string? stored) => Tags(stored);

    [GeneratedRegex(@"^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8}){0,4}$")]
    private static partial Regex Tag();
}
