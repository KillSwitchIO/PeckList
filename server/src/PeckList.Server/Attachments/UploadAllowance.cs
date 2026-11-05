using System.Collections.Concurrent;
using System.Threading.RateLimiting;

namespace PeckList.Server.Attachments;

/// <summary>
/// How much each person has uploaded lately (audit S5): bytes stored in the last 24 hours, against
/// <c>ATTACHMENT_DAILY_MB</c>, and upload requests a minute. Kept in memory: a restart forgets it,
/// which is fine for what it is for, one account filling the disk.
/// </summary>
public sealed class UploadAllowance(TimeProvider time) : IDisposable
{
    public static readonly TimeSpan Window = TimeSpan.FromHours(24);

    /// <summary>Upload requests a person may make a minute, files the server has or not.</summary>
    public const int RequestsPerMinute = 60;

    private readonly ConcurrentDictionary<string, Queue<(DateTimeOffset At, long Bytes)>> stored = new(StringComparer.Ordinal);

    private readonly PartitionedRateLimiter<string> requests = PartitionedRateLimiter.Create<string, string>(user =>
        RateLimitPartition.GetFixedWindowLimiter(user, _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = RequestsPerMinute, Window = TimeSpan.FromMinutes(1), QueueLimit = 0,
        }));

    /// <summary>Whether another upload request from <paramref name="user"/> may go ahead now.</summary>
    public bool TryRequest(string user)
    {
        using var lease = requests.AttemptAcquire(user);
        return lease.IsAcquired;
    }

    /// <summary>Bytes <paramref name="user"/> stored in the last 24 hours.</summary>
    public long Used(string user)
    {
        if (!stored.TryGetValue(user, out var queue)) return 0;
        lock (queue)
        {
            var since = time.GetUtcNow() - Window;
            while (queue.Count > 0 && queue.Peek().At <= since) queue.Dequeue();
            return queue.Sum(each => each.Bytes);
        }
    }

    /// <summary>Whether <paramref name="bytes"/> more fit in <paramref name="limitBytes"/> (0: no limit).</summary>
    public bool Fits(string user, long bytes, long limitBytes) => limitBytes <= 0 || Used(user) + Math.Max(0, bytes) <= limitBytes;

    /// <summary>Count a stored upload against <paramref name="user"/>.</summary>
    public void Add(string user, long bytes)
    {
        var queue = stored.GetOrAdd(user, _ => new Queue<(DateTimeOffset, long)>());
        lock (queue) queue.Enqueue((time.GetUtcNow(), bytes));
    }

    public void Dispose() => requests.Dispose();
}

/// <summary>Counts what is read through it, so an upload of unknown length still counts.</summary>
internal sealed class CountingStream(Stream inner) : Stream
{
    public long Count { get; private set; }

    public override bool CanRead => true;

    public override bool CanSeek => false;

    public override bool CanWrite => false;

    public override long Length => throw new NotSupportedException();

    public override long Position { get => Count; set => throw new NotSupportedException(); }

    public override int Read(byte[] buffer, int offset, int count) => Counted(inner.Read(buffer, offset, count));

    public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default) =>
        Counted(await inner.ReadAsync(buffer, cancellationToken));

    public override async Task<int> ReadAsync(byte[] buffer, int offset, int count, CancellationToken cancellationToken) =>
        Counted(await inner.ReadAsync(buffer.AsMemory(offset, count), cancellationToken));

    public override void Flush()
    {
    }

    public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();

    public override void SetLength(long value) => throw new NotSupportedException();

    public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();

    private int Counted(int read)
    {
        Count += read;
        return read;
    }
}
