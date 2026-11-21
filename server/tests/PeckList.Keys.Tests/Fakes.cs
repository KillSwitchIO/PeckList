using System.Globalization;
using System.Net;
using System.Text;
using System.Text.Json;
using PeckList.Core.Supporters;

namespace PeckList.Keys.Tests;

/// <summary>
/// Stand-ins for the payment providers (the fake-API-first rule): each answers its API the way the
/// real one does and sends real signed webhooks, so the service and the adapters are tested against
/// what they will meet, not against hand-made objects.
/// </summary>
public abstract class FakeProvider
{
    /// <summary>Calls the service made to this provider's API, as "METHOD path".</summary>
    public List<string> Calls { get; } = [];

    /// <summary>Set to answer every API call with this status (the provider down or refusing).</summary>
    public HttpStatusCode? Broken { get; set; }

    protected abstract HttpResponseMessage Answer(HttpRequestMessage request);

    /// <summary>A handler that answers as this provider; a new one each time, as the client factory wants.</summary>
    public HttpMessageHandler Handler() => new Responder(this);

    private sealed class Responder(FakeProvider provider) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            lock (provider.Calls) provider.Calls.Add($"{request.Method} {request.RequestUri!.AbsolutePath}");
            if (provider.Broken is { } status) return Task.FromResult(new HttpResponseMessage(status));
            return Task.FromResult(provider.Answer(request));
        }
    }

    protected static HttpResponseMessage Json(object body) =>
        new(HttpStatusCode.OK) { Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json") };
}

/// <summary>Paddle: <c>GET /customers/{id}</c> with a Bearer key, and signed <c>transaction.completed</c> notifications.</summary>
public sealed class FakePaddle(string webhookSecret, string apiKey) : FakeProvider
{
    public const string Api = "https://paddle.test";

    /// <summary>Customers by id; one without an email is a customer Paddle has none for.</summary>
    public Dictionary<string, string?> Customers { get; } = new(StringComparer.Ordinal);

    protected override HttpResponseMessage Answer(HttpRequestMessage request)
    {
        if (request.Headers.Authorization?.ToString() != $"Bearer {apiKey}") return new HttpResponseMessage(HttpStatusCode.Forbidden);
        var path = request.RequestUri!.AbsolutePath;
        if (request.Method == HttpMethod.Get && path.StartsWith("/customers/", StringComparison.Ordinal)
            && Customers.TryGetValue(Uri.UnescapeDataString(path["/customers/".Length..]), out var email))
        {
            return Json(new { data = new { id = path["/customers/".Length..], email } });
        }
        return new HttpResponseMessage(HttpStatusCode.NotFound);
    }

    public static string Completed(string transaction, string customer, params (string Price, int Quantity)[] items) =>
        JsonSerializer.Serialize(new
        {
            event_id = "evt_01",
            event_type = "transaction.completed",
            occurred_at = "2026-11-12T08:00:00.000Z",
            notification_id = "ntf_01",
            data = new
            {
                id = transaction,
                status = "completed",
                customer_id = customer,
                billed_at = "2026-11-11T23:30:00.000Z",
                items = items.Select(item => new { price = new { id = item.Price }, quantity = item.Quantity }),
            },
        });

    /// <summary>A notification as Paddle sends it: the body and its <c>Paddle-Signature</c> (or one made with <paramref name="secret"/>).</summary>
    public (string Signature, byte[] Body) Notification(string body, string? secret = null)
    {
        var bytes = Encoding.UTF8.GetBytes(body);
        return (PaddleSignature.Sign(bytes, secret ?? webhookSecret, DateTimeOffset.UtcNow), bytes);
    }
}

/// <summary>
/// BTCPay Server: the Greenfield invoice API (<c>GET /api/v1/stores/{store}/invoices/{id}</c> with
/// <c>Authorization: token ...</c>) and signed <c>InvoiceSettled</c> webhooks, as BTCPay 2.x sends them.
/// </summary>
public sealed class FakeBtcPay(string storeId, string webhookSecret, string apiKey) : FakeProvider
{
    public const string Url = "https://btcpay.test";

    public sealed record Invoice(string Id, string? ItemCode, decimal Amount, string Currency = "USD", string Status = "Settled", string? BuyerEmail = "buyer@example.com",
        long CreatedTime = 1763000000);

    public Dictionary<string, Invoice> Invoices { get; } = new(StringComparer.Ordinal);

    public string StoreId => storeId;

    protected override HttpResponseMessage Answer(HttpRequestMessage request)
    {
        if (request.Headers.Authorization?.ToString() != $"token {apiKey}") return new HttpResponseMessage(HttpStatusCode.Forbidden);
        var prefix = $"/api/v1/stores/{storeId}/invoices/";
        var path = request.RequestUri!.AbsolutePath;
        if (request.Method != HttpMethod.Get || !path.StartsWith(prefix, StringComparison.Ordinal)
            || !Invoices.TryGetValue(Uri.UnescapeDataString(path[prefix.Length..]), out var invoice))
        {
            return new HttpResponseMessage(HttpStatusCode.NotFound);
        }
        var metadata = new Dictionary<string, object?> { ["orderId"] = "pos" };
        // A Point of Sale's product list view names the item; its cart view sends posData instead.
        if (invoice.ItemCode is not null) (metadata["itemCode"], metadata["itemDesc"]) = (invoice.ItemCode, "PeckList supporter key");
        else metadata["posData"] = new { cart = new[] { new { id = "supporter-person", count = 1 } }, total = invoice.Amount };
        if (invoice.BuyerEmail is not null) metadata["buyerEmail"] = invoice.BuyerEmail;
        return Json(new
        {
            id = invoice.Id,
            storeId,
            amount = invoice.Amount.ToString(CultureInfo.InvariantCulture),
            currency = invoice.Currency,
            type = "Standard",
            checkoutLink = $"{Url}/i/{invoice.Id}",
            createdTime = invoice.CreatedTime,
            expirationTime = invoice.CreatedTime + 900,
            monitoringExpiration = invoice.CreatedTime + 87300,
            status = invoice.Status,
            additionalStatus = "None",
            archived = false,
            metadata,
        });
    }

    /// <summary>An invoice webhook as BTCPay sends it (default <c>InvoiceSettled</c>): the body and its <c>BTCPay-Sig</c>.</summary>
    public (string Signature, byte[] Body) Webhook(string invoiceId, string type = "InvoiceSettled", string? store = null, string? secret = null, long timestamp = 1763000400)
    {
        var bytes = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new
        {
            manuallyMarked = false,
            overPaid = false,
            deliveryId = "Dlv" + invoiceId,
            webhookId = "Whk1",
            originalDeliveryId = "Dlv" + invoiceId,
            isRedelivery = false,
            type,
            timestamp,
            storeId = store ?? storeId,
            invoiceId,
            metadata = new { itemCode = Invoices.TryGetValue(invoiceId, out var invoice) ? invoice.ItemCode : null },
        }));
        return (BtcPaySignature.Sign(bytes, secret ?? webhookSecret), bytes);
    }

    /// <summary>The kind an item code stands for in the settings the tests use.</summary>
    public static string ItemFor(SupporterKind kind) => kind == SupporterKind.Person ? "supporter-person" : "supporter-server";
}

/// <summary>A client factory over a fake provider, for adapters made outside the service.</summary>
public sealed class FakeClients(FakeProvider provider) : IHttpClientFactory
{
    public HttpClient CreateClient(string name) => new(provider.Handler());
}
