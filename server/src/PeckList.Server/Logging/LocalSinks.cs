using System.Globalization;
using System.IO.Compression;
using System.Text;
using PeckList.Core.Configuration;

namespace PeckList.Server.Logging;

/// <summary>Standard output, as text or JSON lines.</summary>
public sealed class ConsoleSink(TextWriter output, LogFormat format) : ILogSink
{
    public string Name => "console";
    public string Destination => format == LogFormat.Json ? "standard output (JSON)" : "standard output";
    public int BatchSize => 512;
    public TimeSpan BatchDelay => TimeSpan.Zero;

    public async Task WriteAsync(IReadOnlyList<LogRecord> batch, CancellationToken cancellation)
    {
        var text = new StringBuilder();
        foreach (var record in batch)
        {
            text.Append(format == LogFormat.Json ? LogFormats.JsonLine(record) : LogFormats.Text(record)).Append('\n');
        }
        await output.WriteAsync(text, cancellation);
        await output.FlushAsync(cancellation);
    }

    public ValueTask DisposeAsync() => ValueTask.CompletedTask;
}

/// <summary>
/// JSON lines in <c>LOG_DIR</c> (spec: Logging): <c>pecklist-YYYYMMDD-NNN.log</c>, a new file at
/// midnight UTC or past the size limit. Earlier files are gzipped when one rolls (and at start), and
/// archives older than the keep window are deleted.
/// </summary>
public sealed class FileSink : ILogSink
{
    public const string Prefix = "pecklist-";
    // Files written before the rename (PL-127) are still archived and expired.
    private static readonly string[] Prefixes = [Prefix, "punchlist-"];

    private readonly string dir;
    private readonly long maxBytes;
    private readonly int keepDays;
    private readonly TimeProvider time;
    private FileStream? current;
    private string? currentPath;
    private string? currentDay;
    private long size;

    public FileSink(string dir, int maxMegabytes, int keepDays, TimeProvider time)
    {
        this.dir = dir;
        maxBytes = maxMegabytes * 1024L * 1024L;
        this.keepDays = keepDays;
        this.time = time;
    }

    public string Name => "file";
    public string Destination => dir;
    public int BatchSize => 512;
    public TimeSpan BatchDelay => TimeSpan.Zero;

    /// <summary>The file being written now, if any.</summary>
    public string? CurrentPath => currentPath;

    public async Task WriteAsync(IReadOnlyList<LogRecord> batch, CancellationToken cancellation)
    {
        foreach (var record in batch)
        {
            var day = record.Time.UtcDateTime.ToString("yyyyMMdd", CultureInfo.InvariantCulture);
            if (current is null || day != currentDay || size >= maxBytes) await RollAsync(day, cancellation);
            var bytes = Encoding.UTF8.GetBytes(LogFormats.JsonLine(record) + "\n");
            await current!.WriteAsync(bytes, cancellation);
            size += bytes.Length;
        }
        await current!.FlushAsync(cancellation);
    }

    private async Task RollAsync(string day, CancellationToken cancellation)
    {
        if (current is not null) await current.DisposeAsync();
        current = null;
        Directory.CreateDirectory(dir);
        // Carry on in today's last file when it has room (a restart), else the next number.
        var parts = Directory.EnumerateFiles(dir, $"{Prefix}{day}-*.log*")
            .Select(path => int.TryParse(Path.GetFileName(path).AsSpan(Prefix.Length + 9, 3), NumberStyles.None, CultureInfo.InvariantCulture, out var n) ? n : -1)
            .Where(n => n >= 0)
            .ToList();
        var part = 1;
        if (parts.Count > 0)
        {
            part = parts.Max();
            var last = Path.Combine(dir, $"{Prefix}{day}-{part:000}.log");
            var carryOn = day != currentDay && File.Exists(last) && new FileInfo(last).Length < maxBytes;
            if (!carryOn) part++;
        }
        var path = Path.Combine(dir, $"{Prefix}{day}-{part:000}.log");
        current = new FileStream(path, FileMode.Append, FileAccess.Write, FileShare.Read);
        currentPath = path;
        currentDay = day;
        size = current.Length;
        await ArchiveAsync(cancellation);
    }

    /// <summary>Gzip every finished file and delete archives past the keep window.</summary>
    private async Task ArchiveAsync(CancellationToken cancellation)
    {
        foreach (var path in Prefixes.SelectMany(prefix => Directory.EnumerateFiles(dir, prefix + "*.log")))
        {
            if (path == currentPath) continue;
            try
            {
                await using (var source = File.OpenRead(path))
                await using (var target = File.Create(path + ".gz"))
                await using (var gzip = new GZipStream(target, CompressionLevel.Optimal))
                {
                    await source.CopyToAsync(gzip, cancellation);
                }
                File.SetLastWriteTimeUtc(path + ".gz", File.GetLastWriteTimeUtc(path));
                File.Delete(path);
            }
            catch (IOException)
            {
                // Another writer still has it (two servers on one folder); the next roll tries again.
            }
        }
        var oldest = time.GetUtcNow().UtcDateTime.Date.AddDays(-keepDays).ToString("yyyyMMdd", CultureInfo.InvariantCulture);
        foreach (var prefix in Prefixes)
        foreach (var path in Directory.EnumerateFiles(dir, prefix + "*.log.gz"))
        {
            var name = Path.GetFileName(path);
            if (name.Length >= prefix.Length + 8 && string.CompareOrdinal(name.Substring(prefix.Length, 8), oldest) < 0) File.Delete(path);
        }
    }

    public async ValueTask DisposeAsync()
    {
        if (current is not null) await current.DisposeAsync();
        current = null;
    }
}
