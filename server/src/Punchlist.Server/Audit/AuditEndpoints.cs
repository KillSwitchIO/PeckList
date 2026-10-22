using System.Globalization;
using System.IO.Compression;
using System.Text;
using System.Text.Json;
using Punchlist.Core.Accounts;
using Punchlist.Core.Audit;
using Punchlist.Core.Configuration;
using Punchlist.Server.Auth;

namespace Punchlist.Server.Audit;

/// <summary><c>/api/admin/audit</c>: the access and event log, filtered, a page at a time or as CSV.</summary>
public static class AuditEndpoints
{
    private static readonly string[] CsvColumns =
    [
        "time", "kind", "type", "outcome", "actor", "actorId", "viewedAsBy", "target", "targetId", "ip", "device",
        "method", "route", "status", "durationMs", "requestId", "detail",
    ];

    public static RouteGroupBuilder MapAudit(this RouteGroupBuilder admin)
    {
        admin.MapGet("/audit", async (HttpRequest request, IAuditStore store, CancellationToken cancellation) =>
            await store.QueryAsync(Query(request, limit: 100, oldestFirst: false), cancellation))
            .RequirePermission(Permission.ViewLogs);

        // The filtered set as CSV (up to 100,000 rows), oldest first unless asked otherwise.
        admin.MapGet("/audit.csv", async (HttpContext context, IAuditStore store, TimeProvider time) =>
        {
            var query = Query(context.Request, limit: 100_000, oldestFirst: true);
            var page = await store.QueryAsync(query, context.RequestAborted);
            var name = $"punchlist-{query.Kind}-{time.GetUtcNow().ToString("yyyyMMdd-HHmmss", CultureInfo.InvariantCulture)}.csv";
            context.Response.ContentType = "text/csv; charset=utf-8";
            context.Response.Headers.ContentDisposition = $"attachment; filename=\"{name}\"";
            await using var writer = new StreamWriter(context.Response.Body, new UTF8Encoding(false));
            await writer.WriteLineAsync(string.Join(',', CsvColumns));
            foreach (var entry in page.Entries)
            {
                string?[] cells =
                [
                    entry.Time.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture), entry.Kind, entry.Type,
                    entry.Outcome, entry.ActorName, entry.ActorId, entry.ImpersonatorName, entry.TargetName, entry.TargetId, entry.Ip,
                    entry.Device, entry.Method, entry.Route, entry.Status?.ToString(CultureInfo.InvariantCulture),
                    entry.DurationMs?.ToString(CultureInfo.InvariantCulture), entry.RequestId, entry.Detail,
                ];
                await writer.WriteLineAsync(string.Join(',', cells.Select(Csv)));
            }
        }).RequirePermission(Permission.ViewLogs);

        return admin;
    }

    private static AuditQuery Query(HttpRequest request, int limit, bool oldestFirst)
    {
        string? Get(string name) => request.Query[name].FirstOrDefault() is { Length: > 0 } value ? value : null;
        DateTimeOffset? When(string name) =>
            DateTimeOffset.TryParse(Get(name), CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var when) ? when : null;
        int Number(string name, int fallback) => int.TryParse(Get(name), NumberStyles.None, CultureInfo.InvariantCulture, out var n) ? n : fallback;
        return new AuditQuery
        {
            Kind = Get("kind") == AuditKind.Access ? AuditKind.Access : AuditKind.Event,
            Text = Get("text"),
            User = Get("user"),
            Type = Get("type"),
            Outcome = Get("outcome"),
            Ip = Get("ip"),
            From = When("from"),
            To = When("to"),
            Ascending = Get("order") is { } order ? order == "asc" : oldestFirst,
            Offset = Number("offset", 0),
            Limit = Math.Clamp(Number("limit", limit), 1, limit),
        };
    }

    /// <summary>A CSV cell: quoted when it needs to be, and never read as a formula by a spreadsheet.</summary>
    public static string Csv(string? value)
    {
        if (string.IsNullOrEmpty(value)) return "";
        if (value[0] is '=' or '+' or '-' or '@' or '\t' or '\r') value = "'" + value;
        return value.IndexOfAny([',', '"', '\n', '\r']) >= 0 ? "\"" + value.Replace("\"", "\"\"") + "\"" : value;
    }
}

/// <summary>
/// Keeps the log to its retention (spec: events 90 days, requests 14): checks every hour, and with
/// <c>AUDIT_ARCHIVE</c> writes what it removes to gzipped JSON lines in <c>AUDIT_ARCHIVE_DIR</c> first.
/// </summary>
public sealed class AuditRetention(IAuditStore store, ServerSettings settings, TimeProvider time, ILogger<AuditRetention> logger)
    : BackgroundService
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    protected override async Task ExecuteAsync(CancellationToken stopping)
    {
        await Task.Delay(TimeSpan.FromSeconds(20), time, stopping).ConfigureAwait(ConfigureAwaitOptions.SuppressThrowing);
        while (!stopping.IsCancellationRequested)
        {
            try
            {
                await PruneAsync(stopping);
            }
            catch (Exception error) when (error is not OperationCanceledException)
            {
                logger.LogError(error, "Pruning the access and event log failed; trying again in an hour");
            }
            await Task.Delay(TimeSpan.FromHours(1), time, stopping).ConfigureAwait(ConfigureAwaitOptions.SuppressThrowing);
        }
    }

    /// <summary>Remove (and archive) what is past each kind's retention; how many went.</summary>
    public async Task<int> PruneAsync(CancellationToken cancellation = default)
    {
        var removed = 0;
        foreach (var (kind, days) in new[] { (AuditKind.Event, settings.AuditRetentionDays), (AuditKind.Access, settings.AccessLogRetentionDays) })
        {
            var cutoff = time.GetUtcNow().AddDays(-days);
            var count = settings.AuditArchive ? await ArchiveAsync(kind, cutoff, cancellation) : await store.PruneAsync(kind, cutoff, cancellation);
            if (count > 0) logger.LogInformation("Removed {Count} {Kind} log entries older than {Days} days", count, kind, days);
            removed += count;
        }
        return removed;
    }

    private async Task<int> ArchiveAsync(string kind, DateTimeOffset cutoff, CancellationToken cancellation)
    {
        var first = await store.OlderAsync(kind, cutoff, 1, cancellation);
        if (first.Count == 0) return 0;
        Directory.CreateDirectory(settings.AuditArchiveDir);
        var path = Path.Combine(settings.AuditArchiveDir,
            $"audit-{kind}-{time.GetUtcNow().ToString("yyyyMMdd-HHmmss", CultureInfo.InvariantCulture)}.jsonl.gz");
        var total = 0;
        await using (var file = File.Create(path))
        await using (var gzip = new GZipStream(file, CompressionLevel.Optimal))
        await using (var writer = new StreamWriter(gzip, new UTF8Encoding(false)))
        {
            while (true)
            {
                var page = await store.OlderAsync(kind, cutoff, 5000, cancellation);
                if (page.Count == 0) break;
                foreach (var entry in page) await writer.WriteLineAsync(JsonSerializer.Serialize(entry, Json));
                await writer.FlushAsync(cancellation);
                // Up to the last entry written: the next page starts after it.
                var through = page.Count < 5000 ? cutoff : page[^1].Time.AddMilliseconds(1);
                total += await store.PruneAsync(kind, through < cutoff ? through : cutoff, cancellation);
                if (page.Count < 5000) break;
            }
        }
        return total;
    }
}
