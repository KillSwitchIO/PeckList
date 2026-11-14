using System.Threading.RateLimiting;

namespace PeckList.Keys;

/// <summary>
/// Rate limits by caller, so one client looping on the thank-you lookup can't hold every buyer's
/// page at 429. The caller is the connection's address or, behind a proxy named in
/// <c>KEYS_TRUSTED_PROXIES</c>, the address that proxy saw. Each public route also has an overall
/// cap, far above what one caller may use, so many callers at once can't swamp the service.
/// </summary>
public static class KeyLimits
{
    /// <summary>Paddle's notifications, from one address a minute.</summary>
    public const int WebhookPerClient = 120;
    /// <summary>The thank-you page asks a few times while the order's notification arrives; guessing transaction ids gets nowhere at this pace.</summary>
    public const int ThanksPerClient = 30;
    /// <summary>Each public route, all callers together, a minute.</summary>
    public const int PerRouteOverall = 1200;

    /// <summary>
    /// The caller: an IPv4 address, or an IPv6 /64, since one connection usually holds a whole /64
    /// and could otherwise spread over endless addresses. The same rule as the PeckList server's
    /// <c>AuthSetup.AddressKey</c>.
    /// </summary>
    public static string Client(HttpContext context)
    {
        if (context.Connection.RemoteIpAddress is not { } address) return "unknown";
        if (address.IsIPv4MappedToIPv6) address = address.MapToIPv4();
        if (address.AddressFamily != System.Net.Sockets.AddressFamily.InterNetworkV6) return address.ToString();
        var bytes = address.GetAddressBytes();
        Array.Clear(bytes, 8, 8);
        return new System.Net.IPAddress(bytes) + "/64";
    }

    public static Func<HttpContext, RateLimitPartition<string>> PerClient(int permits) =>
        context => RateLimitPartition.GetFixedWindowLimiter(Client(context), _ => Minute(permits));

    /// <summary>The overall cap of each public route; the private health check goes unlimited.</summary>
    public static PartitionedRateLimiter<HttpContext> Overall() =>
        PartitionedRateLimiter.Create<HttpContext, string>(context =>
            context.Request.Path.StartsWithSegments("/api/public/paddle") ? RateLimitPartition.GetFixedWindowLimiter("webhook", _ => Minute(PerRouteOverall))
            : context.Request.Path.StartsWithSegments("/api/public") ? RateLimitPartition.GetFixedWindowLimiter("public", _ => Minute(PerRouteOverall))
            : RateLimitPartition.GetNoLimiter("private"));

    private static FixedWindowRateLimiterOptions Minute(int permits) =>
        new() { PermitLimit = permits, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 };
}

/// <summary>
/// Counts refused webhook calls and lets one warning through per <paramref name="every"/>, so a
/// stream of unsigned calls can't flood the log; the warning says how many there were.
/// </summary>
public sealed class RefusalLog(TimeSpan every)
{
    private readonly Lock gate = new();
    private int count;
    private DateTimeOffset next = DateTimeOffset.MinValue;

    /// <summary>One more refusal: how many to report now, this one included, or 0 to stay quiet.</summary>
    public int Add(DateTimeOffset now)
    {
        lock (gate)
        {
            count++;
            if (now < next) return 0;
            next = now + every;
            var reported = count;
            count = 0;
            return reported;
        }
    }
}
