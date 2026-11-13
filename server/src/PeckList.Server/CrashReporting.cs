using System.Security.Claims;
using System.Text;
using System.Text.Json;
using PeckList.Core.Accounts;
using PeckList.Core.Configuration;
using PeckList.Core.Telemetry;
using PeckList.Server.Audit;
using PeckList.Server.Auth;
using PeckList.Server.Logging;

namespace PeckList.Server;

/// <summary>Where crash reports go: the collector, next to the usage report (<c>.../v1/crash</c>).</summary>
public interface ICrashSender
{
    Task SendAsync(Uri url, CrashReport report, CancellationToken cancellation);
}

public sealed class HttpCrashSender(IHttpClientFactory http) : ICrashSender
{
    public async Task SendAsync(Uri url, CrashReport report, CancellationToken cancellation)
    {
        using var response = await http.CreateClient("telemetry").PostAsJsonAsync(url, report, cancellation);
        response.EnsureSuccessStatusCode();
    }
}

/// <summary>A crash on the server itself, kept for the admin to look at and send (or not).</summary>
public sealed record ServerCrash(string Fingerprint, int Count, DateTimeOffset FirstAt, DateTimeOffset LastAt, CrashReport Report);

/// <summary>The server's crash reports for the admin page, and whether sending them is on.</summary>
public sealed record ServerCrashes(bool Enabled, IReadOnlyList<ServerCrash> Crashes);

/// <summary>What an app sends when the person chose to send a report.</summary>
public sealed record AppCrash(string? Source = null, string? Version = null, string? Kind = null, string? Fingerprint = null, string? Stack = null, IReadOnlyList<string>? Device = null);

/// <summary>
/// Crash reports (PL-116): from the apps when the person says so, and the server's own unhandled
/// errors, kept for the admin. Reports go through this server to the collector; one that cannot go
/// waits and is tried again with the next usage report. <c>CRASH_REPORTS=false</c> stops it all.
/// </summary>
public sealed class CrashReporting(
    ISecretStore secrets, ICrashSender sender, TelemetryReport telemetry, LiveSettings live, TimeProvider time, ILogger<CrashReporting> logger,
    LogPipeline? logs = null)
{
    public const string QueueKind = "crash-queue";
    public const string ServerKind = "server-crash";
    private const int MaxServerCrashes = 20;
    private const int MaxQueued = 50;
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private readonly SemaphoreSlim gate = new(1, 1);

    public bool Enabled => live.Current.CrashReports;

    /// <summary>The collector's crash address: next to where the usage report goes.</summary>
    public Uri Url => new(live.Current.TelemetryUrl, "crash");

    private static string Channel(string version) => TelemetryBuckets.ChannelOf(version);

    /// <summary>Send a report now, or keep it for later when the collector cannot be reached.</summary>
    public async Task SendOrQueueAsync(CrashReport report, CancellationToken cancellation)
    {
        var (id, _) = await telemetry.InstallAsync(cancellation);
        var ready = CrashReports.Clean(report with { InstallId = id });
        if (CrashReports.Problem(ready) is { } problem) throw new ArgumentException($"not a crash report this server sends ({problem})");
        try
        {
            await sender.SendAsync(Url, ready, cancellation);
        }
        catch (Exception error) when (error is HttpRequestException or TaskCanceledException)
        {
            logger.LogDebug("Crash report kept for later: {Reason}", error.Message);
            if ((await secrets.ListAsync(QueueKind, cancellation)).Count(each => each.Value.Length > 0) < MaxQueued)
            {
                await secrets.PutAsync(QueueKind, Guid.NewGuid().ToString("N"), JsonSerializer.Serialize(ready, Json), cancellation);
            }
        }
    }

    /// <summary>Send what waited (with the usage report's hourly look).</summary>
    public async Task RetryAsync(CancellationToken cancellation)
    {
        if (!Enabled) return;
        foreach (var (name, value) in await secrets.ListAsync(QueueKind, cancellation))
        {
            if (value.Length == 0) continue;
            var report = JsonSerializer.Deserialize<CrashReport>(value, Json);
            if (report is not null) await sender.SendAsync(Url, report, cancellation);
            await secrets.DeleteAsync(QueueKind, name, cancellation);
        }
    }

    /// <summary>A crash report from an app, as the person agreed to send it.</summary>
    public CrashReport FromApp(AppCrash crash) => new()
    {
        Source = crash.Source is "android" ? "android" : "web",
        Version = crash.Version is { Length: > 0 and <= 64 } version ? version : ServerApp.Version,
        Channel = Channel(crash.Version ?? ServerApp.Version),
        Kind = crash.Kind ?? "",
        Fingerprint = crash.Fingerprint ?? "",
        Stack = crash.Stack ?? "",
        Device = crash.Device ?? [],
    };

    /// <summary>The server broke on a request: keep the report for the admin (the same bug counts up).</summary>
    public async Task RecordServerCrashAsync(Exception error, CancellationToken cancellation)
    {
        if (!Enabled) return;
        var place = error.StackTrace?.Split('\n').Select(line => line.Trim()).FirstOrDefault(line => line.StartsWith("at ", StringComparison.Ordinal)) ?? "";
        var print = Fingerprint($"{error.GetType().Name}|{place}");
        var report = new CrashReport
        {
            Source = "server",
            Version = ServerApp.Version,
            Channel = ServerApp.Stamped ? Channel(ServerApp.Version) : "dev",
            Kind = error.GetType().Name,
            Fingerprint = print,
            Stack = error.ToString(),
            Logs = logs is null
                ? []
                : [.. logs.Recent().Where(record => record.Level >= LogLevel.Warning).TakeLast(CrashReport.MaxLogLines)
                    .Select(record => $"{record.Time:O} {record.Level} {record.Category}: {record.Message}")],
        };
        await gate.WaitAsync(cancellation);
        try
        {
            var now = time.GetUtcNow();
            var kept = await ServerCrashesAsync(cancellation);
            var before = kept.FirstOrDefault(each => each.Fingerprint == print);
            var crash = new ServerCrash(print, (before?.Count ?? 0) + 1, before?.FirstAt ?? now, now, CrashReports.Clean(report));
            await secrets.PutAsync(ServerKind, print, JsonSerializer.Serialize(crash, Json), cancellation);
            // The oldest go once there are too many.
            foreach (var old in kept.Where(each => each.Fingerprint != print).OrderByDescending(each => each.LastAt).Skip(MaxServerCrashes - 1))
            {
                await secrets.PutAsync(ServerKind, old.Fingerprint, "", cancellation);
            }
        }
        finally
        {
            gate.Release();
        }
    }

    /// <summary>The server's own crashes, newest first.</summary>
    public async Task<IReadOnlyList<ServerCrash>> ServerCrashesAsync(CancellationToken cancellation) =>
        [.. (await secrets.ListAsync(ServerKind, cancellation))
            .Where(each => each.Value.Length > 0)
            .Select(each => JsonSerializer.Deserialize<ServerCrash>(each.Value, Json))
            .OfType<ServerCrash>()
            .OrderByDescending(each => each.LastAt)];

    public Task ForgetServerCrashAsync(string fingerprint, CancellationToken cancellation) =>
        secrets.PutAsync(ServerKind, fingerprint, "", cancellation);

    /// <summary>Eight hex digits of FNV-1a, the same hash the web app uses.</summary>
    public static string Fingerprint(string text)
    {
        var hash = 0x811c9dc5u;
        foreach (var unit in Encoding.UTF8.GetBytes(text))
        {
            hash ^= unit;
            hash *= 0x01000193;
        }
        return hash.ToString("x8", System.Globalization.CultureInfo.InvariantCulture);
    }
}

