using System.Security.Claims;
using System.Text.Json;
using PeckList.Core.Sharing;
using PeckList.Core.Sync;
using PeckList.Server.Auth;
using PeckList.Server.Push;

namespace PeckList.Server;

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
                context.RequestServices.GetRequiredService<ILoggerFactory>().CreateLogger("PeckList.Impersonation").LogWarning(
                    "{Admin} as {User} tried to write {Count} change(s); refused", admin, user.FindFirstValue(ClaimTypes.Name), request.Changes.Count);
                return Results.Json(new AuthError("not_while_impersonating"), statusCode: StatusCodes.Status403Forbidden);
            }
            // A device from before a restore writes nothing over the restored data (audit C6): it
            // hears the new epoch and starts over from what the server has now.
            var current = await context.RequestServices.GetRequiredService<ServerEpoch>().GetAsync(cancellation);
            if (request.Epoch is { Length: > 0 } theirs && theirs != current)
            {
                return Results.Ok(new SyncResponse(0, [], false, [], [], [], Epoch: current));
            }
            try
            {
                var source = context.Request.Headers[DeviceHeader].FirstOrDefault() ?? context.Request.Headers[LegacyDeviceHeader].FirstOrDefault();
                var response = await sync.SyncAsync(user.UserId(), request, source, cancellation);
                await DeviceZones.ReportAsync(context.RequestServices.GetRequiredService<Core.Push.IPushStore>(), user, request.Zone, cancellation);
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
        })
        .WithSummary("Internal: the apps' sync")
        .WithDescription(
            "The protocol the PeckList apps sync with: whole entities with per-field clocks. It is internal and " +
            "changes with the apps; scripts and other tools use the task API under /api/v1, which is versioned.");

        api.MapGet("/events", StreamEventsAsync);
        return api;
    }

    /// <summary>The device id a client sends, so its own changes are not announced back to it.</summary>
    public const string DeviceHeader = "X-PeckList-Device";
    /// <summary>The header before the rename (PL-127), from an app that has not updated yet.</summary>
    public const string LegacyDeviceHeader = "X-Punchlist-Device";

    private static readonly TimeSpan Heartbeat = TimeSpan.FromSeconds(25);

    /// <summary>
    /// Live-update streams one account may hold open at once (audit S13): more than anyone's devices
    /// and tabs, with room for streams whose client vanished without closing them. One more is
    /// refused with 429, which a browser does not retry; the app syncs on its timer and opens the
    /// stream again on a later sync. A stream ends when its client goes away, so its place comes back.
    /// </summary>
    public const int MaxStreams = 25;

    /// <summary>
    /// <c>GET /api/events</c>: Server-Sent Events. <c>event: changed</c> with <c>{cursor, source}</c>
    /// whenever the user's data changes, <c>event: notification</c> when a notification is made for them; a comment line every 25 s keeps proxies from closing it.
    /// </summary>
    private static async Task StreamEventsAsync(
        ClaimsPrincipal user, IChangeNotifier notifier, HttpContext context, IHostApplicationLifetime lifetime, CancellationToken requestAborted)
    {
        // A stopping server (a restart to apply settings or restore a backup) ends the stream at once
        // instead of waiting out the shutdown timeout; clients reconnect on their own.
        using var ending = CancellationTokenSource.CreateLinkedTokenSource(requestAborted, lifetime.ApplicationStopping);
        var cancellation = ending.Token;
        var response = context.Response;
        // Subscribe before saying the stream is open: a change made right after the client hears
        // "connected" must not slip through.
        using var subscription = notifier.Subscribe(user.UserId(), MaxStreams);
        if (subscription is null)
        {
            response.StatusCode = StatusCodes.Status429TooManyRequests;
            AuthSetup.RetryAfter(response, Heartbeat);
            return;
        }
        response.ContentType = "text/event-stream";
        response.Headers.CacheControl = "no-cache";
        // nginx and friends would buffer the stream otherwise.
        response.Headers["X-Accel-Buffering"] = "no";
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
                    if (change.Notice is { } notice)
                    {
                        var told = JsonSerializer.Serialize(notice, JsonSerializerOptions.Web);
                        await response.WriteAsync($"event: notification\ndata: {told}\n\n", cancellation);
                        continue;
                    }
                    var data = JsonSerializer.Serialize(new { change.Cursor, change.Source }, JsonSerializerOptions.Web);
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
