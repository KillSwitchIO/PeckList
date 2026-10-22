using System.Globalization;

namespace Punchlist.Core.Sync;

/// <summary>
/// Stamps changes the server makes itself (profiles, friendships from a link), in the same HLC
/// format as devices: <c>&lt;ISO time&gt;-&lt;counter&gt;-server</c>. Strictly increasing within the process.
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

    /// <summary>The current time as the workspace writes dates (<c>2026-10-21T10:00:00.000Z</c>).</summary>
    public string Now() => time.GetUtcNow().UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);
}
