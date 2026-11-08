using System.Threading.Channels;

namespace PeckList.Server.Logging;

/// <summary>One output: the console, the files, or a log server.</summary>
public interface ILogSink : IAsyncDisposable
{
    /// <summary><c>console</c>, <c>file</c>, <c>otlp</c>, <c>loki</c>, <c>gelf</c>, <c>elastic</c> or <c>syslog</c>.</summary>
    string Name { get; }

    /// <summary>Where it goes, as shown to admins: never a password.</summary>
    string Destination { get; }

    /// <summary>The most entries sent together.</summary>
    int BatchSize { get; }

    /// <summary>How long to gather a batch before sending (zero: send what is there).</summary>
    TimeSpan BatchDelay { get; }

    Task WriteAsync(IReadOnlyList<LogRecord> batch, CancellationToken cancellation);
}

/// <summary>A log server refused or could not take a batch; <see cref="Retry"/> says whether trying again may help.</summary>
public sealed class LogShipException(string message, bool retry) : Exception(message)
{
    public bool Retry { get; } = retry;
}

/// <summary>How an output is doing, for the admin page and the debug dump.</summary>
public sealed record LogTargetStatus(
    string Name,
    string Destination,
    bool Healthy,
    long Sent,
    long Dropped,
    long Failures,
    int Queued,
    DateTimeOffset? LastSent,
    DateTimeOffset? LastFailure,
    string? LastError);

/// <summary>
/// Feeds one sink from its own bounded queue on its own loop, so a slow or dead log server never
/// holds up the server: when the queue is full, new entries are dropped and counted. Failed
/// batches are retried with growing waits (up to 30 s) while the queue absorbs what arrives.
/// </summary>
public sealed class LogTarget : IAsyncDisposable
{
    private readonly ILogSink sink;
    private readonly Channel<LogRecord> queue;
    private readonly CancellationTokenSource stopping = new();
    private readonly TimeProvider time;
    private readonly Func<string, string> redact;
    private readonly Action<LogTarget, bool>? healthChanged;
    private readonly Task loop;
    private long sent;
    private long dropped;
    private long failures;
    private DateTimeOffset? lastSent;
    private DateTimeOffset? lastFailure;
    private string? lastError;
    private volatile bool healthy = true;
    private volatile bool draining;
    private int queued;
    private int stopped;

    public LogTarget(
        string key, ILogSink sink, int capacity, TimeProvider time, Func<string, string> redact, Action<LogTarget, bool>? healthChanged = null)
    {
        Key = key;
        this.sink = sink;
        this.time = time;
        this.redact = redact;
        this.healthChanged = healthChanged;
        queue = Channel.CreateBounded<LogRecord>(
            new BoundedChannelOptions(capacity) { FullMode = BoundedChannelFullMode.DropWrite, SingleReader = true },
            _ =>
            {
                Interlocked.Increment(ref dropped);
                Interlocked.Decrement(ref queued);
            });
        loop = Task.Run(RunAsync);
    }

    /// <summary>What the sink was made from: an unchanged key keeps the target (and its counters) across a settings change.</summary>
    public string Key { get; }

    public string Name => sink.Name;

    public LogTargetStatus Status => new(
        sink.Name, sink.Destination, healthy, Interlocked.Read(ref sent), Interlocked.Read(ref dropped), Interlocked.Read(ref failures),
        Math.Max(0, Volatile.Read(ref queued)), lastSent, lastFailure, lastError);

    /// <summary>Queue an entry; never waits.</summary>
    public void Offer(LogRecord record)
    {
        Interlocked.Increment(ref queued);
        if (!queue.Writer.TryWrite(record))
        {
            // Closed: the target is being replaced or the server is stopping.
            Interlocked.Decrement(ref queued);
        }
    }

    private async Task RunAsync()
    {
        var batch = new List<LogRecord>(sink.BatchSize);
        try
        {
            while (await queue.Reader.WaitToReadAsync(stopping.Token))
            {
                batch.Clear();
                Fill(batch);
                if (batch.Count < sink.BatchSize && sink.BatchDelay > TimeSpan.Zero && !draining)
                {
                    try
                    {
                        await Task.Delay(sink.BatchDelay, time, stopping.Token);
                    }
                    catch (OperationCanceledException)
                    {
                    }
                    Fill(batch);
                }
                await SendAsync(batch);
            }
        }
        catch (OperationCanceledException)
        {
        }
        while (queue.Reader.TryRead(out _))
        {
            Interlocked.Increment(ref dropped);
        }
    }

    private void Fill(List<LogRecord> batch)
    {
        while (batch.Count < sink.BatchSize && queue.Reader.TryRead(out var record))
        {
            Interlocked.Decrement(ref queued);
            batch.Add(record);
        }
    }

    private async Task SendAsync(List<LogRecord> batch)
    {
        if (batch.Count == 0) return;
        for (var attempt = 0; ; attempt++)
        {
            try
            {
                await sink.WriteAsync(batch, stopping.Token);
                // Health first, then the count: whoever sees the count also sees the health.
                lastSent = time.GetUtcNow();
                SetHealthy(true);
                Interlocked.Add(ref sent, batch.Count);
                return;
            }
            catch (OperationCanceledException) when (stopping.IsCancellationRequested)
            {
                Interlocked.Add(ref dropped, batch.Count);
                throw;
            }
            catch (Exception error)
            {
                lastFailure = time.GetUtcNow();
                var message = redact(error is LogShipException ? error.Message : $"{error.GetType().Name}: {error.Message}");
                lastError = Core.SafeText.Cut(message, 300);
                SetHealthy(false);
                Interlocked.Increment(ref failures);
                if (error is LogShipException { Retry: false } || draining)
                {
                    Interlocked.Add(ref dropped, batch.Count);
                    return;
                }
                await Task.Delay(TimeSpan.FromSeconds(Math.Min(30, 1 << Math.Min(attempt, 5))), time, stopping.Token);
            }
        }
    }

    private void SetHealthy(bool now)
    {
        if (healthy == now) return;
        healthy = now;
        healthChanged?.Invoke(this, now);
    }

    /// <summary>Send what is queued (for up to <paramref name="flush"/>), then stop.</summary>
    public async ValueTask StopAsync(TimeSpan flush)
    {
        if (Interlocked.Exchange(ref stopped, 1) == 1) return;
        draining = true;
        queue.Writer.TryComplete();
        if (await Task.WhenAny(loop, Task.Delay(flush)) != loop) await stopping.CancelAsync();
        try
        {
            await loop;
        }
        catch (Exception)
        {
            // The loop's own failures are counted; stopping must not throw.
        }
        await sink.DisposeAsync();
        stopping.Dispose();
    }

    public ValueTask DisposeAsync() => StopAsync(TimeSpan.FromSeconds(3));
}
