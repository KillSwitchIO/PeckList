using Microsoft.AspNetCore.RateLimiting;
using Npgsql;
using Punchlist.Collector;
using Punchlist.Core.Telemetry;

// The telemetry collector (PL-116). Settings, from the environment:
//   COLLECTOR_DB                the PostgreSQL connection string (required)
//   COLLECTOR_DB_PASSWORD_FILE  optional: a file holding the password, so it stays out of the environment
//   ASPNETCORE_URLS             where to listen (the image: http://+:8080)
// It never reads or keeps the sender's address: behind a proxy it does not even see it.
//
// Routes: what anyone on the internet may reach is under /api/public/ (the report and the public
// totals), everything else under /api/private/ (the health check), so the proxy in front needs one
// rule: let /api/public/* through, keep the rest inside.

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
builder.Services.AddCors(cors => cors.AddPolicy("public", policy => policy.AllowAnyOrigin().WithMethods("GET")));
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
app.UseCors();
app.UseRateLimiter();

app.MapGet("/api/private/healthz", () => Results.Text("ok"));

app.MapPost("/api/public/v1/ping", async (TelemetryPing ping, PingStore store, TimeProvider time, CancellationToken cancellation) =>
{
    if (TelemetryBuckets.Problem(ping) is { } problem) return Results.BadRequest(new { problem });
    await store.SaveAsync(ping, time.GetUtcNow(), cancellation);
    return Results.Accepted();
}).RequireRateLimiting("ping");

app.MapGet("/api/public/v1/stats", async (StatsCache stats, CancellationToken cancellation) =>
    Results.Ok(await stats.GetAsync(cancellation))).RequireCors("public");

app.Run();

/// <summary>The public totals, worked out again at most every ten minutes.</summary>
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
