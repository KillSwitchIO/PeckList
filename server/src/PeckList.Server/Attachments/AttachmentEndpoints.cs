using System.Security.Claims;
using Microsoft.Net.Http.Headers;
using PeckList.Core.Attachments;
using PeckList.Core.Configuration;
using PeckList.Core.Sharing;
using PeckList.Server.Auth;

namespace PeckList.Server.Attachments;

public sealed record AttachmentError(string Error, string? Message = null);

/// <summary>
/// <c>/api/attachments/{sha256}</c> (spec: Data Model, Attachments): devices upload a file under its
/// SHA-256 before they sync the attachment that names it, and download it when someone opens it.
/// Downloading needs an attachment with that hash the person may see.
/// </summary>
public static class AttachmentEndpoints
{
    /// <summary>Shown in the browser when opened; anything else (HTML and SVG above all) downloads.</summary>
    private static readonly HashSet<string> Inline = new(StringComparer.OrdinalIgnoreCase)
    {
        "image/png", "image/jpeg", "image/gif", "image/webp", "image/avif", "application/pdf", "text/plain",
    };

    public static RouteGroupBuilder MapAttachments(this RouteGroupBuilder api)
    {
        // Only for files the person can see: otherwise it would tell anyone whether someone on the
        // server has this file (audit S5). A device uploading its own new file hears 404 and sends
        // it; the store keeps one copy either way.
        api.MapMethods("/attachments/{sha256}", ["HEAD"], async (string sha256, ClaimsPrincipal user, SharingState sharing, IAttachmentStore store, CancellationToken cancellation) =>
            AttachmentHash.IsValid(sha256) && sharing.Index.SeesFile(user.UserId(), sha256) && await store.ExistsAsync(sha256, cancellation)
                ? Results.Ok()
                : Results.NotFound());

        api.MapPut("/attachments/{sha256}", async (
            string sha256, HttpContext context, ClaimsPrincipal user, IAttachmentStore store, LiveSettings live, UploadAllowance allowance) =>
        {
            if (!AttachmentHash.IsValid(sha256)) return Results.BadRequest(new AttachmentError("invalid_hash", "a lowercase hex SHA-256"));
            var max = live.Current.AttachmentMaxMb * 1024L * 1024L;
            if (context.Request.ContentLength > max) return TooLarge(live);
            // Per person (audit S5): a few requests a second at most, and ATTACHMENT_DAILY_MB a day.
            var person = user.UserId();
            if (!allowance.TryRequest(person))
            {
                return Results.Json(new AttachmentError("too_many", "too many uploads at once; the rest go in a minute"),
                    statusCode: StatusCodes.Status429TooManyRequests);
            }
            var daily = live.Current.AttachmentDailyMb * 1024L * 1024L;
            // The server's own body limit is for JSON; this endpoint checks its own.
            if (context.Features.Get<Microsoft.AspNetCore.Http.Features.IHttpMaxRequestBodySizeFeature>() is { IsReadOnly: false } limit)
            {
                limit.MaxRequestBodySize = max + 1;
            }
            // A file the server has already costs nothing.
            if (await store.ExistsAsync(sha256, context.RequestAborted)) return Results.NoContent();
            if (!allowance.Fits(person, context.Request.ContentLength ?? 0, daily)) return DailyLimit(live);
            var body = new CountingStream(context.Request.Body);
            var result = await store.PutAsync(sha256, body, max, context.RequestAborted);
            if (result == PutResult.Stored) allowance.Add(person, body.Count);
            return result switch
            {
                PutResult.Stored => Results.Created($"/api/attachments/{sha256}", null),
                PutResult.TooLarge => TooLarge(live),
                _ => Results.BadRequest(new AttachmentError("hash_mismatch", "the bytes do not match their SHA-256")),
            };
        });

        api.MapGet("/attachments/{sha256}", async (
            string sha256, string? name, string? type, ClaimsPrincipal user, SharingState sharing, IAttachmentStore store,
            HttpContext context) =>
        {
            if (!AttachmentHash.IsValid(sha256) || !sharing.Index.SeesFile(user.UserId(), sha256)) return Results.NotFound();
            if (await store.OpenAsync(sha256, context.RequestAborted) is not { } file) return Results.NotFound();
            var mime = type is { Length: > 0 and <= 255 } && MediaTypeHeaderValue.TryParse(type, out _) ? type : "application/octet-stream";
            var inline = Inline.Contains(mime);
            context.Response.Headers.XContentTypeOptions = "nosniff";
            // A file is its hash's forever: devices keep it.
            context.Response.Headers.CacheControl = "private, max-age=31536000, immutable";
            context.Response.Headers.ContentSecurityPolicy = "sandbox; default-src 'none'";
            return Results.File(file, inline ? mime : "application/octet-stream",
                fileDownloadName: inline ? null : (string.IsNullOrWhiteSpace(name) ? sha256 : name), enableRangeProcessing: true);
        });

        return api;
    }

    private static IResult DailyLimit(LiveSettings live) => Results.Json(
        new AttachmentError("daily_limit", $"each person may upload {live.Current.AttachmentDailyMb} MB a day; the rest goes later"),
        statusCode: StatusCodes.Status429TooManyRequests);

    private static IResult TooLarge(LiveSettings live) => Results.Json(
        new AttachmentError("too_large", $"files may be at most {live.Current.AttachmentMaxMb} MB"),
        statusCode: StatusCodes.Status413PayloadTooLarge);
}

/// <summary>
/// Removes stored files nothing wants any more (no live attachment, nor one deleted in the last 30
/// days, nor one on a task the Trash can still give back, up to its longest period), daily. Files
/// younger than a day stay: a device uploads a file just before it syncs the attachment naming it.
/// </summary>
public sealed class AttachmentCleanup(IAttachmentStore store, SharingState sharing, TimeProvider time, ILogger<AttachmentCleanup> logger)
    : PeriodicService("Cleaning attachment files", TimeSpan.FromMinutes(5), TimeSpan.FromDays(1), time, logger)
{
    public static readonly TimeSpan KeepDeleted = TimeSpan.FromDays(30);

    /// <summary>The longest a Trash keeps a task (purgeAfterDays at most 365, schema 18).</summary>
    public static readonly TimeSpan KeepInTrash = TimeSpan.FromDays(365);

    protected override async Task RunAsync(CancellationToken stopping)
    {
        var removed = await CleanAsync(stopping);
        if (removed > 0) Logger.LogInformation("Removed {Count} attachment files nothing uses", removed);
    }

    public async Task<int> CleanAsync(CancellationToken cancellation = default)
    {
        // An index still loading wants nothing: every file would look unused.
        await sharing.Loaded.WaitAsync(cancellation);
        var now = Time.GetUtcNow();
        var wanted = sharing.Index.WantedFiles(now - KeepDeleted, now - KeepInTrash);
        var removed = 0;
        await foreach (var (sha256, written) in store.ListAsync(cancellation))
        {
            if (wanted.Contains(sha256) || now - written < TimeSpan.FromDays(1)) continue;
            await store.DeleteAsync(sha256, cancellation);
            removed++;
        }
        return removed;
    }
}
