using System.Security.Claims;
using System.Text.Json;
using Punchlist.Core.Sharing;
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
        api.MapPost("/sync", async (SyncRequest request, ClaimsPrincipal user, SyncService sync, Groups groups, Invites invites, HttpContext context, CancellationToken cancellation) =>
        {
            // An API key without tasks:write may pull, never push (R-FB-157).
            if (user.ByKey() && request.Changes is { Count: > 0 } && !user.KeyMay(Core.Accounts.ApiScopes.TasksWrite))
            {
                return Results.Json(new { error = "scope", message = "this key lacks the tasks:write permission" },
                    statusCode: StatusCodes.Status403Forbidden);
            }
            // Viewing as someone never writes into their account (audit C4, S12).
            if (user.Impersonator() is { } admin && request.Changes is { Count: > 0 })
            {
                context.RequestServices.GetRequiredService<ILoggerFactory>().CreateLogger("Punchlist.Impersonation").LogWarning(
                    "{Admin} as {User} tried to write {Count} change(s); refused", admin, user.FindFirstValue(ClaimTypes.Name), request.Changes.Count);
                return Results.Json(new AuthError("not_while_impersonating"), statusCode: StatusCodes.Status403Forbidden);
            }
            try
            {
                var source = context.Request.Headers[DeviceHeader].FirstOrDefault();
                var response = await sync.SyncAsync(user.UserId(), request, source, cancellation);
                // An owner who just left hands the group on; everyone concerned hears of it.
                if (request.Changes is { Count: > 0 })
                {
                    await groups.SettleAsync(cancellation);
                    // A friend request just accepted (or declined) settles assignments waiting on it.
                    await invites.SettleAsync(cancellation);
                }
                // Which life of the data this is: devices start over when it changes (a restore).
                var epoch = await context.RequestServices.GetRequiredService<ServerEpoch>().GetAsync(cancellation);
                return Results.Ok(response with { Epoch = epoch });
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
    private static async Task StreamEventsAsync(
        ClaimsPrincipal user, IChangeNotifier notifier, HttpContext context, IHostApplicationLifetime lifetime, CancellationToken requestAborted)
    {
        // A stopping server (a restart to apply settings or restore a backup) ends the stream at once
        // instead of waiting out the shutdown timeout; clients reconnect on their own.
        using var ending = CancellationTokenSource.CreateLinkedTokenSource(requestAborted, lifetime.ApplicationStopping);
        var cancellation = ending.Token;
        var response = context.Response;
        response.ContentType = "text/event-stream";
        response.Headers.CacheControl = "no-cache";
        // nginx and friends would buffer the stream otherwise.
        response.Headers["X-Accel-Buffering"] = "no";
        // Subscribe before saying the stream is open: a change made right after the client hears
        // "connected" must not slip through.
        using var subscription = notifier.Subscribe(user.UserId());
        try
        {
            await response.WriteAsync(": connected\n\n", cancellation);
            await response.Body.FlushAsync(cancellation);
            while (!cancellation.IsCancellationRequested)
            {
                using var heartbeat = CancellationTokenSource.CreateLinkedTokenSource(cancellation);
                heartbeat.CancelAfter(Heartbeat);
                bool ready;
                try
                {
                    ready = await subscription.Events.WaitToReadAsync(heartbeat.Token);
                }
                catch (OperationCanceledException) when (!cancellation.IsCancellationRequested)
                {
                    await response.WriteAsync(": ping\n\n", cancellation);
                    await response.Body.FlushAsync(cancellation);
                    continue;
                }
                if (!ready) break;
                while (subscription.Events.TryRead(out var change))
                {
                    var data = JsonSerializer.Serialize(change, JsonSerializerOptions.Web);
                    await response.WriteAsync($"event: changed\ndata: {data}\n\n", cancellation);
                }
                await response.Body.FlushAsync(cancellation);
            }
        }
        catch (OperationCanceledException)
        {
            // The client went away.
        }
    }
}
