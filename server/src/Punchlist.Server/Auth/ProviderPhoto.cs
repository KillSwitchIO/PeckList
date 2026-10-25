using System.Net.Http.Headers;
using System.Text.Json.Nodes;
using Punchlist.Core.Sharing;
using Punchlist.Core.Storage;
using Punchlist.Core.Sync;

namespace Punchlist.Server.Auth;

/// <summary>
/// A person's picture from their identity provider (spec: R-FB-62): the OIDC <c>picture</c> claim,
/// fetched and kept on their profile when they have never set one of their own. One they set, or
/// took away (an empty photo), stays theirs. Too big, not an image, or out of reach: initials.
/// </summary>
public sealed class ProviderPhoto(IHttpClientFactory http, SharingState sharing, SyncService sync, ServerClock clock, ILogger<ProviderPhoto> logger)
{
    /// <summary>The most a picture may weigh (it is kept as text: base64 grows it by a third, under the schema's 80,000).</summary>
    public const int MaxBytes = 58_000;

    private static readonly string[] Types = ["image/png", "image/jpeg", "image/webp"];

    public async Task ImportAsync(string userId, string? picture, CancellationToken cancellation = default)
    {
        if (picture is null || !Uri.TryCreate(picture, UriKind.Absolute, out var url) || url.Scheme is not ("https" or "http")) return;
        var profile = sharing.Index.LiveOf("users").FirstOrDefault(each => each.Id == userId).Doc;
        // None yet (it is written first), or the person's own choice already.
        if (profile is null || profile.ContainsKey("photo")) return;
        try
        {
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellation);
            timeout.CancelAfter(TimeSpan.FromSeconds(5));
            using var response = await http.CreateClient("photos").GetAsync(url, HttpCompletionOption.ResponseHeadersRead, timeout.Token);
            var type = response.Content.Headers.ContentType?.MediaType;
            if (!response.IsSuccessStatusCode || type is null || !Types.Contains(type)) return;
            if (response.Content.Headers.ContentLength is > MaxBytes) return;
            var bytes = await ReadUpToAsync(response.Content, MaxBytes + 1, timeout.Token);
            if (bytes.Length == 0 || bytes.Length > MaxBytes) return;
            var doc = (JsonObject)profile.DeepClone();
            doc["photo"] = $"data:{type};base64,{Convert.ToBase64String(bytes)}";
            var clocks = doc["_hlc"] as JsonObject ?? new JsonObject();
            clocks["photo"] = clock.Next();
            doc["_hlc"] = clocks;
            await sync.WriteAsServerAsync(userId, [new IncomingEntity("users", doc)], cancellation);
        }
        catch (Exception error) when (error is HttpRequestException or OperationCanceledException or IOException)
        {
            logger.LogInformation("Could not bring in the provider's picture: {Message}", error.Message);
        }
    }

    private static async Task<byte[]> ReadUpToAsync(HttpContent content, int limit, CancellationToken cancellation)
    {
        await using var stream = await content.ReadAsStreamAsync(cancellation);
        using var buffer = new MemoryStream();
        var chunk = new byte[8192];
        int read;
        while ((read = await stream.ReadAsync(chunk, cancellation)) > 0)
        {
            buffer.Write(chunk, 0, read);
            if (buffer.Length >= limit) break;
        }
        return buffer.ToArray();
    }
}
