using System.Collections.Concurrent;
using System.Threading.Channels;

namespace Punchlist.Core.Sync;

/// <summary>A user's data changed. <see cref="Source"/> is the device that made the change, if it said.</summary>
public sealed record ChangeEvent(long Cursor, string? Source);

/// <summary>An open subscription: changes queue in <see cref="Events"/> until it is disposed.</summary>
public interface IChangeSubscription : IDisposable
{
    ChannelReader<ChangeEvent> Events { get; }
}

/// <summary>
/// Tells a user's open devices that something changed, so they sync now instead of on their next
/// timer (architecture: <c>IChangeNotifier</c>; in-process now, PostgreSQL LISTEN/NOTIFY if several
/// server instances ever share a database).
/// </summary>
public interface IChangeNotifier
{
    void Notify(string userId, ChangeEvent change);

    /// <summary>
    /// Start hearing about <paramref name="userId"/>'s changes now: anything notified after this call
    /// returns is queued, so announce the stream as open only after subscribing.
    /// </summary>
    IChangeSubscription Subscribe(string userId);
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

    public IChangeSubscription Subscribe(string userId)
    {
        // A slow reader only needs to know that something changed: keep the latest few.
        var channel = Channel.CreateBounded<ChangeEvent>(new BoundedChannelOptions(4) { FullMode = BoundedChannelFullMode.DropOldest });
        var id = Guid.NewGuid();
        var channels = subscribers.GetOrAdd(userId, _ => new());
        channels[id] = channel;
        return new Subscription(channel.Reader, () =>
        {
            channels.TryRemove(id, out _);
            channel.Writer.TryComplete();
        });
    }

    /// <summary>Open subscriptions (tests, stats).</summary>
    public int Count(string userId) => subscribers.TryGetValue(userId, out var channels) ? channels.Count : 0;

    private sealed class Subscription(ChannelReader<ChangeEvent> events, Action close) : IChangeSubscription
    {
        public ChannelReader<ChangeEvent> Events { get; } = events;

        public void Dispose() => close();
    }
}
