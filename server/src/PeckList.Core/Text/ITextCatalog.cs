namespace PeckList.Core.Text;

/// <summary>
/// Port: the words the server sends people, in their language (PL-148): emails, push and the
/// Android check-in. Messages are ICU MessageFormat, the same syntax as the web app's catalogs:
/// <c>{name}</c> fills a parameter, <c>{count, plural, one {# hour} other {# hours}}</c> picks the
/// form the language's plural rules ask for. Any adapter must pass TextCatalogContract.
/// </summary>
public interface ITextCatalog
{
    /// <summary>The languages there is a catalog for, English first.</summary>
    IReadOnlyList<string> Languages { get; }

    /// <summary>
    /// The first of <paramref name="wanted"/> (BCP 47 tags, most wanted first; nulls skipped) there is
    /// a catalog for: the exact one ("pt-BR"), else its base language ("pt"); English when none is.
    /// </summary>
    string Resolve(IEnumerable<string?> wanted);

    /// <summary>
    /// <paramref name="key"/>'s message in <paramref name="language"/>, filled with
    /// <paramref name="args"/>: the English message when the language has none, the key itself when
    /// English has none either. Never throws: a parameter not given stays as <c>{name}</c>, and a
    /// message that can't be read comes back with only its plain parameters filled.
    /// </summary>
    string Text(string language, string key, IReadOnlyDictionary<string, object?>? args = null);
}

/// <summary>
/// A catalog and the language picked from it, so code can say <c>words["key"]</c>. <c>Locale</c>:
/// the tag the person reads in as asked (their picked language, else their device's first), which
/// may have no catalog of its own (pt-BR, en-GB): an automatic clock follows it (HourCycles).
/// </summary>
public sealed record Words(ITextCatalog Catalog, string Language, string? Locale = null)
{
    /// <summary>
    /// The device's own 12/24-hour setting, when it says it: an Android phone's check-in does
    /// (schema 22: on a phone an automatic clock follows that setting ahead of the language).
    /// </summary>
    public bool? Clock24 { get; init; }

    /// <summary>Whether an automatic clock reads 24-hour for these words: the device's own setting, else their locale's, else their language's.</summary>
    public bool TwentyFourHour => Clock24 ?? HourCycles.TwentyFour(Locale ?? Language);

    /// <summary>English from the server's own catalog: what goes out when nothing names a language.</summary>
    public static Words English { get; } = new(JsonTextCatalog.Embedded, JsonTextCatalog.Source);

    public string this[string key] => Catalog.Text(Language, key);

    public string Get(string key, params (string Name, object? Value)[] args) =>
        Catalog.Text(Language, key, args.ToDictionary(each => each.Name, each => each.Value, StringComparer.Ordinal));

    /// <summary>The words in the first language of <paramref name="wanted"/> the catalog has.</summary>
    public static Words In(ITextCatalog catalog, IEnumerable<string?> wanted) => new(catalog, catalog.Resolve(wanted));
}