public static class CrashReportEndpoints
{
    /// <summary>Keeps every unhandled error on a request for the admin's crash list (the error still answers 500 as before).</summary>
    public static void UseServerCrashes(this WebApplication app)
    {
        var crashes = app.Services.GetRequiredService<CrashReporting>();
        app.Use(async (context, next) =>
        {
            try
            {
                await next(context);
            }
            catch (Exception error) when (error is not OperationCanceledException)
            {
                await crashes.RecordServerCrashAsync(error, CancellationToken.None);
                throw;
            }
        });
    }

    /// <summary><c>POST /api/crash-reports</c>: a report from an app, sent because the person said so.</summary>
    public static RouteGroupBuilder MapCrashReports(this RouteGroupBuilder api)
    {
        api.MapPost("/crash-reports", async (AppCrash crash, ClaimsPrincipal user, CrashReporting crashes, ClientTelemetry clients,
            CancellationToken cancellation) =>
        {
            if (!crashes.Enabled) return Results.NotFound(new AuthError("crash_reports_off"));
            if (user.Impersonator() is not null) return Results.NoContent();
            if ((await clients.ChoiceAsync(user.UserId(), cancellation)).CrashReports == "never") return Results.NoContent();
            try
            {
                await crashes.SendOrQueueAsync(crashes.FromApp(crash), cancellation);
            }
            catch (ArgumentException)
            {
                return Results.BadRequest(new AuthError("invalid"));
            }
            return Results.NoContent();
        }).Doc("An app's crash report, when crash reports are on (404 crash_reports_off when not)").Refuses(StatusCodes.Status400BadRequest, StatusCodes.Status404NotFound);
        return api;
    }

    /// <summary><c>/api/admin/crash-reports</c>: the server's own crashes; look, send, or forget each.</summary>
    public static RouteGroupBuilder MapAdminCrashReports(this RouteGroupBuilder admin)
    {
        admin.MapGet("/crash-reports", async (CrashReporting crashes, CancellationToken cancellation) =>
            Results.Ok(new ServerCrashes(crashes.Enabled, await crashes.ServerCrashesAsync(cancellation))))
            .Doc<ServerCrashes>("The server's own crash reports, and whether sending them is on")
            .RequirePermission(Permission.ManageSettings);

        admin.MapPost("/crash-reports/{fingerprint}/send", async (string fingerprint, CrashReporting crashes, CancellationToken cancellation) =>
        {
            if (!crashes.Enabled) return Results.NotFound(new AuthError("crash_reports_off"));
            if ((await crashes.ServerCrashesAsync(cancellation)).FirstOrDefault(each => each.Fingerprint == fingerprint) is not { } crash)
            {
                return Results.NotFound();
            }
            await crashes.SendOrQueueAsync(crash.Report, cancellation);
            await crashes.ForgetServerCrashAsync(fingerprint, cancellation);
            return Results.NoContent();
        }).Doc("Send one of the server's crash reports to the project").Refuses(StatusCodes.Status404NotFound).RequirePermission(Permission.ManageSettings).Audited("admin.crash-report-sent", targetRoute: null);

        admin.MapDelete("/crash-reports/{fingerprint}", async (string fingerprint, CrashReporting crashes, CancellationToken cancellation) =>
        {
            await crashes.ForgetServerCrashAsync(fingerprint, cancellation);
            return Results.NoContent();
        }).Doc("Forget one of the server's crash reports").RequirePermission(Permission.ManageSettings);
        return admin;
    }
}
