using System.Text.RegularExpressions;

namespace PeckList.Core.Text;

/// <summary>
/// Whether a language tag is well-formed BCP 47 (RFC 5646), as Intl in browsers and the apps reads
/// tags. The workspace schema's pattern also lets through tags such as <c>en-12</c> (a region is two
/// letters or three digits), which made every date in the web app throw.
/// </summary>
public static partial class LanguageTags
{
    /// <summary>Whether <paramref name="tag"/> is well-formed BCP 47 (grandfathered tags aside).</summary>
    public static bool IsWellFormed(string tag)
    {
        if (!WellFormed().IsMatch(tag)) return false;
        // Nor may a variant or an extension's singleton come twice (Intl refuses de-1996-1996).
        var subtags = tag.ToLowerInvariant().Split('-');
        var privateUse = Array.IndexOf(subtags, "x");
        var variants = new HashSet<string>(StringComparer.Ordinal);
        var singletons = new HashSet<string>(StringComparer.Ordinal);
        var inExtension = false;
        foreach (var subtag in subtags.Take(privateUse < 0 ? subtags.Length : privateUse).Skip(1))
        {
            if (subtag.Length == 1)
            {
                if (!singletons.Add(subtag)) return false;
                inExtension = true;
            }
            else if (!inExtension && (subtag.Length >= 5 || (subtag.Length == 4 && char.IsAsciiDigit(subtag[0])))
                && !variants.Add(subtag))
            {
                return false;
            }
        }
        return true;
    }

    // language (extlang), script, region, variants, extensions, private use. Not private use alone,
    // which Intl refuses.
    [GeneratedRegex(
        @"\A(?:(?:[a-z]{2,3}(?:-[a-z]{3}){0,3}|[a-z]{4,8})(?:-[a-z]{4})?(?:-(?:[a-z]{2}|[0-9]{3}))?(?:-(?:[a-z0-9]{5,8}|[0-9][a-z0-9]{3}))*(?:-[0-9a-wy-z](?:-[a-z0-9]{2,8})+)*(?:-x(?:-[a-z0-9]{1,8})+)?)\z",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex WellFormed();
}
