using System.Threading.Channels;

namespace PeckList.Server;

/// <summary>
/// Work a request hands off so it need not wait for it (audit B2): Web Push to other people's
/// devices after a sync, a provider's picture after a sign-in. One job at a time, in order, each
/// given at most <see cref="JobLimit"/>; a job that fails is logged and the next one runs. When
/// <see cref="Capacity"/> jobs wait already, a new one is dropped with a warning rather than held in
/// memory. Jobs still waiting when the server stops are not run; nothing in them is the only copy
/// (a notification is in the feed before its push is queued).
/// </summary>
public sealed class BackgroundQueue(ILogger<BackgroundQueue> logger) : BackgroundService
{
    public const int Capacity = 1000;
    public static readonly TimeSpan JobLimit = TimeSpan.FromSeconds(30);

    /// <summary>How long one job may run: <see cref="JobLimit"/>, shorter in tests.</summary>
    internal TimeSpan Limit { get; set; } = JobLimit;

    private readonly Channel<(string What, Func<CancellationToken, Task> Job)> jobs =
        Channel.CreateBounded<(string, Func<CancellationToken, Task>)>(new BoundedChannelOptions(Capacity) { SingleReader = true });

    private int pending;

    /// <summary>Run <paramref name="job"/> after the request; <paramref name="what"/> names it in the log.</summary>
    public void Enqueue(string what, Func<CancellationToken, Task> job)
    {
        Interlocked.Increment(ref pending);
        if (jobs.Writer.TryWrite((what, job))) return;
        Interlocked.Decrement(ref pending);
        logger.LogWarning("Too much background work waiting: dropped {What}", what);
    }

    /// <summary>Waits until every job queued so far has run (tests).</summary>
    public async Task IdleAsync(CancellationToken cancellation = default)
    {
        while (Volatile.Read(ref pending) > 0) await Task.Delay(10, cancellation);
    }

    protected override async Task ExecuteAsync(CancellationToken stopping)
    {
        try
        {
            await foreach (var (what, job) in jobs.Reader.ReadAllAsync(stopping))
            {
                try
                {
                    using var limit = CancellationTokenSource.CreateLinkedTokenSource(stopping);
                    limit.CancelAfter(Limit);
                    await job(limit.Token);
                }
                catch (Exception error) when (!stopping.IsCancellationRequested)
                {
                    logger.LogWarning(error, "{What} failed", what);
                }
                finally
                {
                    Interlocked.Decrement(ref pending);
                }
            }
        }
        catch (OperationCanceledException) when (stopping.IsCancellationRequested)
        {
            // Stopping: what still waits is dropped.
        }
    }
}
