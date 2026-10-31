using System.Collections.Concurrent;
using Punchlist.Core.Configuration;

namespace Punchlist.Server.Auth;

/// <summary>
/// How many accounts one address may make by sign-up in an hour (<c>SIGNUP_RATE_LIMIT</c>, PL-117).
/// The per-minute limit on <c>/auth/signup</c> counts tries; this counts accounts made, so an open
/// server (a demo above all) cannot be filled with accounts from one machine.
/// </summary>
public sealed class SignUpThrottle(LiveSettings live, TimeProvider time)
{
    public static readonly TimeSpan Window = TimeSpan.FromHours(1);

    private readonly ConcurrentDictionary<string, Queue<DateTimeOffset>> made = new(StringComparer.Ordinal);

    /// <summary>Whether <paramref name="address"/> may make another account now.</summary>
    public bool Allows(string address)
    {
        var limit = live.Current.SignUpRateLimit;
        if (limit == 0 || !made.TryGetValue(address, out var times)) return true;
        lock (times)
        {
            Forget(times);
            return times.Count < limit;
        }
    }

    /// <summary>One more account from <paramref name="address"/>.</summary>
    public void Record(string address)
    {
        var times = made.GetOrAdd(address, _ => new Queue<DateTimeOffset>());
        lock (times)
        {
            Forget(times);
            times.Enqueue(time.GetUtcNow());
        }
        // Addresses whose hour is over go, so the table stays as small as the last hour's sign-ups.
        if (made.Count > 1000)
        {
            foreach (var (key, queue) in made)
            {
                lock (queue)
                {
                    Forget(queue);
                    if (queue.Count == 0) made.TryRemove(key, out _);
                }
            }
        }
    }

    private void Forget(Queue<DateTimeOffset> times)
    {
        var since = time.GetUtcNow() - Window;
        while (times.TryPeek(out var first) && first <= since) times.Dequeue();
    }
}
