using System.Globalization;

namespace Punchlist.Core.Sync;

/// <summary>
/// Stamps changes the server makes itself (profiles, friendships from a link), in the same HLC
/// format as devices: <c>&lt;ISO time&gt;-&lt;counter&gt;-server</c>. Strictly increasing within the process,
/// and, like a device's clock (web/src/core/hlc.ts), after every stamp it has seen (<see cref="Observe"/>):
/// a device whose clock runs ahead must not make the server's own changes lose to older ones.
/// </summary>
public sealed class ServerClock(TimeProvider time)
{
    public const string Node = "server";
    private readonly Lock gate = new();
    private long lastMs;
    private int counter;

    public string Next()
    {
        lock (gate)
        {
            var now = time.GetUtcNow().ToUnixTimeMilliseconds();
            if (now > lastMs)
            {
                lastMs = now;
                counter = 0;
            }
            else if (++counter > 9999)
            {
                lastMs++;
                counter = 0;
            }
            var wall = DateTimeOffset.FromUnixTimeMilliseconds(lastMs).UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);
            return $"{wall}-{counter:D4}-{Node}";
        }
    }

    /// <summary>
    /// Take in a stamp a device sent (an HLC's receive), so the server's next stamps sort after it.
    /// Only stamps at most <see cref="MaxObservedAhead"/> ahead of the server's time: one device with
    /// a fast clock must not push every later server-made change into the future, where people's own
    /// edits would lose to it until the wall time caught up. Server writes that must win over a stored
    /// stamp get the stamp just after it instead (<see cref="SyncService.Supersede"/>).
    /// </summary>
    public void Observe(string? stamp)
    {
        if (!Hlc.IsValid(stamp)) return;
        var wall = Hlc.WallTime(stamp!).ToUnixTimeMilliseconds();
        var seen = Hlc.Counter(stamp!);
        lock (gate)
        {
            if (wall - time.GetUtcNow().ToUnixTimeMilliseconds() > MaxObservedAhead.TotalMilliseconds) return;
            if (wall > lastMs || (wall == lastMs && seen > counter))
            {
                lastMs = wall;
                counter = seen;
            }
        }
    }

    /// <summary>How far ahead of the server's own time a device's stamp may move this clock.</summary>
    public static readonly TimeSpan MaxObservedAhead = TimeSpan.FromMinutes(1);

    /// <summary>The current time as the workspace writes dates (<c>2026-10-21T10:00:00.000Z</c>).</summary>
    public string Now() => time.GetUtcNow().UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);
}
