using System.Net.Http.Headers;
using System.Text.Json.Nodes;
using Punchlist.Core.Sharing;
using Punchlist.Core.Storage;
using Punchlist.Core.Sync;

namespace Punchlist.Server.Auth;

/// <summary>
/// A person's picture from their identity provider (spec: R-FB-62): the OIDC <c>picture</c> claim,
/// fetched and kept on their profile at sign-in when it has none (never set, or taken away: then the
/// provider's comes back). One they set stays theirs. Too big, not an image, or out of reach: initials.
/// </summary>
public static class ProviderPhotoEndpoints
{
    /// <summary>
    /// The signed-in person's picture at their identity provider, passed through (spec: R-FB-62):
    /// the app shrinks it to a profile photo when they have none. 404 when there is none.
    /// </summary>
    public static RouteGroupBuilder MapProviderPicture(this RouteGroupBuilder api)
    {
        api.MapGet("/account/provider-picture", async (System.Security.Claims.ClaimsPrincipal user, ProviderPhoto photos, CancellationToken cancellation) =>
        {
            if (user.FindFirst(OidcSetup.PictureClaim)?.Value is not { } url) return Results.NotFound();
            return await photos.FetchAsync(url, cancellation) is { } picture
                ? Results.File(picture.Bytes, picture.Type)
                : Results.NotFound();
        });
        return api;
    }
}

public sealed class ProviderPhoto(IHttpClientFactory http, SharingState sharing, SyncService sync, ServerClock clock, ILogger<ProviderPhoto> logger)
{
    /// <summary>The most a picture may weigh (it is kept as text: base64 grows it by a third, under the schema's 80,000).</summary>
    public const int MaxBytes = 58_000;

    private static readonly string[] Types = ["image/png", "image/jpeg", "image/webp"];

    public async Task ImportAsync(string userId, string? picture, CancellationToken cancellation = default)
    {
        if (picture is null || !Uri.TryCreate(picture, UriKind.Absolute, out var url) || url.Scheme is not ("https" or "http")) return;
        var profile = sharing.Index.LiveOf("users").FirstOrDefault(each => each.Id == userId).Doc;
        // No profile yet (it is written first), or a photo of the person's own.
        if (profile is null || profile["photo"] is JsonValue held && held.TryGetValue<string>(out var photo) && photo.Length > 0) return;
        try
        {
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellation);
            timeout.CancelAfter(TimeSpan.FromSeconds(5));
            using var response = await GetAsync(url, timeout.Token);
            var type = response?.Content.Headers.ContentType?.MediaType;
            if (response is null || !response.IsSuccessStatusCode || type is null || !Types.Contains(type)) return;
            if (response.Content.Headers.ContentLength is > MaxBytes) return;
            var bytes = await ReadUpToAsync(response.Content, MaxBytes + 1, timeout.Token);
            if (bytes.Length == 0 || bytes.Length > MaxBytes) return;
            var data = $"data:{type};base64,{Convert.ToBase64String(bytes)}";
            var doc = ServerEntities.Changed(profile, clock.Next(), new JsonObject { ["photo"] = data });
            await sync.WriteAsServerAsync(userId, [new IncomingEntity("users", doc)], cancellation);
        }
        catch (Exception error) when (error is HttpRequestException or OperationCanceledException or IOException)
        {
            logger.LogInformation("Could not bring in the provider's picture: {Message}", error.Message);
        }
    }

    /// <summary>The most the app is sent to shrink itself (a full-size upload at the provider).</summary>
    public const int MaxProxyBytes = 5_000_000;

    /// <summary>The picture at <paramref name="url"/> as it is (any size up to <see cref="MaxProxyBytes"/>), or null.</summary>
    public async Task<(byte[] Bytes, string Type)?> FetchAsync(string url, CancellationToken cancellation = default)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var address) || address.Scheme is not ("https" or "http")) return null;
        try
        {
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellation);
            timeout.CancelAfter(TimeSpan.FromSeconds(8));
            using var response = await GetAsync(address, timeout.Token);
            var type = response?.Content.Headers.ContentType?.MediaType;
            if (response is null || !response.IsSuccessStatusCode || type is null || !Types.Contains(type))
            {
                logger.LogInformation("The provider's picture is not an image we take ({Status}, {Type})", (int?)response?.StatusCode, type);
                return null;
            }
            var bytes = await ReadUpToAsync(response.Content, MaxProxyBytes + 1, timeout.Token);
            return bytes.Length is > 0 and <= MaxProxyBytes ? (bytes, type) : null;
        }
        catch (Exception error) when (error is HttpRequestException or OperationCanceledException or IOException)
        {
            logger.LogInformation("Could not fetch the provider's picture: {Message}", error.Message);
            return null;
        }
    }

    /// <summary>Redirects the picture client does not follow itself (each hop's address is checked when connecting).</summary>
    public const int MaxRedirects = 3;

    /// <summary>The picture's response after at most <see cref="MaxRedirects"/> redirects, each to http or https; null past that.</summary>
    private async Task<HttpResponseMessage?> GetAsync(Uri url, CancellationToken cancellation)
    {
        var client = http.CreateClient("photos");
        for (var hop = 0; hop <= MaxRedirects; hop++)
        {
            var response = await client.GetAsync(url, HttpCompletionOption.ResponseHeadersRead, cancellation);
            if ((int)response.StatusCode is not (301 or 302 or 303 or 307 or 308) || response.Headers.Location is not { } next) return response;
            response.Dispose();
            if (!Uri.TryCreate(url, next, out var target) || target.Scheme is not ("https" or "http")) return null;
            url = target;
        }
        return null;
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
