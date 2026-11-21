using System.Collections.Concurrent;
using System.Globalization;
using System.Reflection;
using System.Text.Json;
using System.Text.RegularExpressions;
using Jeffijoe.MessageFormat;

namespace PeckList.Core.Text;

/// <summary>
/// The server's text catalogs (PL-148): one flat JSON file per language in <c>Text/locales/</c>,
/// embedded in the assembly, English (<c>en.json</c>) the source. ICU messages go through
/// MessageFormat.NET; the rest only fill <c>{name}</c>, as the web app's ICU adapter does
/// (web/src/adapters/icu-message-format.ts), so a missing parameter stays visible the same way.
/// </summary>
public sealed partial class JsonTextCatalog : ITextCatalog
{
    public const string Source = "en";

    private const string ResourcePrefix = "Text.locales.";

    /// <summary>The catalogs embedded in this assembly.</summary>
    public static JsonTextCatalog Embedded { get; } = FromAssembly(typeof(JsonTextCatalog).Assembly);

    private readonly Dictionary<string, IReadOnlyDictionary<string, string>> catalogs;
    private readonly IReadOnlyDictionary<string, string> english;
    private readonly ConcurrentDictionary<string, LanguageFormatter> formatters = new(StringComparer.Ordinal);

    /// <summary>Catalogs by language; one must be English (<see cref="Source"/>).</summary>
    public JsonTextCatalog(IReadOnlyDictionary<string, IReadOnlyDictionary<string, string>> catalogs)
    {
        this.catalogs = new(catalogs, StringComparer.OrdinalIgnoreCase);
        english = this.catalogs.TryGetValue(Source, out var source) ? source : throw new ArgumentException("The catalogs need English (en)", nameof(catalogs));
        Languages = [Source, .. this.catalogs.Keys.Where(each => !each.Equals(Source, StringComparison.OrdinalIgnoreCase)).Order(StringComparer.Ordinal)];
    }

    public IReadOnlyList<string> Languages { get; }

    /// <summary>The source catalog, English.</summary>
    public IReadOnlyDictionary<string, string> EnglishMessages => english;

    /// <summary>Every <c>Text.locales.{language}.json</c> resource of <paramref name="assembly"/>.</summary>
    public static JsonTextCatalog FromAssembly(Assembly assembly)
    {
        var found = new Dictionary<string, IReadOnlyDictionary<string, string>>(StringComparer.OrdinalIgnoreCase);
        foreach (var name in assembly.GetManifestResourceNames().Where(each => each.StartsWith(ResourcePrefix, StringComparison.Ordinal) && each.EndsWith(".json", StringComparison.Ordinal)))
        {
            using var stream = assembly.GetManifestResourceStream(name)!;
            found[name[ResourcePrefix.Length..^".json".Length]] = JsonSerializer.Deserialize<Dictionary<string, string>>(stream)
                ?? throw new InvalidDataException($"{name} is not a JSON object of strings");
        }
        return new JsonTextCatalog(found);
    }

    public string Resolve(IEnumerable<string?> wanted)
    {
        foreach (var each in wanted)
        {
            if (each is null) continue;
            var tag = each.Trim().Replace('_', '-');
            if (tag.Length == 0) continue;
            if (Known(tag) is { } exact) return exact;
            if (Known(tag.Split('-')[0]) is { } basic) return basic;
        }
        return Source;
    }

    private string? Known(string language) => Languages.FirstOrDefault(each => each.Equals(language, StringComparison.OrdinalIgnoreCase));

    public string Text(string language, string key, IReadOnlyDictionary<string, object?>? args = null)
    {
        args ??= new Dictionary<string, object?>();
        if (!Source.Equals(language, StringComparison.OrdinalIgnoreCase) && catalogs.TryGetValue(language, out var translated)
            && translated.TryGetValue(key, out var message))
        {
            return Format(message, args, language);
        }
        // English text keeps English plural rules, whatever the person's language.
        return english.TryGetValue(key, out var source) ? Format(source, args, Source) : key;
    }

    private string Format(string message, IReadOnlyDictionary<string, object?> args, string language)
    {
        if (!IcuArgument().IsMatch(message)) return FillPlain(message, args);
        try
        {
            return formatters.GetOrAdd(language, each => new LanguageFormatter(each)).Format(message, args);
        }
        catch (Exception error) when (error is not OutOfMemoryException)
        {
            // A parameter the message needs was not given, or the message is broken: the plain fill.
            return FillPlain(message, args);
        }
    }

    private static string FillPlain(string message, IReadOnlyDictionary<string, object?> args) =>
        PlainParameter().Replace(message, match =>
            args.TryGetValue(match.Groups[1].Value, out var value) ? Convert.ToString(value, CultureInfo.InvariantCulture) ?? "" : match.Value);

    [GeneratedRegex(@"\{\s*\w+\s*,\s*(plural|selectordinal|select|number|date|time)\b")]
    private static partial Regex IcuArgument();

    [GeneratedRegex(@"\{(\w+)\}")]
    private static partial Regex PlainParameter();

    /// <summary>
    /// One language's formatter. The server runs with invariant globalization (no culture data), so
    /// the culture handed to MessageFormat.NET is the invariant one under the language's name: its
    /// CLDR plural rules are picked by that name, and numbers stay as the invariant culture writes
    /// them. Formatting is serialized per language, since the formatter caches what it parses.
    /// </summary>
    private sealed class LanguageFormatter
    {
        private readonly NamedCulture culture;
        private readonly MessageFormatter formatter;
        private readonly Lock gate = new();

        public LanguageFormatter(string language)
        {
            culture = new NamedCulture(language);
            formatter = new MessageFormatter(useCache: true, culture: culture);
        }

        public string Format(string message, IReadOnlyDictionary<string, object?> args)
        {
            lock (gate) return formatter.FormatMessage(message, args, culture);
        }
    }

    private sealed class NamedCulture(string name) : CultureInfo("")
    {
        public override string Name => name;

        public override string TwoLetterISOLanguageName => name.Split('-')[0];
    }
}
