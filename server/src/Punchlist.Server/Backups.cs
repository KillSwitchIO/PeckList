using Punchlist.Core.Backup;
using Punchlist.Core.Configuration;

namespace Punchlist.Server;

/// <summary>Backups in the running server: the backup service and scheduled snapshots.</summary>
public static class Backups
{
    public static IServiceCollection AddBackups(this IServiceCollection services, ServerSettings settings)
    {
        services.AddSingleton<BackupService>();
        services.AddSingleton(provider => new Snapshots(
            provider.GetRequiredService<BackupService>(), settings.SnapshotDir, settings.SnapshotKeep, provider.GetRequiredService<TimeProvider>()));
        if (settings.SnapshotSchedule != SnapshotSchedule.Off) services.AddHostedService<SnapshotScheduler>();
        return services;
    }

    /// <summary>Takes a snapshot whenever the newest one is older than the schedule's period.</summary>
    private sealed class SnapshotScheduler(Snapshots snapshots, ServerSettings settings, TimeProvider time, ILogger<SnapshotScheduler> logger)
        : BackgroundService
    {
        private static readonly TimeSpan CheckEvery = TimeSpan.FromMinutes(5);

        protected override async Task ExecuteAsync(CancellationToken stopping)
        {
            var period = settings.SnapshotSchedule == SnapshotSchedule.Hourly ? TimeSpan.FromHours(1) : TimeSpan.FromDays(1);
            // Let startup (migrations, the first admin) finish first.
            await Task.Delay(TimeSpan.FromSeconds(30), time, stopping).ConfigureAwait(ConfigureAwaitOptions.SuppressThrowing);
            while (!stopping.IsCancellationRequested)
            {
                try
                {
                    var latest = snapshots.Latest();
                    if (latest is null || time.GetUtcNow() - latest >= period)
                    {
                        var path = await snapshots.TakeAsync(ServerApp.Version, stopping);
                        logger.LogInformation("Snapshot written to {Path}", path);
                    }
                }
                catch (Exception error) when (error is not OperationCanceledException)
                {
                    logger.LogError(error, "Snapshot failed; trying again in {Minutes} minutes", CheckEvery.TotalMinutes);
                }
                await Task.Delay(CheckEvery, time, stopping).ConfigureAwait(ConfigureAwaitOptions.SuppressThrowing);
            }
        }
    }
}
