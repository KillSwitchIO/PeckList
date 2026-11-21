using System.Text.Json.Nodes;

namespace PeckList.Core.Text;

/// <summary>
/// Which language the server writes to a person in (PL-148): the language they picked (the synced
/// settings' <c>language</c>, absent for automatic), else the device's (the languages a check-in or
/// a browser asks for), else English. A picked language the server has no catalog for counts as
/// automatic, so the device's language still gets a chance.
/// </summary>
public static class TextLanguage
{
    /// <summary>The settings' picked language, or null for automatic.</summary>
    public static string? Picked(JsonObject? settings) =>
        settings?["language"] is JsonValue value && value.TryGetValue<string>(out var language) && language.Trim().Length > 0 ? language.Trim() : null;

    /// <summary>The words to write to someone with <paramref name="settings"/>, on a device asking for <paramref name="device"/>.</summary>
    public static Words For(ITextCatalog catalog, JsonObject? settings, IEnumerable<string>? device = null)
    {
        var picked = Picked(settings);
        var wanted = new List<string?>();
        if (picked is not null && catalog.Resolve([picked]) is var language
            && (language != JsonTextCatalog.Source || picked.Split('-', '_')[0].Equals(JsonTextCatalog.Source, StringComparison.OrdinalIgnoreCase)))
        {
            wanted.Add(language);
        }
        wanted.AddRange(device ?? []);
        return Words.In(catalog, wanted);
    }
}
