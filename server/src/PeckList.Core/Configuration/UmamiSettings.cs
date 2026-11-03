namespace PeckList.Core.Configuration;

/// <summary>
/// Visit counts from an Umami server (<c>UMAMI_URL</c>, <c>UMAMI_WEBSITE_ID</c>; off unless both are
/// set). The page loads Umami's tracker, and with <see cref="Recorder"/> its session recorder, from
/// <see cref="Url"/>, and the browser reports there; the server itself sends nothing.
/// </summary>
/// <param name="Url">The Umami server, without a trailing slash: the scripts are <c>Url/script.js</c> and <c>Url/recorder.js</c>.</param>
/// <param name="WebsiteId">The website's id in Umami.</param>
/// <param name="Recorder">Session replays too (<c>UMAMI_RECORDER</c>): Umami's recorder, which masks what people type.</param>
public sealed record UmamiSettings(Uri Url, string WebsiteId, bool Recorder)
{
    /// <summary>Scheme, host and port: what the page's security policy lets scripts load from and report to.</summary>
    public string Origin => Url.GetLeftPart(UriPartial.Authority);

    internal static UmamiSettings? Read(Func<string, string?> get, Func<string, bool, bool> flag, List<string> errors)
    {
        var url = get("UMAMI_URL")?.Trim();
        var id = get("UMAMI_WEBSITE_ID")?.Trim();
        if (string.IsNullOrEmpty(url) && string.IsNullOrEmpty(id))
        {
            if (flag("UMAMI_RECORDER", false)) errors.Add("UMAMI_RECORDER needs UMAMI_URL and UMAMI_WEBSITE_ID");
            return null;
        }
        Uri? parsed = null;
        if (string.IsNullOrEmpty(url)) errors.Add("UMAMI_URL is required with UMAMI_WEBSITE_ID");
        else if (!Uri.TryCreate(url.TrimEnd('/'), UriKind.Absolute, out parsed)
                 || (parsed.Scheme != Uri.UriSchemeHttps && parsed.Scheme != Uri.UriSchemeHttp)
                 || parsed.Query.Length > 0 || parsed.Fragment.Length > 0)
        {
            errors.Add($"UMAMI_URL: '{url}' is not an http or https address");
            parsed = null;
        }
        if (string.IsNullOrEmpty(id)) errors.Add("UMAMI_WEBSITE_ID is required with UMAMI_URL");
        else if (!Guid.TryParse(id, out _)) errors.Add($"UMAMI_WEBSITE_ID: '{id}' is not an Umami website id");
        if (parsed is null || string.IsNullOrEmpty(id) || !Guid.TryParse(id, out _)) return null;
        return new UmamiSettings(parsed, id, flag("UMAMI_RECORDER", false));
    }
}
