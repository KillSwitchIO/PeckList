using Punchlist.Core.Backup;
using Punchlist.Core.Configuration;

namespace Punchlist.Server;

/// <summary>Backups in the running server: the backup service and scheduled snapshots.</summary>
public static class Backups
{
    public static IServiceCollection AddBackups(this IServiceCollection services, ServerSettings settings)
    {
        services.AddSingleton<BackupService>();
        services.AddSingleton<UserBackups>();
        services.AddSingleton<PendingRestore>();
        services.AddSingleton<Core.Sync.ServerEpoch>();
        services.AddSingleton(provider =>
        {
            var live = provider.GetRequiredService<LiveSettings>();
            return new Snapshots(provider.GetRequiredService<BackupService>(), settings.SnapshotDir, () => live.Current.SnapshotKeep,
                provider.GetRequiredService<TimeProvider>());
        });
        // Always running: the schedule can change (or be turned off) while the server runs.
        services.AddHostedService<SnapshotScheduler>();
        return services;
    }

    /// <summary>Takes a snapshot whenever the newest one is older than the schedule's period.</summary>
    private sealed class SnapshotScheduler(Snapshots snapshots, LiveSettings live, Audit.AuditLog audit, TimeProvider time, ILogger<SnapshotScheduler> logger)
        : BackgroundService
    {
        private static readonly TimeSpan CheckEvery = TimeSpan.FromMinutes(5);

        protected override async Task ExecuteAsync(CancellationToken stopping)
        {
            // Let startup (migrations, the first admin) finish first.
            await Task.Delay(TimeSpan.FromSeconds(30), time, stopping).ConfigureAwait(ConfigureAwaitOptions.SuppressThrowing);
            while (!stopping.IsCancellationRequested)
            {
                try
                {
                    TimeSpan? period = live.Current.SnapshotSchedule switch
                    {
                        SnapshotSchedule.Off => null,
                        SnapshotSchedule.Hourly => TimeSpan.FromHours(1),
                        SnapshotSchedule.Weekly => TimeSpan.FromDays(7),
                        _ => TimeSpan.FromDays(1),
                    };
                    var latest = snapshots.Latest();
                    if (period is not null && (latest is null || time.GetUtcNow() - latest >= period))
                    {
                        var path = await snapshots.TakeAsync(ServerApp.Version, stopping);
                        logger.LogInformation("Snapshot written to {Path}", path);
                        audit.RecordSystem("backup.scheduled", detail: Path.GetFileName(path));
                    }
                }
                catch (Exception error) when (error is not OperationCanceledException)
                {
                    logger.LogError(error, "Snapshot failed; trying again in {Minutes} minutes", CheckEvery.TotalMinutes);
                    audit.RecordSystem("backup.scheduled", Core.Audit.AuditOutcome.Failed, error.Message);
                }
                await Task.Delay(CheckEvery, time, stopping).ConfigureAwait(ConfigureAwaitOptions.SuppressThrowing);
            }
        }
    }
}
