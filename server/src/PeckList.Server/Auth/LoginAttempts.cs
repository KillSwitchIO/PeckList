using System.Threading.RateLimiting;

namespace PeckList.Server.Auth;

/// <summary>
/// Sign-in tries per account name, next to the per-address limit (audit S6): ten a minute, however
/// many addresses they come from. An address can be faked through a proxy that is trusted too
/// widely; the name tried cannot. Wrong passwords still lock the account on their own.
/// </summary>
public sealed class LoginAttempts : IDisposable
{
    public const int PerMinute = 10;

    private readonly PartitionedRateLimiter<string> limiter;

    public LoginAttempts()
    {
        limiter = PartitionedRateLimiter.Create<string, string>(name => RateLimitPartition.GetFixedWindowLimiter(
            name,
            _ => new FixedWindowRateLimiterOptions { PermitLimit = PerMinute, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
    }

    /// <summary>Whether another try for <paramref name="username"/> may go ahead now.</summary>
    public bool TryTake(string? username) => TryTake(username, out _);

    /// <summary>
    /// Whether another try for <paramref name="username"/> may go ahead now; if not, how long to wait
    /// at most. A refused try takes nothing, so waiting that long is always enough.
    /// </summary>
    public bool TryTake(string? username, out TimeSpan retryAfter)
    {
        using var lease = limiter.AttemptAcquire((username ?? "").Trim().ToLowerInvariant());
        retryAfter = lease.TryGetMetadata(MetadataName.RetryAfter, out var after) ? after : TimeSpan.FromMinutes(1);
        return lease.IsAcquired;
    }

    public void Dispose() => limiter.Dispose();
}
