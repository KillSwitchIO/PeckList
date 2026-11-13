using System.Globalization;
using System.IO.Compression;

namespace PeckList.Core.Backup;

/// <summary>
/// Backups the server takes on its own (<c>SNAPSHOT_SCHEDULE</c>): gzip-compressed JSON files named
/// <c>pecklist-YYYYMMDD-HHMMSS.json.gz</c> in one folder. Plain <c>.json</c> ones from before 0.8
/// (and <c>punchlist-</c> ones from before the rename) still count and restore. The newest
/// <c>keep</c> stay, plus the newest of each of the <c>keepWeekly</c> weeks before them. A file
/// appears only once complete (written aside, then renamed), so a crash never leaves half a backup.
/// Two taken in the same second get <c>-2</c>, <c>-3</c>... after the stamp, so one never replaces
/// another: a restore's safety backup must not overwrite the backup it restored from (QA pass 5).
/// </summary>
public sealed class Snapshots(BackupService backup, string folder, Func<int> keep, TimeProvider time, Func<int>? keepWeekly = null)
{
    private const string Prefix = "pecklist-";
    // Snapshots taken before the rename (PL-127) keep their name and still count.
    private static readonly string[] Prefixes = [Prefix, "punchlist-"];
    private const string Compressed = ".json.gz";
    private const string Plain = ".json";
    private const string Stamp = TimeStamps.FileFormat;

    public string Folder { get; } = folder;

    /// <summary>Take one now. Returns its path.</summary>
    public Task<string> TakeAsync(string appVersion, CancellationToken cancellation = default) => TakeAsync(appVersion, prune: true, cancellation);

    /// <summary>
    /// Take one now, pruning old ones afterwards or not. A restore's safety backup does not prune:
    /// the backup being restored from may be the oldest one kept, and pruning would delete it (on
    /// Windows, fail on its open file). The next scheduled one prunes.
    /// </summary>
    public async Task<string> TakeAsync(string appVersion, bool prune, CancellationToken cancellation = default)
    {
        Directory.CreateDirectory(Folder);
        var (path, file) = Reserve(time.FileStamp());
        var partial = path + ".partial";
        try
        {
            await using (file)
            await using (var gzip = new GZipStream(file, CompressionLevel.Optimal))
            {
                await backup.ExportAsync(gzip, appVersion, cancellation);
            }
            File.Move(partial, path, overwrite: false);
        }
        catch
        {
            File.Delete(partial);
            throw;
        }
        if (prune) Prune();
        return path;
    }

    /// <summary>
    /// A name nobody holds: the stamp, else the stamp with -2, -3 and so on. The partial file is
    /// made with CreateNew, so two snapshots started in the same second (the schedule and a click)
    /// can't pick the same name either.
    /// </summary>
    private (string Path, FileStream Partial) Reserve(string stamp)
    {
        for (var n = 1; ; n++)
        {
            var path = Path.Combine(Folder, $"{Prefix}{stamp}{(n == 1 ? "" : $"-{n}")}{Compressed}");
            if (File.Exists(path)) continue;
            try
            {
                return (path, new FileStream(path + ".partial", FileMode.CreateNew, FileAccess.Write));
            }
            catch (IOException) when (File.Exists(path + ".partial") || File.Exists(path))
            {
                // Another snapshot is writing under this name right now, or has just finished.
            }
        }
    }

    /// <summary>A snapshot's JSON, uncompressed whichever form it was written in.</summary>
    public static Stream OpenRead(string path)
    {
        var file = File.OpenRead(path);
        return path.EndsWith(".gz", StringComparison.Ordinal) ? new GZipStream(file, CompressionMode.Decompress) : file;
    }

    /// <summary>When the newest snapshot was taken, if there is one.</summary>
    public DateTimeOffset? Latest() => List().Select(each => (DateTimeOffset?)each.Taken).FirstOrDefault();

    /// <summary>Snapshots, newest first.</summary>
    public IReadOnlyList<(string Path, DateTimeOffset Taken)> List()
    {
        if (!Directory.Exists(Folder)) return [];
        var found = new List<(string Path, DateTimeOffset Taken, int Count)>();
        foreach (var prefix in Prefixes)
        foreach (var path in Directory.GetFiles(Folder, $"{prefix}*"))
        {
            var name = Path.GetFileName(path);
            var extension = name.EndsWith(Compressed, StringComparison.Ordinal) ? Compressed
                : name.EndsWith(Plain, StringComparison.Ordinal) ? Plain : null;
            if (extension is null) continue;
            var stamp = name[prefix.Length..^extension.Length];
            // A second one in the same second: the stamp, then -2, -3...
            var count = 1;
            if (stamp.Length > Stamp.Length && stamp[Stamp.Length] == '-'
                && int.TryParse(stamp.AsSpan(Stamp.Length + 1), NumberStyles.None, CultureInfo.InvariantCulture, out var n) && n >= 2)
            {
                (stamp, count) = (stamp[..Stamp.Length], n);
            }
            if (DateTimeOffset.TryParseExact(stamp, Stamp, CultureInfo.InvariantCulture,
                    DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var taken))
            {
                found.Add((path, taken, count));
            }
        }
        return found.OrderByDescending(each => each.Taken).ThenByDescending(each => each.Count)
            .Select(each => (each.Path, each.Taken)).ToList();
    }

    /// <summary>How old a partial file must be to count as left over: younger, another snapshot may be writing it.</summary>
    private static readonly TimeSpan Stale = TimeSpan.FromHours(1);

    private void Prune()
    {
        foreach (var path in Expired(List(), Math.Max(keep(), 1), Math.Max(keepWeekly?.Invoke() ?? 0, 0))) Delete(path);
        // Leftovers of a snapshot interrupted mid-write, by the files' own (real) clock: never the
        // partial of one being written right now, by this process or the CLI's.
        foreach (var prefix in Prefixes)
        foreach (var partial in Directory.GetFiles(Folder, $"{prefix}*.partial"))
        {
            if (DateTime.UtcNow - File.GetLastWriteTimeUtc(partial) > Stale) Delete(partial);
        }
    }

    /// <summary>Pruning is tidying: a file someone has open (a download, a restore reading it) stays for the next round, and the snapshot just taken still counts as taken.</summary>
    private static void Delete(string path)
    {
        try
        {
            File.Delete(path);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            // Next time.
        }
    }

    /// <summary>
    /// What goes from a newest-first list: everything but the newest <paramref name="keep"/> and
    /// the newest of each of the <paramref name="weekly"/> (ISO) weeks those do not already cover.
    /// </summary>
    public static IEnumerable<string> Expired(IReadOnlyList<(string Path, DateTimeOffset Taken)> newestFirst, int keep, int weekly)
    {
        var weeks = new HashSet<(int, int)>();
        foreach (var (_, taken) in newestFirst.Take(keep)) weeks.Add(Week(taken));
        foreach (var (path, taken) in newestFirst.Skip(keep))
        {
            if (weekly > 0 && weeks.Add(Week(taken)))
            {
                weekly--;
                continue;
            }
            yield return path;
        }
    }

    private static (int Year, int Week) Week(DateTimeOffset taken) =>
        (ISOWeek.GetYear(taken.UtcDateTime), ISOWeek.GetWeekOfYear(taken.UtcDateTime));
}
