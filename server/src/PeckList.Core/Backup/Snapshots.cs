using System.Globalization;

namespace PeckList.Core.Backup;

/// <summary>
/// Backups the server takes on its own (<c>SNAPSHOT_SCHEDULE</c>): readable JSON files named
/// <c>punchlist-YYYYMMDD-HHMMSS.json</c> in one folder, the newest <c>keep</c> kept. A file appears
/// only once complete (written aside, then renamed), so a crash never leaves half a backup.
/// </summary>
public sealed class Snapshots(BackupService backup, string folder, Func<int> keep, TimeProvider time)
{
    private const string Prefix = "punchlist-";
    private const string Stamp = TimeStamps.FileFormat;

    public string Folder { get; } = folder;

    /// <summary>Take one now. Returns its path.</summary>
    public async Task<string> TakeAsync(string appVersion, CancellationToken cancellation = default)
    {
        Directory.CreateDirectory(Folder);
        var name = $"{Prefix}{time.FileStamp()}.json";
        var path = Path.Combine(Folder, name);
        var partial = path + ".partial";
        await using (var file = File.Create(partial))
        {
            await backup.ExportAsync(file, appVersion, cancellation);
        }
        File.Move(partial, path, overwrite: true);
        Prune();
        return path;
    }

    /// <summary>When the newest snapshot was taken, if there is one.</summary>
    public DateTimeOffset? Latest() => List().Select(each => (DateTimeOffset?)each.Taken).FirstOrDefault();

    /// <summary>Snapshots, newest first.</summary>
    public IReadOnlyList<(string Path, DateTimeOffset Taken)> List()
    {
        if (!Directory.Exists(Folder)) return [];
        var found = new List<(string, DateTimeOffset)>();
        foreach (var path in Directory.GetFiles(Folder, $"{Prefix}*.json"))
        {
            var stamp = Path.GetFileNameWithoutExtension(path)[Prefix.Length..];
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
        foreach (var (path, _) in List().Skip(Math.Max(keep(), 1))) File.Delete(path);
        // Leftovers of a snapshot interrupted mid-write.
        foreach (var partial in Directory.GetFiles(Folder, $"{Prefix}*.json.partial")) File.Delete(partial);
    }
}
