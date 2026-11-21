namespace PeckList.Keys;

/// <summary>
/// What a paid order asks for: who sold it (<see cref="Provider"/>), its id there (stable: a
/// repeated notification names the same one), how to find the buyer's email when the mail goes out
/// (<see cref="Contact"/>: never the email itself), when it was bought, and the keys of each kind.
/// </summary>
public sealed record PaidOrder(string Provider, string OrderId, string? Contact, DateOnly Purchased, int PersonKeys, int ServerKeys);

/// <summary>
/// Where paid orders come from (PL-112): a payment provider that notifies the service when an order
/// is paid. Each one checks its own signature, reads its own notification, and is asked for the
/// buyer's email only when the keys are mailed. Paddle (<see cref="PaddleSource"/>) and BTCPay
/// Server (<see cref="BtcPaySource"/>) are the two; both pass the same contract tests.
/// </summary>
public interface IOrderSource
{
    /// <summary>The provider's name, stored with each key and used in routes: <c>paddle</c>, <c>btcpay</c>.</summary>
    string Provider { get; }

    /// <summary>The request header that carries the notification's signature.</summary>
    string SignatureHeader { get; }

    /// <summary>Whether <paramref name="body"/> was signed by the provider (its webhook secret).</summary>
    bool IsSigned(string? signature, ReadOnlySpan<byte> body, DateTimeOffset now);

    /// <summary>
    /// The keys a signed notification asks for, or null when it asks for none (another event, another
    /// product, an order not paid in full). Throws <see cref="OrderSourceUnavailableException"/> when
    /// the provider has to be asked and cannot be reached, so the notification is refused and sent again.
    /// </summary>
    Task<PaidOrder?> ReadAsync(ReadOnlyMemory<byte> body, CancellationToken cancellation);

    /// <summary>The buyer's email for an order's <see cref="PaidOrder.Contact"/>, or null when the provider has none.</summary>
    Task<string?> EmailOfAsync(string contact, CancellationToken cancellation);

    /// <summary>Whether <paramref name="orderId"/> looks like one of this provider's order ids (for the thank-you lookup).</summary>
    bool IsOrderId(string orderId);
}

/// <summary>The provider could not be asked about an order just now; the notification should be sent again.</summary>
public sealed class OrderSourceUnavailableException(string message, Exception? inner = null) : Exception(message, inner);

/// <summary>The order sources this service is set up for, by provider name.</summary>
public sealed class OrderSources(IEnumerable<IOrderSource> sources)
{
    private readonly Dictionary<string, IOrderSource> byName = sources.ToDictionary(source => source.Provider, StringComparer.Ordinal);

    public IOrderSource? this[string provider] => byName.GetValueOrDefault(provider);

    public IEnumerable<IOrderSource> All => byName.Values;
}
