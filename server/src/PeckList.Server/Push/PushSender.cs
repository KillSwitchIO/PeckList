using System.Buffers.Text;
using System.Net;
using System.Security.Cryptography;
using System.Text.Json;
using Lib.Net.Http.WebPush;
using Lib.Net.Http.WebPush.Authentication;
using PeckList.Core.Accounts;
using PeckList.Core.Configuration;
using PeckList.Core.Push;
using WebPushSubscription = Lib.Net.Http.WebPush.PushSubscription;

namespace PeckList.Server.Push;

/// <summary>What a push shows: the app's service worker turns it into a notification (public/sw-notifications.js).</summary>
/// <param name="Sticky">A constant reminder: it stays on screen and buzzes again on each repeat.</param>
/// <summary>A button on a notification: what it says and where in the app it leads.</summary>
public sealed record PushAction(string Action, string Title, string Url);

/// <summary>
/// What a push shows, and its buttons left to right: Reply and thumbs up for a comment, Open task
/// and Call dibs for a group's task (R-FB-106, R-FB-107).
/// </summary>
public sealed record PushPayload(
    string Title, string Body, string Tag, string Url, bool Sticky = false,
    IReadOnlyList<PushAction>? Actions = null);

/// <summary>Sends a push to a person's devices.</summary>
public interface IPushSender
{
    Task SendAsync(string userId, PushPayload payload, CancellationToken cancellation = default);
}

/// <summary>
/// The server's VAPID keys (spec: PL-061): made on first use and kept with the server's secrets,
/// so browsers' subscriptions keep working across restarts.
/// </summary>
public sealed class VapidKeys(ISecretStore secrets)
{
    private const string Kind = "push";
    private readonly SemaphoreSlim gate = new(1, 1);
    private (string Public, string Private)? keys;

    public async Task<(string Public, string Private)> GetAsync(CancellationToken cancellation = default)
    {
        if (keys is { } known) return known;
        await gate.WaitAsync(cancellation);
        try
        {
            var saved = (await secrets.ListAsync(Kind, cancellation)).ToDictionary(each => each.Name, each => each.Value);
            if (saved.TryGetValue("vapid-public", out var publicKey) && saved.TryGetValue("vapid-private", out var privateKey))
            {
                return (keys = (publicKey, privateKey)).Value;
            }
            using var key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
            var parameters = key.ExportParameters(includePrivateParameters: true);
            // The public key as browsers want it: an uncompressed point (0x04, X, Y).
            publicKey = Base64Url.EncodeToString([0x04, .. parameters.Q.X!, .. parameters.Q.Y!]);
            privateKey = Base64Url.EncodeToString(parameters.D!);
            await secrets.PutAsync(Kind, "vapid-public", publicKey, cancellation);
            await secrets.PutAsync(Kind, "vapid-private", privateKey, cancellation);
            return (keys = (publicKey, privateKey)).Value;
        }
        finally
        {
            gate.Release();
        }
    }
}

/// <summary>
/// Web Push through the browsers' push services. A subscription the service says is gone (404, 410)
/// is dropped; other failures are logged and the push is skipped.
/// </summary>
public sealed class PushSender(
    IPushStore store, VapidKeys vapid, IHttpClientFactory http, ServerSettings settings, ILogger<PushSender> logger) : IPushSender
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public async Task SendAsync(string userId, PushPayload payload, CancellationToken cancellation = default)
    {
        // A demo server sends nothing anywhere (PL-117); reminders still show on the device itself.
        if (settings.DemoMode) return;
        var subscriptions = await store.ForUserAsync(userId, cancellation);
        if (subscriptions.Count == 0) return;
        var (publicKey, privateKey) = await vapid.GetAsync(cancellation);
        var client = new PushServiceClient(http.CreateClient("push"))
        {
            DefaultAuthentication = new VapidAuthentication(publicKey, privateKey)
            {
                // Push services ask who to contact about the sender: this server's address.
                Subject = settings.PublicUrl is { } url ? url.GetLeftPart(UriPartial.Authority) : "mailto:pecklist@localhost",
            },
        };
        var message = new PushMessage(JsonSerializer.Serialize(payload, Json))
        {
            TimeToLive = 24 * 3600,
            Urgency = PushMessageUrgency.High,
        };
        foreach (var subscription in subscriptions)
        {
            var target = new WebPushSubscription { Endpoint = subscription.Endpoint };
            target.SetKey(PushEncryptionKeyName.P256DH, subscription.P256dh);
            target.SetKey(PushEncryptionKeyName.Auth, subscription.Auth);
            try
            {
                await client.RequestPushMessageDeliveryAsync(target, message, cancellation);
            }
            catch (PushServiceClientException error) when (error.StatusCode is HttpStatusCode.NotFound or HttpStatusCode.Gone)
            {
                await store.RemoveAsync(subscription.Endpoint, cancellation);
            }
            catch (Exception error) when (error is not OperationCanceledException)
            {
                logger.LogWarning(error, "A push to one of {UserId}'s devices failed", userId);
            }
        }
    }
}
