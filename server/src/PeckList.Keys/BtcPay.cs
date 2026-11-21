using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace PeckList.Keys;

/// <summary>
/// BTCPay Server's webhook signature (docs.btcpayserver.org, "Webhooks"): the <c>BTCPay-Sig</c>
/// header reads <c>sha256=&lt;hex&gt;</c>, HMAC-SHA256 of the raw body keyed with the webhook's
/// secret. There is no time in it; a replayed delivery changes nothing, since orders are issued once.
/// </summary>
public static class BtcPaySignature
{
    private const string Prefix = "sha256=";

    public static bool IsValid(string? header, ReadOnlySpan<byte> body, string secret)
    {
        if (header is null || !header.StartsWith(Prefix, StringComparison.OrdinalIgnoreCase)) return false;
        byte[] given;
        try
        {
            given = Convert.FromHexString(header.AsSpan(Prefix.Length).Trim());
        }
        catch (FormatException)
        {
            return false;
        }
        return CryptographicOperations.FixedTimeEquals(given, HMACSHA256.HashData(Encoding.UTF8.GetBytes(secret), body));
    }

    /// <summary>The header for a body, as BTCPay would send it: for tests and the stand-in BTCPay.</summary>
    public static string Sign(ReadOnlySpan<byte> body, string secret) =>
        Prefix + Convert.ToHexStringLower(HMACSHA256.HashData(Encoding.UTF8.GetBytes(secret), body));
}

/// <summary>
/// BTCPay Server as an order source. Its <c>InvoiceSettled</c> webhook says an invoice of the
/// store is paid; the invoice itself is then read from the Greenfield API
/// (<c>GET /api/v1/stores/{storeId}/invoices/{invoiceId}</c>, an API key with
/// <c>btcpay.store.canviewinvoices</c>), since that, not the webhook, is what can be trusted about
/// it: settled, the item bought (<c>metadata.itemCode</c>, one key per invoice), and an amount of at
/// least that item's price in the store's currency (a pay button's price can be edited by whoever
/// pays). The buyer's email (<c>metadata.buyerEmail</c>) is read from the invoice when the mail goes
/// out and never stored; the order's contact is the invoice id.
/// </summary>
public sealed partial class BtcPaySource(IHttpClientFactory clients, KeySettings.BtcPaySettings settings, ILogger<BtcPaySource> logger) : IOrderSource
{
    public const string Name = "btcpay";

    public string Provider => Name;

    public string SignatureHeader => "BTCPay-Sig";

    public bool IsSigned(string? signature, ReadOnlySpan<byte> body, DateTimeOffset now) =>
        BtcPaySignature.IsValid(signature, body, settings.WebhookSecret);

    // BTCPay's invoice ids: base58, about 22 characters.
    [GeneratedRegex("^[A-Za-z0-9]{8,64}$")]
    private static partial Regex InvoiceId();

    public bool IsOrderId(string orderId) => InvoiceId().IsMatch(orderId);

    public async Task<PaidOrder?> ReadAsync(ReadOnlyMemory<byte> body, CancellationToken cancellation)
    {
        string invoiceId;
        DateTimeOffset? settledAt;
        using (var document = JsonDocument.Parse(body))
        {
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object) return null;
            if (Text(root, "type") != "InvoiceSettled") return null;
            if (Text(root, "storeId") != settings.StoreId) return null;
            if (Text(root, "invoiceId") is not { } id || !IsOrderId(id)) return null;
            invoiceId = id;
            settledAt = root.TryGetProperty("timestamp", out var ts) && ts.TryGetInt64(out var seconds) ? DateTimeOffset.FromUnixTimeSeconds(seconds) : null;
        }

