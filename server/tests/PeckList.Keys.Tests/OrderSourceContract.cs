using System.Net;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using PeckList.Core.Supporters;

namespace PeckList.Keys.Tests;

/// <summary>
/// What every order source must do (PL-112), whichever provider it speaks to: a signed paid
/// notification reads as keys of the kind bought, under a stable order id, with a contact that
/// finds the buyer's email; anything unsigned or changed is refused; other events ask for nothing.
/// Paddle and BTCPay each pass it against their stand-in.
/// </summary>
public abstract class OrderSourceContract
{
    protected static CancellationToken Token => TestContext.Current.CancellationToken;

    protected abstract IOrderSource Source { get; }

    /// <summary>A signed notification that one key of <paramref name="kind"/> was paid for, by a buyer with <paramref name="email"/>.</summary>
    protected abstract (string Signature, byte[] Body) Paid(SupporterKind kind, string orderId, string email);

    /// <summary>A signed notification of something else (not a paid order).</summary>
    protected abstract (string Signature, byte[] Body) OtherEvent(string orderId);

    /// <summary>An order id this provider would never hand out.</summary>
    protected abstract string ForeignOrderId { get; }

    /// <summary>Two order ids of this provider.</summary>
    protected abstract (string First, string Second) OrderIds { get; }

    [Theory]
    [InlineData(SupporterKind.Person)]
    [InlineData(SupporterKind.Server)]
    public async Task A_signed_paid_notification_asks_for_a_key_of_its_kind_under_the_provider_and_order(SupporterKind kind)
    {
        var (signature, body) = Paid(kind, OrderIds.First, "first@example.com");
        Assert.True(Source.IsSigned(signature, body, DateTimeOffset.UtcNow));
        var order = await Source.ReadAsync(body, Token);
        Assert.NotNull(order);
        Assert.Equal(Source.Provider, order.Provider);
        Assert.Equal(OrderIds.First, order.OrderId);
        Assert.Equal(kind == SupporterKind.Person ? (1, 0) : (0, 1), (order.PersonKeys, order.ServerKeys));
        Assert.True(Source.IsOrderId(order.OrderId));
        Assert.NotNull(order.Contact);
        Assert.Equal("first@example.com", await Source.EmailOfAsync(order.Contact, Token));
    }

    [Fact]
    public async Task The_same_notification_twice_names_the_same_order_and_another_order_another()
    {
        var (_, body) = Paid(SupporterKind.Person, OrderIds.First, "first@example.com");
        var (_, other) = Paid(SupporterKind.Person, OrderIds.Second, "second@example.com");
        var once = await Source.ReadAsync(body, Token);
        var again = await Source.ReadAsync(body, Token);
        var different = await Source.ReadAsync(other, Token);
        Assert.Equal(once, again);
        Assert.NotEqual(once!.OrderId, different!.OrderId);
    }

    [Fact]
    public void Unsigned_wrongly_signed_or_changed_notifications_are_refused()
    {
        var (signature, body) = Paid(SupporterKind.Person, OrderIds.First, "first@example.com");
        Assert.False(Source.IsSigned(null, body, DateTimeOffset.UtcNow));
        Assert.False(Source.IsSigned("", body, DateTimeOffset.UtcNow));
        Assert.False(Source.IsSigned("sha256=00;ts=1;h1=00", body, DateTimeOffset.UtcNow));
        var changed = (byte[])body.Clone();
        changed[^2] ^= 1;
        Assert.False(Source.IsSigned(signature, changed, DateTimeOffset.UtcNow));
        Assert.False(Source.IsSigned(SignedWithAnotherSecret(body), body, DateTimeOffset.UtcNow));
    }

    /// <summary>The provider's signature over <paramref name="body"/> with a secret that is not the webhook's.</summary>
    protected abstract string SignedWithAnotherSecret(byte[] body);

    [Fact]
    public async Task Other_events_ask_for_no_keys()
    {
        var (signature, body) = OtherEvent(OrderIds.First);
        Assert.True(Source.IsSigned(signature, body, DateTimeOffset.UtcNow));
        Assert.Null(await Source.ReadAsync(body, Token));
    }

    [Fact]
    public void Order_ids_from_elsewhere_are_not_this_providers()
    {
        Assert.False(Source.IsOrderId(ForeignOrderId));
        Assert.False(Source.IsOrderId(""));
        Assert.False(Source.IsOrderId(new string('a', 200)));
    }
}

