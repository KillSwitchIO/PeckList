using Punchlist.Core.Backup;
using Punchlist.Core.Configuration;

namespace Punchlist.Server;

/// <summary>
/// Restoring the whole server from the admin page (spec: Backup and restore). The chosen backup is
/// checked and parked next to the backups, the server restarts, and the restore runs at the start,
/// before anything is loaded from the database, so nothing in memory holds the old data.
/// </summary>
public sealed class PendingRestore(BackupService backup, ServerSettings settings, ILogger<PendingRestore> logger)
{
    private string File => Path.Combine(settings.SnapshotDir, "restore-pending.json");

    /// <summary>Check a backup and park it for the next start.</summary>
    /// <exception cref="BackupException">It is not a backup this server can restore.</exception>
    public async Task ParkAsync(Stream input, CancellationToken cancellation = default)
    {
        Directory.CreateDirectory(settings.SnapshotDir);
        var partial = File + ".partial";
        await using (var file = System.IO.File.Create(partial))
        {
            await input.CopyToAsync(file, cancellation);
        }
        await using (var check = System.IO.File.OpenRead(partial))
        {
            try
            {
                await BackupService.CheckAsync(check, cancellation);
            }
            catch (BackupException)
            {
                System.IO.File.Delete(partial);
                throw;
            }
        }
        System.IO.File.Move(partial, File, overwrite: true);
    }

    /// <summary>At start: restore a parked backup, if there is one.</summary>
    public async Task ApplyAsync(CancellationToken cancellation = default)
    {
        if (!System.IO.File.Exists(File)) return;
        await using (var input = System.IO.File.OpenRead(File))
        {
            var summary = await backup.ImportAsync(input, replace: true, cancellation);
            logger.LogWarning("Restored the server from a backup: {Accounts} accounts, {Entities} entities", summary.Accounts, summary.Entities);
        }
        System.IO.File.Delete(File);
    }
}
