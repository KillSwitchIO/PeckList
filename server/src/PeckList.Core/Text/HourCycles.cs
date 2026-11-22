using System.Text.Json;

namespace PeckList.Core.Text;

/// <summary>
/// Whether a language tag reads a 24-hour clock, as ICU (the browser's Intl, Android's own) has it:
/// what an automatic clock follows (schema 22), so a push reads the clock the app shows. .NET can't
/// say (the server runs with invariant globalization), and the region alone can't either: ICU takes
/// a locale's clock from its own data and falls back to the language's (fr-US is 24-hour, en-BR
/// 12-hour). The table (<c>hour-cycles.json</c>) is made from ICU by <c>scripts/hour-cycles.mjs</c>,
/// and the web app's tests fail when it no longer matches.
/// </summary>
public static class HourCycles
{
    private sealed record Table(HashSet<string> Languages12, HashSet<string> Tags12, HashSet<string> Tags24);

    private static readonly Table Data = Load();

    private static Table Load()
    {
        using var stream = typeof(HourCycles).Assembly.GetManifestResourceStream("Text.hour-cycles.json")!;
        using var json = JsonDocument.Parse(stream);
        HashSet<string> Set(string name) =>
            json.RootElement.GetProperty(name).EnumerateArray().Select(each => each.GetString()!).ToHashSet(StringComparer.Ordinal);
        return new Table(Set("languages12"), Set("tags12"), Set("tags24"));
    }

    /// <summary>
    /// Whether <paramref name="tag"/> (BCP 47: <c>en-GB</c>, <c>zh-Hant-TW</c>, <c>de</c>) reads a
    /// 24-hour clock: its language and region's own when ICU has data for them, else its language and
    /// script's (zh-Hant, yue-Hans), else its language's. A language ICU has no data for falls back,
    /// in a browser, to that browser's default, which the server can't know: it reads 24-hour, as
    /// ICU's root does. No tag at all is English, as the server's words are.
    /// </summary>
    public static bool TwentyFour(string? tag)
    {
        var parts = (tag ?? "").Split('-', '_', StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length == 0) return false;
        var language = parts[0].ToLowerInvariant();
        var after = parts.Skip(1).Take(2).ToList();
        // The region: two letters or three digits, after the script if there is one (zh-Hant-TW).
        var region = after.FirstOrDefault(part => (part.Length == 2 && part.All(char.IsAsciiLetter)) || (part.Length == 3 && part.All(char.IsAsciiDigit)));
        // The script: four letters, written Title case in the table (Hant).
        var script = after.FirstOrDefault(part => part.Length == 4 && part.All(char.IsAsciiLetter));
        foreach (var locale in new[]
        {
            region is null ? null : $"{language}-{region.ToUpperInvariant()}",
            script is null ? null : $"{language}-{char.ToUpperInvariant(script[0])}{script[1..].ToLowerInvariant()}",
        })
        {
            if (locale is null) continue;
            if (Data.Tags12.Contains(locale)) return false;
            if (Data.Tags24.Contains(locale)) return true;
        }
        return !Data.Languages12.Contains(language);
    }
}
