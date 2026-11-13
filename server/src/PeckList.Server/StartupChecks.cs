using PeckList.Core.Configuration;
using PeckList.Core.Storage;
using PeckList.Storage.Sql;

namespace PeckList.Server;

/// <summary>What the server checks before it starts anything, so it can refuse in one clear line.</summary>
public static class StartupChecks
{
    /// <summary>
    /// What the server exits with when it refuses to start, one code per reason, so a service
    /// manager can stop restarting on them and the docs can name them. 1 is anything else.
    /// </summary>
    public static class ExitCodes
    {
        /// <summary>Anything else that stopped the server; what was printed says what.</summary>
        public const int Failed = 1;
        /// <summary>A setting is wrong; the lines printed say which.</summary>
        public const int Settings = 2;
        /// <summary>A newer PeckList upgraded the database.</summary>
        public const int NewerDatabase = 3;
        /// <summary>A folder or file the server writes to can't be written.</summary>
        public const int Unwritable = 4;
    }

    /// <summary>The first <typeparamref name="T"/> in an exception, its inner ones, or an aggregate's.</summary>
    public static T? Find<T>(Exception? error) where T : Exception => error switch
    {
        null => null,
        T found => found,
        AggregateException many => many.InnerExceptions.Select(Find<T>).FirstOrDefault(found => found is not null),
        _ => Find<T>(error.InnerException),
    };

    /// <summary>
    /// The line to stop with when a newer version upgraded the database, or null. An older server
    /// must not run on a schema it has never seen; refusing here keeps the host from starting on it,
    /// so the operator gets one line and exit code 3 instead of a stack trace. A database that cannot
    /// be reached yet is left to the normal start, which says why; so is one that has not answered
    /// within <paramref name="wait"/> (10 seconds unless given), so a slow one does not hold the start twice.
    /// </summary>
    public static async Task<string?> NewerDatabaseAsync(IServiceProvider services, TimeSpan? wait = null, CancellationToken cancellation = default)
    {
        using var limit = CancellationTokenSource.CreateLinkedTokenSource(cancellation);
        limit.CancelAfter(wait ?? TimeSpan.FromSeconds(10));
        try
        {
            return await services.GetRequiredService<IDatabase>().NewerSchemaAsync(limit.Token) is var (database, known)
                ? NewerDatabaseException.Text(database, known)
                : null;
        }
        catch (Exception) when (!cancellation.IsCancellationRequested)
        {
            return null;
        }
    }

    /// <summary>
    /// The line to stop with when a folder the server writes to can't be written, or null. The
    /// commonest first-start mistake is a bind mount owned by someone else; without this, the
    /// server crash-looped with a stack trace (QA pass 5). Checked: the SQLite file's folder, the
    /// attachments, the log files and, when they are on, scheduled snapshots and the audit archive.
    /// </summary>
    public static string? UnwritableFolder(ServerSettings settings)
    {
        var folders = new List<(string Folder, string Setting)>();
        if (settings.DbProvider == DbProvider.Sqlite)
        {
            folders.Add((Path.GetDirectoryName(Path.GetFullPath(settings.DbPath)) ?? ".", "DB_PATH"));
        }
        folders.Add((settings.AttachmentDir, "ATTACHMENT_DIR"));
        if (settings.Logging.Files) folders.Add((settings.Logging.Dir, "LOG_DIR"));
        if (settings.SnapshotSchedule != SnapshotSchedule.Off) folders.Add((settings.SnapshotDir, "SNAPSHOT_DIR"));
        if (settings.AuditArchive) folders.Add((settings.AuditArchiveDir, "AUDIT_ARCHIVE_DIR"));
        foreach (var (folder, setting) in folders)
        {
            if (WriteProblem(folder) is { } problem) return UnwritableText(folder, setting, problem);
        }
        return null;
    }

    /// <summary>Why a file can't be made in <paramref name="folder"/> (made first if missing), or null.</summary>
    internal static string? WriteProblem(string folder)
    {
        try
        {
            Directory.CreateDirectory(folder);
            var probe = Path.Combine(folder, $".pecklist-write-check-{Guid.NewGuid():N}");
            using (new FileStream(probe, FileMode.CreateNew, FileAccess.Write, FileShare.None, 1, FileOptions.DeleteOnClose)) { }
            return null;
        }
        catch (Exception error) when (error is UnauthorizedAccessException or IOException)
        {
            return error.Message;
        }
    }

    /// <summary>One line an operator can act on: which folder, which setting, and the usual fix.</summary>
    public static string UnwritableText(string folder, string? setting, string problem) =>
        $"PeckList cannot write to {Path.GetFullPath(folder)}{(setting is null ? "" : $" ({setting})")}: {problem.TrimEnd('.')}. " + Fix;

    /// <summary>The same line for a write refused somewhere the check above doesn't look (the message names the path).</summary>
    public static string UnwritableText(UnauthorizedAccessException error) =>
        $"PeckList cannot write a file it needs: {error.Message.TrimEnd('.')}. " + Fix;

    private const string Fix =
        "The folder must belong to the user the server runs as, uid 1654 in the PeckList image: on the host, " +
        "sudo chown -R 1654:1654 on the folder you mounted, or run the container as your own user (user: \"1000:1000\") " +
        "with folders you own. See https://docs.pecklist.com/guides/troubleshooting#it-does-not-start";
}
