namespace Punchlist.Server;

/// <summary>
/// A job that runs every so often while the server is up: a first wait (so a start is not slowed),
/// then the work, then the gap, and again. A failed run is logged and the next one still comes;
/// stopping the server ends a wait at once.
/// </summary>
public abstract class PeriodicService(
    string job, TimeSpan firstAfter, TimeSpan every, TimeProvider time, ILogger logger, LogLevel failureLevel = LogLevel.Error)
    : BackgroundService
{
    protected TimeProvider Time { get; } = time;

    protected ILogger Logger { get; } = logger;

    /// <summary>One run of the job.</summary>
    protected abstract Task RunAsync(CancellationToken stopping);

    protected override async Task ExecuteAsync(CancellationToken stopping)
    {
        await Task.Delay(firstAfter, Time, stopping).ConfigureAwait(ConfigureAwaitOptions.SuppressThrowing);
        while (!stopping.IsCancellationRequested)
        {
            try
            {
                await RunAsync(stopping);
            }
            catch (Exception error) when (error is not OperationCanceledException)
            {
                Logger.Log(failureLevel, error, "{Job} failed; trying again in {Gap}", job, Describe(every));
            }
            await Task.Delay(every, Time, stopping).ConfigureAwait(ConfigureAwaitOptions.SuppressThrowing);
        }
    }

    private static string Describe(TimeSpan gap) => gap switch
    {
        { TotalDays: >= 1 } => gap.TotalDays == 1 ? "a day" : $"{gap.TotalDays:0} days",
        { TotalHours: >= 1 } => gap.TotalHours == 1 ? "an hour" : $"{gap.TotalHours:0} hours",
        { TotalMinutes: >= 1 } => gap.TotalMinutes == 1 ? "a minute" : $"{gap.TotalMinutes:0} minutes",
        _ => $"{gap.TotalSeconds:0} seconds",
    };
}
