using System.Collections.Concurrent;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Authentication.OpenIdConnect;
using Microsoft.Extensions.Options;
using Punchlist.Core.Configuration;

namespace Punchlist.Server.Auth;

/// <summary>
/// Each provider's icon (spec: Accounts &amp; Admin, Linking): <c>OIDC_&lt;NAME&gt;_ICON</c> (an address
/// or a file), else the provider's own <c>/favicon.ico</c>, else the icon its home page links to
/// (Pocket ID and Keycloak keep theirs there). Fetched through the sign-in's own backchannel, kept a
/// day (a miss for an hour), and served by the server so the app never loads anything from the
/// provider itself.
/// </summary>
public sealed partial class ProviderIcons(
    ServerSettings settings, IOptionsMonitor<OpenIdConnectOptions> options, TimeProvider time, ILogger<ProviderIcons> logger)
{
    public sealed record Icon(byte[] Bytes, string ContentType);

    public const int MaxBytes = 256 * 1024;

    private readonly ConcurrentDictionary<string, (Icon? Icon, DateTimeOffset Until)> cache = new();

    /// <summary>The provider's icon, or null when it has none (or is not configured).</summary>
    public async Task<Icon?> GetAsync(string name, CancellationToken cancellation = default)
    {
        if (settings.OidcProviders.FirstOrDefault(each => each.Name == name) is not { } provider) return null;
        var now = time.GetUtcNow();
        if (cache.TryGetValue(name, out var kept) && kept.Until > now) return kept.Icon;
        Icon? icon = null;
        try
        {
            icon = await LoadAsync(provider, cancellation);
        }
        catch (Exception error) when (error is HttpRequestException or IOException or OperationCanceledException or UnauthorizedAccessException)
        {
            if (cancellation.IsCancellationRequested) throw;
            logger.LogDebug("No icon for {Provider}: {Message}", name, error.Message);
        }
        cache[name] = (icon, now + (icon is null ? TimeSpan.FromHours(1) : TimeSpan.FromDays(1)));
        return icon;
    }

    private async Task<Icon?> LoadAsync(OidcProviderSettings provider, CancellationToken cancellation)
    {
        var source = provider.Icon;
        if (source is not null && !source.StartsWith("http://", StringComparison.OrdinalIgnoreCase)
            && !source.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
        {
            var file = new FileInfo(source);
            if (!file.Exists || file.Length > MaxBytes) return null;
            return Checked(await File.ReadAllBytesAsync(file.FullName, cancellation), null, file.Extension);
        }
        var client = options.Get(OidcSetup.Scheme(provider.Name)).Backchannel;
        using var limit = CancellationTokenSource.CreateLinkedTokenSource(cancellation);
        limit.CancelAfter(TimeSpan.FromSeconds(15));
        if (source is not null) return await FetchIconAsync(client, new Uri(source), limit.Token);
        if (await FetchIconAsync(client, new Uri(provider.Authority, "/favicon.ico"), limit.Token) is { } favicon) return favicon;
        // Many providers answer /favicon.ico with their web app: their home page names the icon.
        var (page, at) = await FetchAsync(client, new Uri(provider.Authority, "/"), limit.Token);
        if (page is null || at is null) return null;
        var html = Encoding.UTF8.GetString(page.Value.Bytes);
        foreach (var href in IconLinks(html))
        {
            if (Uri.TryCreate(at, System.Net.WebUtility.HtmlDecode(href), out var address)
                && (address.Scheme == Uri.UriSchemeHttp || address.Scheme == Uri.UriSchemeHttps)
                && await FetchIconAsync(client, address, limit.Token) is { } linked)
            {
                return linked;
            }
        }
        return null;
    }

    private static async Task<Icon?> FetchIconAsync(HttpClient client, Uri address, CancellationToken cancellation)
    {
        var (fetched, _) = await FetchAsync(client, address, cancellation);
        return fetched is { } body ? Checked(body.Bytes, body.Type, Path.GetExtension(address.AbsolutePath)) : null;
    }

    /// <summary>The body (at most <see cref="MaxBytes"/>) and its type, and where it came from after redirects.</summary>
    private static async Task<((byte[] Bytes, string? Type)? Body, Uri? At)> FetchAsync(HttpClient client, Uri address, CancellationToken cancellation)
    {
        using var response = await client.GetAsync(address, HttpCompletionOption.ResponseHeadersRead, cancellation);
        if (!response.IsSuccessStatusCode || response.Content.Headers.ContentLength > MaxBytes) return (null, null);
        await using var stream = await response.Content.ReadAsStreamAsync(cancellation);
        using var bytes = new MemoryStream();
        var buffer = new byte[16 * 1024];
        int read;
        while ((read = await stream.ReadAsync(buffer, cancellation)) > 0)
        {
            if (bytes.Length + read > MaxBytes) return (null, null);
            bytes.Write(buffer, 0, read);
        }
        return ((bytes.ToArray(), response.Content.Headers.ContentType?.MediaType), response.RequestMessage?.RequestUri ?? address);
    }

    [GeneratedRegex("<link\\b[^>]*>", RegexOptions.IgnoreCase)]
    private static partial Regex LinkTag();

    [GeneratedRegex("\\b(rel|href)\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))", RegexOptions.IgnoreCase)]
    private static partial Regex Attribute();

    /// <summary>The <c>href</c>s of a page's icon links: plain icons first, then touch icons.</summary>
    public static IEnumerable<string> IconLinks(string html)
    {
        var found = new List<(int Rank, string Href)>();
        foreach (Match tag in LinkTag().Matches(html))
        {
            string? rel = null, href = null;
            foreach (Match attribute in Attribute().Matches(tag.Value))
            {
                var value = attribute.Groups[2].Success ? attribute.Groups[2].Value
                    : attribute.Groups[3].Success ? attribute.Groups[3].Value
                    : attribute.Groups[4].Value;
                if (attribute.Groups[1].Value.Equals("rel", StringComparison.OrdinalIgnoreCase)) rel = value;
                else href = value;
            }
            if (rel is null || string.IsNullOrWhiteSpace(href)) continue;
            var words = rel.ToLowerInvariant().Split(' ', StringSplitOptions.RemoveEmptyEntries);
            if (words.Contains("icon")) found.Add((0, href.Trim()));
            else if (words.Any(word => word.EndsWith("-icon", StringComparison.Ordinal))) found.Add((1, href.Trim()));
        }
        return found.OrderBy(each => each.Rank).Select(each => each.Href).Distinct();
    }

    /// <summary>
    /// Images only, told by their first bytes (servers often call an .ico <c>application/octet-stream</c>);
    /// SVG, which has no such mark, by its declared type or extension. A provider answering its
    /// favicon address with a web page has no icon.
    /// </summary>
    private static Icon? Checked(byte[] bytes, string? declared, string extension)
    {
        ReadOnlySpan<byte> head = bytes;
        string? type = head switch
        {
            [0x89, 0x50, 0x4e, 0x47, ..] => "image/png",
            [0x00, 0x00, 0x01, 0x00, ..] => "image/x-icon",
            [0xff, 0xd8, 0xff, ..] => "image/jpeg",
            [0x47, 0x49, 0x46, 0x38, ..] => "image/gif",
            [0x52, 0x49, 0x46, 0x46, _, _, _, _, 0x57, 0x45, 0x42, 0x50, ..] => "image/webp",
            _ => null,
        };
        if (type is null && (declared == "image/svg+xml" || extension.Equals(".svg", StringComparison.OrdinalIgnoreCase))
            && Encoding.UTF8.GetString(bytes).Contains("<svg", StringComparison.OrdinalIgnoreCase))
        {
            type = "image/svg+xml";
        }
        return type is null ? null : new Icon(bytes, type);
    }
}
