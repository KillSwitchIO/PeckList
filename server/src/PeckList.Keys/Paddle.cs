using System.Globalization;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using PeckList.Core.Supporters;

namespace PeckList.Keys;

/// <summary>
/// Paddle's webhook signature (developer.paddle.com, "Verify webhook signatures"): the
/// <c>Paddle-Signature</c> header reads <c>ts=&lt;unix seconds&gt;;h1=&lt;hex&gt;</c>, and h1 is
/// HMAC-SHA256, keyed with the notification destination's secret, over <c>ts:rawBody</c>. While a
/// secret is being rotated the header carries more than one h1; any one matching will do.
/// </summary>
public static class PaddleSignature
{
    /// <summary>How far the header's time may be from ours. Paddle signs each delivery afresh, so this only absorbs clock drift; a replay inside it changes nothing, since orders are issued once.</summary>
    public static readonly TimeSpan Tolerance = TimeSpan.FromMinutes(5);

    public static bool IsValid(string? header, ReadOnlySpan<byte> body, string secret, DateTimeOffset now)
    {
        if (string.IsNullOrEmpty(header)) return false;
        long? ts = null;
        var signatures = new List<string>();
        foreach (var part in header.Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            var equals = part.IndexOf('=', StringComparison.Ordinal);
            if (equals <= 0) continue;
            var (name, value) = (part[..equals], part[(equals + 1)..]);
            if (name == "ts" && long.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out var seconds)) ts = seconds;
            else if (name == "h1") signatures.Add(value);
        }
        if (ts is null || signatures.Count == 0) return false;
        if ((now - DateTimeOffset.FromUnixTimeSeconds(ts.Value)).Duration() > Tolerance) return false;

        var signed = new byte[Encoding.ASCII.GetByteCount(ts.Value.ToString(CultureInfo.InvariantCulture)) + 1 + body.Length];
        var written = Encoding.ASCII.GetBytes(ts.Value.ToString(CultureInfo.InvariantCulture), signed);
        signed[written] = (byte)':';
        body.CopyTo(signed.AsSpan(written + 1));
        var expected = HMACSHA256.HashData(Encoding.UTF8.GetBytes(secret), signed);
        foreach (var signature in signatures)
        {
            byte[] given;
            try
            {
                given = Convert.FromHexString(signature);
            }
            catch (FormatException)
            {
                continue;
            }
            if (CryptographicOperations.FixedTimeEquals(given, expected)) return true;
        }
        return false;
    }

    /// <summary>The header for a body, as Paddle would send it: for tests and the sandbox simulator's look-alikes.</summary>
    public static string Sign(ReadOnlySpan<byte> body, string secret, DateTimeOffset at)
    {
        var ts = at.ToUnixTimeSeconds().ToString(CultureInfo.InvariantCulture);
        byte[] signed = [.. Encoding.ASCII.GetBytes(ts + ":"), .. body];
        return $"ts={ts};h1={Convert.ToHexStringLower(HMACSHA256.HashData(Encoding.UTF8.GetBytes(secret), signed))}";
    }
}

/// <summary>What a paid order asks for: its transaction, the customer to email, when it was bought and the keys of each kind.</summary>
public sealed record PaidOrder(string TransactionId, string? CustomerId, DateOnly Purchased, int PersonKeys, int ServerKeys);

/// <summary>Reads Paddle's <c>transaction.completed</c> notification (developer.paddle.com, "transaction.completed").</summary>
public static class PaddleEvents
{
    /// <summary>
    /// The supporter keys a notification asks for, or null when it asks for none: another event, or
    /// an order with none of the supporter prices (a different product).
    /// </summary>
    public static PaidOrder? Read(JsonElement notification, KeySettings settings)
    {
        if (notification.ValueKind != JsonValueKind.Object) return null;
        if (!notification.TryGetProperty("event_type", out var type) || type.GetString() != "transaction.completed") return null;
        if (!notification.TryGetProperty("data", out var data) || data.ValueKind != JsonValueKind.Object) return null;
        if (!data.TryGetProperty("id", out var id) || id.GetString() is not { Length: > 0 } transactionId) return null;

        int person = 0, server = 0;
        if (data.TryGetProperty("items", out var items) && items.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in items.EnumerateArray())
            {
                var price = item.TryGetProperty("price", out var p) && p.ValueKind == JsonValueKind.Object
                    && p.TryGetProperty("id", out var priceId) ? priceId.GetString() : null;
                var quantity = item.TryGetProperty("quantity", out var q) && q.TryGetInt32(out var n) ? Math.Clamp(n, 0, KeySettings.MaxKeysPerItem) : 1;
                if (price is null) continue;
                if (settings.PersonPrices.Contains(price)) person += quantity;
                else if (settings.ServerPrices.Contains(price)) server += quantity;
            }
        }
        if (person + server == 0) return null;

        var when = Time(data, "billed_at") ?? Time(notification, "occurred_at") ?? DateTimeOffset.UtcNow;
        var customer = data.TryGetProperty("customer_id", out var c) && c.ValueKind == JsonValueKind.String ? c.GetString() : null;
        return new PaidOrder(transactionId, customer, DateOnly.FromDateTime(when.UtcDateTime), person, server);
    }

    private static DateTimeOffset? Time(JsonElement parent, string name) =>
        parent.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
        && DateTimeOffset.TryParse(value.GetString(), CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var time)
            ? time
            : null;
}

/// <summary>Who to email a customer's keys to.</summary>
public interface ICustomerEmails
{
    /// <summary>The customer's email, or null when Paddle has none for them.</summary>
    Task<string?> EmailOfAsync(string customerId, CancellationToken cancellation);
}

/// <summary>
/// Paddle's customers API: <c>GET /customers/{id}</c> (needs an API key with <c>customer.read</c>),
/// <c>data.email</c>. The email is fetched when a mail goes out and never stored here.
/// </summary>
public sealed class PaddleCustomers(HttpClient http, KeySettings settings) : ICustomerEmails
{
    public async Task<string?> EmailOfAsync(string customerId, CancellationToken cancellation)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, $"{settings.PaddleApi}/customers/{Uri.EscapeDataString(customerId)}");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", settings.PaddleApiKey);
        using var response = await http.SendAsync(request, cancellation);
        response.EnsureSuccessStatusCode();
        using var document = await JsonDocument.ParseAsync(await response.Content.ReadAsStreamAsync(cancellation), cancellationToken: cancellation);
        return document.RootElement.TryGetProperty("data", out var data) && data.TryGetProperty("email", out var email) ? email.GetString() : null;
    }
}

/// <summary>Signs supporter keys with the service's private key: the only place one is made.</summary>
public sealed class KeyIssuer(NSec.Cryptography.Key signingKey)
{
    private static readonly NSec.Cryptography.SignatureAlgorithm Ed25519 = NSec.Cryptography.SignatureAlgorithm.Ed25519;

    public SupporterKey Issue(SupporterKind kind, DateOnly purchased)
    {
        var serial = RandomNumberGenerator.GetBytes(SupporterKey.SerialBytes);
        return new SupporterKey(purchased, kind, serial, Ed25519.Sign(signingKey, SupporterKey.SignedBytes(purchased, kind, serial)));
    }

    /// <summary>The public half, raw and base64: what PeckList servers check keys against.</summary>
    public string PublicKey => Convert.ToBase64String(signingKey.PublicKey.Export(NSec.Cryptography.KeyBlobFormat.RawPublicKey));
}
