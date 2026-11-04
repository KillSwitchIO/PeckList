using System.Globalization;
using System.IO.Compression;

namespace PeckList.Core.Backup;

/// <summary>
/// Backups the server takes on its own (<c>SNAPSHOT_SCHEDULE</c>): gzip-compressed JSON files named
/// <c>pecklist-YYYYMMDD-HHMMSS.json.gz</c> in one folder. Plain <c>.json</c> ones from before 0.8
/// (and <c>punchlist-</c> ones from before the rename) still count and restore. The newest
/// <c>keep</c> stay, plus the newest of each of the <c>keepWeekly</c> weeks before them. A file
/// appears only once complete (written aside, then renamed), so a crash never leaves half a backup.
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
    public async Task<string> TakeAsync(string appVersion, CancellationToken cancellation = default)
    {
        Directory.CreateDirectory(Folder);
        var path = Path.Combine(Folder, $"{Prefix}{time.FileStamp()}{Compressed}");
        var partial = path + ".partial";
        await using (var file = File.Create(partial))
        await using (var gzip = new GZipStream(file, CompressionLevel.Optimal))
        {
            await backup.ExportAsync(gzip, appVersion, cancellation);
        }
        File.Move(partial, path, overwrite: true);
        Prune();
        return path;
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
        var found = new List<(string, DateTimeOffset)>();
        foreach (var prefix in Prefixes)
        foreach (var path in Directory.GetFiles(Folder, $"{prefix}*"))
        {
            var name = Path.GetFileName(path);
            var extension = name.EndsWith(Compressed, StringComparison.Ordinal) ? Compressed
                : name.EndsWith(Plain, StringComparison.Ordinal) ? Plain : null;
            if (extension is null) continue;
            var stamp = name[prefix.Length..^extension.Length];
            if (DateTimeOffset.TryParseExact(stamp, Stamp, CultureInfo.InvariantCulture,
                    DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var taken))
            {
                found.Add((path, taken));
            }
        }
        return found.OrderByDescending(each => each.Item2).ToList();
    }

    private void Prune()
    {
        foreach (var path in Expired(List(), Math.Max(keep(), 1), Math.Max(keepWeekly?.Invoke() ?? 0, 0))) File.Delete(path);
        // Leftovers of a snapshot interrupted mid-write.
        foreach (var prefix in Prefixes)
        foreach (var partial in Directory.GetFiles(Folder, $"{prefix}*.partial")) File.Delete(partial);
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