public sealed class PaddleSourceContract : OrderSourceContract
{
    private readonly FakePaddle paddle = new("pdl_ntfset_contract", "pdl_apikey_contract");
    private readonly PaddleSource source;

    public PaddleSourceContract()
    {
        source = new PaddleSource(new FakeClients(paddle), new KeySettings.PaddleSettings(
            "pdl_ntfset_contract", "pdl_apikey_contract", FakePaddle.Api, new HashSet<string> { "pri_person" }, new HashSet<string> { "pri_server" }));
    }

    protected override IOrderSource Source => source;

    protected override (string Signature, byte[] Body) Paid(SupporterKind kind, string orderId, string email)
    {
        var customer = "ctm_" + orderId;
        paddle.Customers[customer] = email;
        return paddle.Notification(FakePaddle.Completed(orderId, customer, (kind == SupporterKind.Person ? "pri_person" : "pri_server", 1)));
    }

    protected override (string Signature, byte[] Body) OtherEvent(string orderId) =>
        paddle.Notification($$$"""{"event_type":"transaction.created","data":{"id":"{{{orderId}}}","items":[{"price":{"id":"pri_person"},"quantity":1}]}}""");

    protected override string SignedWithAnotherSecret(byte[] body) => PaddleSignature.Sign(body, "not-the-secret", DateTimeOffset.UtcNow);

    protected override string ForeignOrderId => "W7Ay3xkRbBnJz2EqVdF1sP";

    protected override (string First, string Second) OrderIds => ("txn_01contract", "txn_02contract");
}

public sealed class BtcPaySourceContract : OrderSourceContract
{
    private const string Store = "StoreAbc123";
    private readonly FakeBtcPay btcpay = new(Store, "whsec-contract", "apikey-contract");
    private readonly BtcPaySource source;

    public BtcPaySourceContract()
    {
        source = Make(btcpay);
    }

    internal static BtcPaySource Make(FakeBtcPay btcpay, ILogger<BtcPaySource>? logger = null) =>
        new(new FakeClients(btcpay), new KeySettings.BtcPaySettings(
                FakeBtcPay.Url, btcpay.StoreId, "whsec-contract", "apikey-contract",
                new HashSet<string> { FakeBtcPay.ItemFor(SupporterKind.Person) }, new HashSet<string> { FakeBtcPay.ItemFor(SupporterKind.Server) },
                "USD", 5m, 25m),
            logger ?? NullLogger<BtcPaySource>.Instance);

    protected override IOrderSource Source => source;

    protected override (string Signature, byte[] Body) Paid(SupporterKind kind, string orderId, string email)
    {
        btcpay.Invoices[orderId] = new FakeBtcPay.Invoice(orderId, FakeBtcPay.ItemFor(kind), kind == SupporterKind.Person ? 5m : 25m, BuyerEmail: email);
        return btcpay.Webhook(orderId);
    }

    protected override (string Signature, byte[] Body) OtherEvent(string orderId)
    {
        btcpay.Invoices[orderId] = new FakeBtcPay.Invoice(orderId, FakeBtcPay.ItemFor(SupporterKind.Person), 5m, Status: "Processing");
        return btcpay.Webhook(orderId, type: "InvoiceProcessing");
    }

    protected override string SignedWithAnotherSecret(byte[] body) => BtcPaySignature.Sign(body, "not-the-secret");

    protected override string ForeignOrderId => "txn_01h8bxyz";

    protected override (string First, string Second) OrderIds => ("W7Ay3xkRbBnJz2EqVdF1sP", "Q9Lm4tCwYh8KpRs2NvXe5u");
}

/// <summary>What only BTCPay needs checking: the invoice, read from its API, decides, not the webhook.</summary>
public sealed class BtcPaySourceTests
{
    private static CancellationToken Token => TestContext.Current.CancellationToken;
    private readonly FakeBtcPay btcpay = new("StoreAbc123", "whsec-contract", "apikey-contract");

    private async Task<PaidOrder?> Read(FakeBtcPay.Invoice invoice, string? store = null)
    {
        btcpay.Invoices[invoice.Id] = invoice;
        return await BtcPaySourceContract.Make(btcpay).ReadAsync(btcpay.Webhook(invoice.Id, store: store).Body, Token);
    }

    [Fact]
    public async Task An_invoice_paying_less_than_the_price_or_in_another_currency_gets_no_key()
    {
        Assert.Null(await Read(new FakeBtcPay.Invoice("Under5abcdefgh", "supporter-person", 4.99m)));
        Assert.Null(await Read(new FakeBtcPay.Invoice("Under25abcdefgh", "supporter-server", 5m)));
        Assert.Null(await Read(new FakeBtcPay.Invoice("EuroAbcdefghij", "supporter-person", 5m, Currency: "EUR")));
        Assert.NotNull(await Read(new FakeBtcPay.Invoice("Over5abcdefghi", "supporter-person", 7.5m, Currency: "usd")));
    }