        using var invoice = await InvoiceAsync(invoiceId, cancellation);
        if (invoice is null)
        {
            logger.LogWarning("BTCPay invoice {Invoice} was reported settled but the store has no such invoice", invoiceId);
            return null;
        }
        var data = invoice.RootElement;
        if (Text(data, "status") != "Settled") return null;
        var metadata = data.TryGetProperty("metadata", out var m) && m.ValueKind == JsonValueKind.Object ? m : default;
        var item = metadata.ValueKind == JsonValueKind.Object ? Text(metadata, "itemCode") : null;
        if (item is null)
        {
            // A donation has no item; so has a Point of Sale in its cart view (posData, not itemCode),
            // which would leave a paying supporter without a key, so say so.
            logger.LogInformation(
                "BTCPay invoice {Invoice} was settled with no item code: no key. Fine for a donation; a supporter key sold from a Point of Sale needs its product list view (one item per invoice)",
                invoiceId);
            return null;
        }
        var (person, server) = settings.PersonItems.Contains(item) ? (1, 0) : settings.ServerItems.Contains(item) ? (0, 1) : (0, 0);
        if (person + server == 0) return null;

        var price = person == 1 ? settings.PersonPrice : settings.ServerPrice;
        var currency = Text(data, "currency");
        var paid = Text(data, "amount") is { } amount && decimal.TryParse(amount, NumberStyles.Number, CultureInfo.InvariantCulture, out var value) ? value : (decimal?)null;
        if (!string.Equals(currency, settings.Currency, StringComparison.OrdinalIgnoreCase) || paid is null || paid < price)
        {
            logger.LogWarning("BTCPay invoice {Invoice} for {Item} was for {Amount} {Currency}, under its price of {Price} {StoreCurrency}: no key",
                invoiceId, item, paid, currency, price, settings.Currency);
            return null;
        }
        var created = data.TryGetProperty("createdTime", out var ct) && ct.TryGetInt64(out var createdSeconds) ? DateTimeOffset.FromUnixTimeSeconds(createdSeconds) : (DateTimeOffset?)null;
        var when = settledAt ?? created ?? DateTimeOffset.UtcNow;
        return new PaidOrder(Name, invoiceId, invoiceId, DateOnly.FromDateTime(when.UtcDateTime), person, server);
    }

    public async Task<string?> EmailOfAsync(string contact, CancellationToken cancellation)
    {
        using var invoice = await InvoiceAsync(contact, cancellation);
        return invoice is not null
            && invoice.RootElement.TryGetProperty("metadata", out var metadata) && metadata.ValueKind == JsonValueKind.Object
            && Text(metadata, "buyerEmail") is { Length: > 0 } email
                ? email
                : null;
    }

    /// <summary>The invoice from the Greenfield API, or null when the store has none by that id.</summary>
    private async Task<JsonDocument?> InvoiceAsync(string invoiceId, CancellationToken cancellation)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get,
            $"{settings.Url}/api/v1/stores/{Uri.EscapeDataString(settings.StoreId)}/invoices/{Uri.EscapeDataString(invoiceId)}");
        request.Headers.Authorization = new AuthenticationHeaderValue("token", settings.ApiKey);
        HttpResponseMessage response;
        try
        {
            response = await clients.CreateClient(Name).SendAsync(request, cancellation);
        }
        catch (Exception error) when (error is HttpRequestException or TaskCanceledException && !cancellation.IsCancellationRequested)
        {
            throw new OrderSourceUnavailableException("BTCPay could not be reached", error);
        }
        using (response)
        {
            if (response.StatusCode == HttpStatusCode.NotFound) return null;
            if (!response.IsSuccessStatusCode)
            {
                throw new OrderSourceUnavailableException($"BTCPay answered {(int)response.StatusCode} for an invoice (check BTCPAY_API_KEY_FILE's permissions)");
            }
            return await JsonDocument.ParseAsync(await response.Content.ReadAsStreamAsync(cancellation), cancellationToken: cancellation);
        }
    }

    private static string? Text(JsonElement parent, string name) =>
        parent.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;
}
