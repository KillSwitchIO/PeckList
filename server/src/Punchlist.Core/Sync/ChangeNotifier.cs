using System.Collections.Concurrent;
using System.Runtime.CompilerServices;
using System.Threading.Channels;

namespace Punchlist.Core.Sync;

/// <summary>A user's data changed. <see cref="Source"/> is the device that made the change, if it said.</summary>
public sealed record ChangeEvent(long Cursor, string? Source);

/// <summary>
/// Tells a user's open devices that something changed, so they sync now instead of on their next
/// timer (architecture: <c>IChangeNotifier</c>; in-process now, PostgreSQL LISTEN/NOTIFY if several
/// server instances ever share a database).
/// </summary>
public interface IChangeNotifier
{
    void Notify(string userId, ChangeEvent change);

    /// <summary>Changes for <paramref name="userId"/> until cancelled.</summary>
    IAsyncEnumerable<ChangeEvent> SubscribeAsync(string userId, CancellationToken cancellation);
}

/// <summary>Within one server process.</summary>
public sealed class InProcessChangeNotifier : IChangeNotifier
{
    private readonly ConcurrentDictionary<string, ConcurrentDictionary<Guid, Channel<ChangeEvent>>> subscribers = new();

    public void Notify(string userId, ChangeEvent change)
    {
        if (!subscribers.TryGetValue(userId, out var channels)) return;
        foreach (var channel in channels.Values) channel.Writer.TryWrite(change);
    }

    public async IAsyncEnumerable<ChangeEvent> SubscribeAsync(string userId, [EnumeratorCancellation] CancellationToken cancellation)
    {
        // A slow reader only needs to know that something changed: keep the latest few.
        var channel = Channel.CreateBounded<ChangeEvent>(new BoundedChannelOptions(4) { FullMode = BoundedChannelFullMode.DropOldest });
        var id = Guid.NewGuid();
        var channels = subscribers.GetOrAdd(userId, _ => new());
        channels[id] = channel;
        try
        {
            await foreach (var change in channel.Reader.ReadAllAsync(cancellation))
            {
                yield return change;
            }
        }
        finally
        {
            channels.TryRemove(id, out _);
        }
    }

    /// <summary>Open subscriptions (tests, stats).</summary>
    public int Count(string userId) => subscribers.TryGetValue(userId, out var channels) ? channels.Count : 0;
}
