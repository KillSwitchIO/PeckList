using Microsoft.AspNetCore.RateLimiting;
using Npgsql;
using PeckList.Collector;
using PeckList.Core.Telemetry;

// The telemetry collector (PL-116). Settings, from the environment:
//   COLLECTOR_DB                the PostgreSQL connection string (required)
//   COLLECTOR_DB_PASSWORD_FILE  optional: a file holding the password, so it stays out of the environment
//   COLLECTOR_READER_PASSWORD_FILE  optional: a file holding the password of a read-only role,
//                               telemetry_reader, made at start for dashboards (Grafana)
//   ASPNETCORE_URLS             where to listen (the image: http://+:8080)
// It never reads or keeps the sender's address: behind a proxy it does not even see it. Behind
// Cloudflare it keeps the country Cloudflare names in CF-IPCountry (two letters), nothing finer.
//
// Routes: what anyone on the internet may reach is under /api/public/ (the report, nothing else);
// everything else is under /api/private/ (the totals, their page and the health check), for the
// project's own network only. So the proxy in front needs one rule: let /api/public/* through, keep
// the rest inside.

var builder = WebApplication.CreateBuilder(args);
var connection = builder.Configuration["COLLECTOR_DB"]
    ?? throw new InvalidOperationException("COLLECTOR_DB (a PostgreSQL connection string) is not set");
if (builder.Configuration["COLLECTOR_DB_PASSWORD_FILE"] is { Length: > 0 } passwordFile)
{
    connection = new NpgsqlConnectionStringBuilder(connection)
    {
        Password = File.ReadAllText(passwordFile).TrimEnd('\r', '\n'),
    }.ToString();
}

builder.Services.AddSingleton(_ => NpgsqlDataSource.Create(connection));
builder.Services.AddSingleton<PingStore>();
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddSingleton<StatsCache>();
builder.Services.AddHostedService<Totals>();
builder.Services.AddRateLimiter(limits =>
{
    limits.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    // Every server sends once a day; this only stops a flood.
    limits.AddFixedWindowLimiter("ping", window =>
    {
        window.PermitLimit = 600;
        window.Window = TimeSpan.FromMinutes(1);
        window.QueueLimit = 0;
    });
});
const long MaxBody = 64 * 1024;
builder.WebHost.ConfigureKestrel(kestrel => kestrel.Limits.MaxRequestBodySize = MaxBody);
builder.Logging.AddFilter("Microsoft.AspNetCore", LogLevel.Warning);

var app = builder.Build();
await app.Services.GetRequiredService<PingStore>().MigrateAsync();
if (builder.Configuration["COLLECTOR_READER_PASSWORD_FILE"] is { Length: > 0 } readerFile)
{
    await app.Services.GetRequiredService<PingStore>().EnsureReaderAsync(File.ReadAllText(readerFile).TrimEnd('\r', '\n'));
}

// A ping is a few hundred bytes; Kestrel stops a longer body as it streams, this a declared one at once.
app.Use(async (context, next) =>
{
    if (context.Request.ContentLength > MaxBody)
    {
        context.Response.StatusCode = StatusCodes.Status413PayloadTooLarge;
        return;
    }
    await next(context);
});
app.UseRateLimiter();

app.MapGet("/api/private/healthz", () => Results.Text("ok"));

app.MapPost("/api/public/v1/ping", async (TelemetryPing ping, HttpRequest request, PingStore store, TimeProvider time, CancellationToken cancellation) =>
{
    if (TelemetryBuckets.Problem(ping) is { } problem) return Results.BadRequest(new { problem });
    await store.SaveAsync(ping, time.GetUtcNow(), cancellation, Countries.Of(request));
    return Results.Accepted();
}).RequireRateLimiting("ping");

app.MapPost("/api/public/v1/crash", async (CrashReport report, PingStore store, TimeProvider time, CancellationToken cancellation) =>
{
    if (CrashReports.Problem(report) is { } problem) return Results.BadRequest(new { problem });
    await store.SaveCrashAsync(CrashReports.Clean(report), time.GetUtcNow(), cancellation);
    return Results.Accepted();
}).RequireRateLimiting("ping");

// The totals are the project's own (Ben, 2026-11-02): inside only, never through the public proxy.
app.MapGet("/api/private/v1/stats", async (StatsCache stats, CancellationToken cancellation) =>
    Results.Ok(await stats.GetAsync(cancellation)));

// The same totals as a page for people; the bare address leads to it.
app.MapGet("/api/private/", async (StatsCache stats, CancellationToken cancellation) =>
    Results.Content(StatusPage.Render(await stats.GetAsync(cancellation)), "text/html; charset=utf-8"));
app.MapGet("/", () => Results.Redirect("/api/private/"));

app.Run();

/// <summary>The country a report came from, as Cloudflare names it in front of the collector.</summary>
internal static partial class Countries
{
    /// <summary>Two capital letters, or null (no header, or Cloudflare's XX for unknown and T1 for Tor).</summary>
    public static string? Of(HttpRequest request) =>
        request.Headers["CF-IPCountry"].ToString() is { Length: 2 } code && Code().IsMatch(code) && code is not ("XX" or "T1") ? code : null;

    [System.Text.RegularExpressions.GeneratedRegex("^[A-Z]{2}$")]
    private static partial System.Text.RegularExpressions.Regex Code();
}

/// <summary>The totals, worked out again at most every ten minutes.</summary>
internal sealed class StatsCache(PingStore store, TimeProvider time)
{
    private static readonly TimeSpan MaxAge = TimeSpan.FromMinutes(10);
    private readonly SemaphoreSlim gate = new(1, 1);
    private PublicStats? cached;

    public async Task<PublicStats> GetAsync(CancellationToken cancellation)
    {
        await gate.WaitAsync(cancellation);
        try
        {
            if (cached is null || time.GetUtcNow() - cached.Generated > MaxAge)
            {
                cached = await store.StatsAsync(time.GetUtcNow(), cancellation);
            }
            return cached;
        }
        finally
        {
            gate.Release();
        }
    }
}

/// <summary>Totals up finished days and prunes old pings, hourly (each day is totalled once).</summary>
internal sealed class Totals(PingStore store, TimeProvider time, ILogger<Totals> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stopping)
    {
        while (!stopping.IsCancellationRequested)
        {
            try
            {
                await store.TotalAndPruneAsync(DateOnly.FromDateTime(time.GetUtcNow().UtcDateTime), stopping);
            }
            catch (Exception error) when (error is not OperationCanceledException)
            {
                logger.LogError(error, "Totalling the pings failed; trying again in an hour");
            }
            await Task.Delay(TimeSpan.FromHours(1), time, stopping).ConfigureAwait(ConfigureAwaitOptions.SuppressThrowing);
        }
    }
}

public partial class Program;
