using System.Security.Claims;
using System.Text.Json;
using Punchlist.Core.Sync;
using Punchlist.Server.Auth;

namespace Punchlist.Server;

/// <summary>Why a sync was refused. <c>serverSchemaVersion</c> comes with <c>schema_mismatch</c>.</summary>
public sealed record SyncError(string Error, string Message, int? ServerSchemaVersion = null);

public static class SyncEndpoints
{
    /// <summary>
    /// <c>POST /api/sync</c>: push changes, pull what is newer than the cursor. 409 when the schema
    /// versions differ (client behind: update it; server behind: pause syncing), 400 for a bad change.
    /// </summary>
    public static RouteGroupBuilder MapSync(this RouteGroupBuilder api)
    {
        api.MapPost("/sync", async (SyncRequest request, ClaimsPrincipal user, SyncService sync, HttpContext context, CancellationToken cancellation) =>
        {
            try
            {
                var source = context.Request.Headers[DeviceHeader].FirstOrDefault();
                return Results.Ok(await sync.SyncAsync(user.UserId(), request, source, cancellation));
            }
            catch (SyncRejected rejected)
            {
                return Results.Json(
                    new SyncError(rejected.Code, rejected.Message, rejected.ServerSchemaVersion),
                    statusCode: rejected.Code == "schema_mismatch" ? StatusCodes.Status409Conflict : StatusCodes.Status400BadRequest);
            }
        });

        api.MapGet("/events", StreamEventsAsync);
        return api;
    }

    /// <summary>The device id a client sends, so its own changes are not announced back to it.</summary>
    public const string DeviceHeader = "X-Punchlist-Device";

    private static readonly TimeSpan Heartbeat = TimeSpan.FromSeconds(25);

    /// <summary>
    /// <c>GET /api/events</c>: Server-Sent Events. <c>event: changed</c> with <c>{cursor, source}</c>
    /// whenever the user's data changes; a comment line every 25 s keeps proxies from closing it.
    /// </summary>
    private static async Task StreamEventsAsync(ClaimsPrincipal user, IChangeNotifier notifier, HttpContext context, CancellationToken cancellation)
    {
        var response = context.Response;
        response.ContentType = "text/event-stream";
        response.Headers.CacheControl = "no-cache";
        // nginx and friends would buffer the stream otherwise.
        response.Headers["X-Accel-Buffering"] = "no";
        await response.WriteAsync(": connected\n\n", cancellation);
        await response.Body.FlushAsync(cancellation);

        await using var events = notifier.SubscribeAsync(user.UserId(), cancellation).GetAsyncEnumerator(cancellation);
        var next = events.MoveNextAsync().AsTask();
        try
        {
            while (!cancellation.IsCancellationRequested)
            {
                var finished = await Task.WhenAny(next, Task.Delay(Heartbeat, cancellation));
                if (finished == next)
                {
                    if (!await next) break;
                    var data = JsonSerializer.Serialize(events.Current, JsonSerializerOptions.Web);
                    await response.WriteAsync($"event: changed\ndata: {data}\n\n", cancellation);
                    next = events.MoveNextAsync().AsTask();
                }
                else
                {
                    await response.WriteAsync(": ping\n\n", cancellation);
                }
                await response.Body.FlushAsync(cancellation);
            }
        }
        catch (OperationCanceledException)
        {
            // The client went away.
        }
        finally
        {
            // Let the pending read finish (it ends with the request) before the subscription goes.
            await next.ContinueWith(_ => { }, TaskScheduler.Default);
        }
    }
}
