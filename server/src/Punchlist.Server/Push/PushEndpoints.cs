using System.Security.Claims;
using Punchlist.Core.Push;
using Punchlist.Server.Auth;

namespace Punchlist.Server.Push;

public sealed record PushKey(string PublicKey);

public sealed record PushKeys(string? P256dh, string? Auth);

/// <summary>A browser's subscription as <c>PushSubscription.toJSON()</c> gives it.</summary>
public sealed record PushSubscribe(string? Endpoint, PushKeys? Keys);

public sealed record PushUnsubscribe(string? Endpoint);

/// <summary>Web Push (spec: PL-061): the server's key, and this browser's subscription.</summary>
public static class PushEndpoints
{
    public static RouteGroupBuilder MapPush(this RouteGroupBuilder api)
    {
        api.MapGet("/push/key", async (VapidKeys vapid, CancellationToken cancellation) =>
            new PushKey((await vapid.GetAsync(cancellation)).Public));

        api.MapPost("/push/subscriptions", async (PushSubscribe request, ClaimsPrincipal user, IPushStore store, CancellationToken cancellation) =>
        {
            if (!Uri.TryCreate(request.Endpoint, UriKind.Absolute, out var endpoint) || endpoint.Scheme != Uri.UriSchemeHttps
                || string.IsNullOrWhiteSpace(request.Keys?.P256dh) || string.IsNullOrWhiteSpace(request.Keys?.Auth))
            {
                return Results.BadRequest(new { error = "invalid_subscription" });
            }
            await store.SaveAsync(new PushSubscription(user.UserId(), request.Endpoint!, request.Keys.P256dh, request.Keys.Auth), cancellation);
            return Results.NoContent();
        });

        api.MapPost("/push/unsubscribe", async (PushUnsubscribe request, ClaimsPrincipal user, IPushStore store, CancellationToken cancellation) =>
        {
            // Only one's own: an endpoint someone else holds is left alone.
            if (request.Endpoint is { } endpoint
                && (await store.ForUserAsync(user.UserId(), cancellation)).Any(each => each.Endpoint == endpoint))
            {
                await store.RemoveAsync(endpoint, cancellation);
            }
            return Results.NoContent();
        });

        return api;
    }
}
