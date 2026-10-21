using System.Security.Claims;
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
        api.MapPost("/sync", async (SyncRequest request, ClaimsPrincipal user, SyncService sync, CancellationToken cancellation) =>
        {
            try
            {
                return Results.Ok(await sync.SyncAsync(user.UserId(), request, cancellation));
            }
            catch (SyncRejected rejected)
            {
                return Results.Json(
                    new SyncError(rejected.Code, rejected.Message, rejected.ServerSchemaVersion),
                    statusCode: rejected.Code == "schema_mismatch" ? StatusCodes.Status409Conflict : StatusCodes.Status400BadRequest);
            }
        });
        return api;
    }
}