    [Fact]
    public async Task The_api_not_the_webhook_decides_whether_it_is_settled_and_what_was_bought()
    {
        // The webhook says settled; the invoice says otherwise.
        Assert.Null(await Read(new FakeBtcPay.Invoice("NotSettledYetx", "supporter-person", 5m, Status: "Processing")));
        // A donation (no supporter item) is still a donation.
        Assert.Null(await Read(new FakeBtcPay.Invoice("DonationAbcdef", "donation", 50m)));
        // Another store's webhook is not this store's order, and the API is never asked.
        Assert.Null(await Read(new FakeBtcPay.Invoice("OtherStoreAbcd", "supporter-person", 5m), store: "SomeOtherStore"));
        Assert.DoesNotContain(btcpay.Calls, call => call.EndsWith("OtherStoreAbcd", StringComparison.Ordinal));
        // An invoice the store does not have.
        Assert.Null(await BtcPaySourceContract.Make(btcpay).ReadAsync(btcpay.Webhook("NoSuchInvoice1").Body, Token));
    }

    [Fact]
    public async Task The_day_on_the_key_is_the_day_it_was_settled()
    {
        btcpay.Invoices["DatedAbcdefghi"] = new FakeBtcPay.Invoice("DatedAbcdefghi", "supporter-person", 5m);
        var order = await BtcPaySourceContract.Make(btcpay).ReadAsync(btcpay.Webhook("DatedAbcdefghi", timestamp: new DateTimeOffset(2026, 11, 21, 23, 59, 0, TimeSpan.Zero).ToUnixTimeSeconds()).Body, Token);
        Assert.Equal(new DateOnly(2026, 11, 21), order!.Purchased);
    }

    [Fact]
    public async Task Btcpay_down_or_refusing_the_api_key_means_try_again_later()
    {
        btcpay.Invoices["RetryAbcdefghi"] = new FakeBtcPay.Invoice("RetryAbcdefghi", "supporter-person", 5m);
        var body = btcpay.Webhook("RetryAbcdefghi").Body;
        btcpay.Broken = HttpStatusCode.BadGateway;
        await Assert.ThrowsAsync<OrderSourceUnavailableException>(() => BtcPaySourceContract.Make(btcpay).ReadAsync(body, Token));
        btcpay.Broken = HttpStatusCode.Forbidden;
        var refused = await Assert.ThrowsAsync<OrderSourceUnavailableException>(() => BtcPaySourceContract.Make(btcpay).ReadAsync(body, Token));
        Assert.Contains("BTCPAY_API_KEY_FILE", refused.Message);
        btcpay.Broken = null;
        Assert.NotNull(await BtcPaySourceContract.Make(btcpay).ReadAsync(body, Token));
    }

    [Fact]
    public async Task A_settled_invoice_with_no_item_code_gets_no_key_and_says_why()
    {
        // A Point of Sale in its cart view: posData, no itemCode.
        btcpay.Invoices["CartViewAbcdef"] = new FakeBtcPay.Invoice("CartViewAbcdef", ItemCode: null, 5m);
        var logger = new ListLogger();
        Assert.Null(await BtcPaySourceContract.Make(btcpay, logger).ReadAsync(btcpay.Webhook("CartViewAbcdef").Body, Token));
        var line = Assert.Single(logger.Lines);
        Assert.Equal(LogLevel.Information, line.Level);
        Assert.Contains("CartViewAbcdef", line.Text);
        Assert.Contains("product list view", line.Text);
    }

    private sealed class ListLogger : ILogger<BtcPaySource>
    {
        public List<(LogLevel Level, string Text)> Lines { get; } = [];
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(LogLevel logLevel) => true;
        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter) =>
            Lines.Add((logLevel, formatter(state, exception)));
    }

    [Fact]
    public async Task An_invoice_without_a_buyer_email_has_nobody_to_mail()
    {
        btcpay.Invoices["NoEmailAbcdefg"] = new FakeBtcPay.Invoice("NoEmailAbcdefg", "supporter-person", 5m, BuyerEmail: null);
        Assert.Null(await BtcPaySourceContract.Make(btcpay).EmailOfAsync("NoEmailAbcdefg", Token));
    }
}
