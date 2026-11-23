using System.Threading.RateLimiting;
using PeckList.Server.Auth;

namespace PeckList.Server.Api;

/// <summary>
/// The task API's write limit (<see cref="TaskApiEndpoints.WritesPerMinute"/> a minute per account,
/// all its keys and sessions together), held here so that more than the API's write routes can take
/// from it: the MCP connector's write tools all arrive as one <c>POST /mcp</c>, which a route's limit
/// cannot tell from a read, so they take their turn here as they run (Security and Dev 1, PL-113
/// piece 1), and MCP is no way around the limit.
/// </summary>
public sealed class TaskWriteLimit : IDisposable
{
    private readonly PartitionedRateLimiter<string> limiter = PartitionedRateLimiter.Create<string, string>(key =>
        RateLimitPartition.GetFixedWindowLimiter(key, _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = TaskApiEndpoints.WritesPerMinute,
            Window = TimeSpan.FromMinutes(1),
        }));

    /// <summary>Whose turn a request takes: its account when signed in, else its address.</summary>
    public static string KeyOf(HttpContext context) =>
        context.User.Identity?.IsAuthenticated == true ? KeyOf(context.User) : "write:address:" + AuthSetup.AddressKey(context);

    /// <summary>A signed-in caller's turn: its account's, whichever key or session it came by.</summary>
    public static string KeyOf(System.Security.Claims.ClaimsPrincipal user) => "write:account:" + user.UserId();

    /// <summary>One write's turn, now or not at all (a refused try takes nothing).</summary>
    public RateLimitLease Take(string key) => limiter.AttemptAcquire(key);

    /// <summary>The limit for <paramref name="key"/> as a limiter of its own, for the API's write policy.</summary>
    public RateLimiter For(string key) => new Partition(limiter, key);

    public void Dispose() => limiter.Dispose();

    /// <summary>A view of one key's share: it never idles out and never disposes the shared limiter.</summary>
    private sealed class Partition(PartitionedRateLimiter<string> shared, string key) : RateLimiter
    {
        public override TimeSpan? IdleDuration => null;

        public override RateLimiterStatistics? GetStatistics() => shared.GetStatistics(key);

        protected override RateLimitLease AttemptAcquireCore(int permitCount) => shared.AttemptAcquire(key, permitCount);

        protected override ValueTask<RateLimitLease> AcquireAsyncCore(int permitCount, CancellationToken cancellationToken) =>
            shared.AcquireAsync(key, permitCount, cancellationToken);
    }
}
