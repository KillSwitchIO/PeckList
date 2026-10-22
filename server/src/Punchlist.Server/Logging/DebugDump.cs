using System.IO.Compression;
using System.Runtime.InteropServices;
using System.Text.Json;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using Punchlist.Core;
using Punchlist.Core.Backup;
using Punchlist.Core.Configuration;
using Punchlist.Core.Storage;

namespace Punchlist.Server.Logging;

/// <summary>
/// A zip for bug reports (spec: Logging, debug dump): recent logs, every setting with where it comes
/// from (secrets hidden), versions, database counts and health. Nothing else: no task content, no
/// password hashes, no keys.
/// </summary>
public sealed class DebugDump(LayeredSettings layers, ServerSettings settings, IDatabase database, bool inContainer, TimeProvider time)
{
    /// <summary>Log files taken: the newest, up to this much.</summary>
    public const long LogBudget = 20L * 1024 * 1024;

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { WriteIndented = true };

    /// <summary>The running server's logging (outputs and recent entries); absent from the CLI.</summary>
    public LogPipeline? Pipeline { get; init; }

    public HealthCheckService? Health { get; init; }
    public Snapshots? Snapshots { get; init; }

    /// <summary>Where it was made: <c>server</c> or <c>cli</c>.</summary>
    public string MadeBy { get; init; } = "server";

    public async Task WriteAsync(Stream output, CancellationToken cancellation = default)
    {
        using var zip = new ZipArchive(output, ZipArchiveMode.Create, leaveOpen: true);
        var redaction = Pipeline?.Redaction ?? new Redaction();

        await AddJsonAsync(zip, "about.json", new
        {
            App = "punchlist",
            ServerApp.Version,
            SchemaVersion = WorkspaceSchema.CurrentVersion,
            Runtime = RuntimeInformation.FrameworkDescription,
            Os = RuntimeInformation.OSDescription,
            Architecture = RuntimeInformation.ProcessArchitecture.ToString(),
            InContainer = inContainer,
            Started = System.Diagnostics.Process.GetCurrentProcess().StartTime.ToUniversalTime(),
            Taken = time.GetUtcNow(),
            MadeBy,
        }, cancellation);

        var shown = new List<object>();
        foreach (var definition in SettingsCatalog.For(layers))
        {
            string? value;
            SettingSource source;
            try
            {
                (value, source) = layers.Explain(definition.Key);
            }
            catch (SettingsException error)
            {
                (value, source) = ($"(unreadable: {error.Message})", SettingSource.Environment);
            }
            if (value is not null) value = definition.Kind == SettingKind.Secret ? SettingsEndpoints.Hidden : redaction.Text(value);
            shown.Add(new { definition.Key, Value = value, Source = source.ToString().ToLowerInvariant(), definition.Default });
        }
        await AddJsonAsync(zip, "settings.json", shown, cancellation);

        object counts;
        bool reachable;
        try
        {
            reachable = await database.PingAsync(cancellation);
            counts = reachable ? await database.CountRowsAsync(cancellation) : "unreachable";
        }
        catch (Exception error) when (error is not OperationCanceledException)
        {
            reachable = false;
            counts = redaction.Text(error.Message);
        }
        await AddJsonAsync(zip, "database.json", new
        {
            Provider = settings.DbProvider.ToString().ToLowerInvariant(),
            Reachable = reachable,
            SqliteBytes = settings.DbProvider == DbProvider.Sqlite && File.Exists(settings.DbPath) ? new FileInfo(settings.DbPath).Length : (long?)null,
            Rows = counts,
            Snapshots = Snapshots?.List().Count,
            NewestSnapshot = Snapshots?.Latest(),
        }, cancellation);

        HealthReport? health = null;
        if (Health is not null)
        {
            try
            {
                health = await Health.CheckHealthAsync(cancellation);
            }
            catch (Exception error) when (error is not OperationCanceledException)
            {
                health = null;
            }
        }
        await AddJsonAsync(zip, "health.json", new
        {
            Status = health?.Status.ToString(),
            Checks = health?.Entries.ToDictionary(pair => pair.Key, pair => new { Status = pair.Value.Status.ToString(), pair.Value.Description }),
            LogOutputs = Pipeline?.Status,
        }, cancellation);

        if (Pipeline is not null)
        {
            var entry = zip.CreateEntry("logs/recent.jsonl", CompressionLevel.Optimal);
            await using var stream = entry.Open();
            await using var writer = new StreamWriter(stream);
            foreach (var record in Pipeline.Recent()) await writer.WriteLineAsync(LogFormats.JsonLine(record));
        }

        var dir = Pipeline?.Settings.Dir ?? settings.Logging.Dir;
        if (Directory.Exists(dir))
        {
            long budget = LogBudget;
            var files = Directory.EnumerateFiles(dir, FileSink.Prefix + "*")
                .Where(path => path.EndsWith(".log", StringComparison.Ordinal) || path.EndsWith(".log.gz", StringComparison.Ordinal))
                .Select(path => new FileInfo(path))
                .OrderByDescending(file => file.Name, StringComparer.Ordinal);
            foreach (var file in files)
            {
                if (file.Length > budget) break;
                budget -= file.Length;
                var entry = zip.CreateEntry("logs/" + file.Name, file.Name.EndsWith(".gz", StringComparison.Ordinal) ? CompressionLevel.NoCompression : CompressionLevel.Optimal);
                await using var target = entry.Open();
                // The server may still be writing it.
                await using var source = new FileStream(file.FullName, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
                await source.CopyToAsync(target, cancellation);
            }
        }
    }

    private static async Task AddJsonAsync(ZipArchive zip, string name, object value, CancellationToken cancellation)
    {
        var entry = zip.CreateEntry(name, CompressionLevel.Optimal);
        await using var stream = entry.Open();
        await JsonSerializer.SerializeAsync(stream, value, Json, cancellation);
    }
}
