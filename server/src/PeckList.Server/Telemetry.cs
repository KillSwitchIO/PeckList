using System.Globalization;
using System.Runtime.InteropServices;
using PeckList.Core.Accounts;
using PeckList.Core.Configuration;
using PeckList.Core.Stats;
using PeckList.Core.Telemetry;
using PeckList.Server.Audit;
using PeckList.Server.Auth;

namespace PeckList.Server;

/// <summary>Where the daily report goes.</summary>
public interface ITelemetrySender
{
    Task SendAsync(Uri url, TelemetryPing ping, CancellationToken cancellation);
}

/// <summary>A POST of the report as JSON; anything but a 2xx is a failure.</summary>
public sealed class HttpTelemetrySender(IHttpClientFactory http) : ITelemetrySender
{
    public async Task SendAsync(Uri url, TelemetryPing ping, CancellationToken cancellation)
    {
        using var response = await http.CreateClient("telemetry").PostAsJsonAsync(url, ping, cancellation);
        response.EnsureSuccessStatusCode();
    }
}

/// <summary>
/// The daily usage report (spec: PL-116): made from the server stats, the setup and a random
/// install id, all counts bucketed. Kept small values in the secret store under <see cref="Kind"/>:
/// the install id, when it was made, when a report last went, and whether an admin has seen the notice.
/// </summary>
public sealed class TelemetryReport(
    ISecretStore secrets, StatsService stats, ITelemetrySource source, LiveSettings live, TimeProvider time, ClientTelemetry? clients = null)
{
    public const string Kind = "telemetry";

    private readonly SemaphoreSlim gate = new(1, 1);

    /// <summary>The install id and when it was made, made on first asking.</summary>
    public async Task<(string Id, DateTimeOffset Since)> InstallAsync(CancellationToken cancellation)
    {
        await gate.WaitAsync(cancellation);
        try
        {
            var values = await ValuesAsync(cancellation);
            if (values.TryGetValue("install-id", out var id) && Guid.TryParse(id, out _)
                && values.TryGetValue("installed-at", out var at) && DateTimeOffset.TryParse(at, CultureInfo.InvariantCulture, out var since))
            {
                return (id, since);
            }
            return await NewIdLockedAsync(cancellation);
        }
        finally
        {
            gate.Release();
        }
    }

    /// <summary>A new install id: reports from here on cannot be tied to the earlier ones.</summary>
    public async Task<string> NewInstallIdAsync(CancellationToken cancellation)
    {
        await gate.WaitAsync(cancellation);
        try
        {
            return (await NewIdLockedAsync(cancellation)).Id;
        }
        finally
        {
            gate.Release();
        }
    }

    public async Task<DateTimeOffset?> SentAtAsync(CancellationToken cancellation) =>
        (await ValuesAsync(cancellation)).TryGetValue("sent-at", out var at) && DateTimeOffset.TryParse(at, CultureInfo.InvariantCulture, out var when)
            ? when
            : null;

    /// <summary>The report went: note when, and start the next day's client counts.</summary>
    public async Task MarkSentAsync(DateTimeOffset at, CancellationToken cancellation)
    {
        await secrets.PutAsync(Kind, "sent-at", at.ToString("O", CultureInfo.InvariantCulture), cancellation);
        if (clients is not null) await clients.ResetAsync(cancellation);
    }

    public async Task<bool> NoticeSeenAsync(CancellationToken cancellation) =>
        (await ValuesAsync(cancellation)).ContainsKey("notice-seen");

    public Task MarkNoticeSeenAsync(CancellationToken cancellation) =>
        secrets.PutAsync(Kind, "notice-seen", time.GetUtcNow().ToString("O", CultureInfo.InvariantCulture), cancellation);

    /// <summary>The report as it would go now.</summary>
    public async Task<TelemetryPing> BuildAsync(CancellationToken cancellation)
    {
        var settings = live.Current;
        var now = time.GetUtcNow();
        var (id, since) = await InstallAsync(cancellation);
        var totals = await stats.GetAsync(cancellation);
        return new TelemetryPing
        {
            InstallId = id,
            Version = ServerApp.Version,
            Channel = ServerApp.Stamped ? TelemetryBuckets.ChannelOf(ServerApp.Version) : "dev",
            InstallAgeDays = Math.Max(0, (int)(now - since).TotalDays),
            Runtime = new TelemetryRuntime(
                Os(),
                RuntimeInformation.OSArchitecture.ToString().ToLowerInvariant(),
                Environment.GetEnvironmentVariable("DOTNET_RUNNING_IN_CONTAINER") == "true",
                Environment.Version.ToString(),
                settings.DbProvider.ToString().ToLowerInvariant(),
                TelemetryBuckets.Bytes(await source.DatabaseBytesAsync(cancellation))),
            Setup = new TelemetrySetup(
                settings.AuthMode == AuthMode.Local && !settings.LocalLoginDisabled,
                settings.AuthMode == AuthMode.None,
                settings.OidcProviders.Count,
                settings.Registration.ToString().ToLowerInvariant(),
                settings.SnapshotSchedule.ToString().ToLowerInvariant(),
                settings.UpdateCheck,
                TelemetryBuckets.Count(await source.ActiveApiKeysAsync(now, cancellation)),
                await source.AnyPushSubscriptionAsync(cancellation)),
            Scale = new TelemetryScale(
                TelemetryBuckets.Count(totals.Users),
                TelemetryBuckets.Count(totals.Lists),
                TelemetryBuckets.Count(totals.SharedLists),
                TelemetryBuckets.Count(totals.OpenTasks),
                TelemetryBuckets.Count(totals.ClosedTasks),
                TelemetryBuckets.Bytes(totals.StorageBytes)),
            Clients = clients is null ? null : await clients.SummaryAsync(cancellation),
        };
    }

    private static string Os() =>
        OperatingSystem.IsLinux() ? "linux"
        : OperatingSystem.IsWindows() ? "windows"
        : OperatingSystem.IsMacOS() ? "macos"
        : OperatingSystem.IsFreeBSD() ? "freebsd"
        : "other";

    private async Task<Dictionary<string, string>> ValuesAsync(CancellationToken cancellation) =>
        (await secrets.ListAsync(Kind, cancellation)).ToDictionary(each => each.Name, each => each.Value);

    private async Task<(string Id, DateTimeOffset Since)> NewIdLockedAsync(CancellationToken cancellation)
    {
        var id = Guid.NewGuid().ToString();
        var since = time.GetUtcNow();
        await secrets.PutAsync(Kind, "install-id", id, cancellation);
        await secrets.PutAsync(Kind, "installed-at", since.ToString("O", CultureInfo.InvariantCulture), cancellation);
        return (id, since);
    }
}

/// <summary>
/// Sends the report once a day while <c>TELEMETRY</c> is on (spec: PL-116). It looks every hour
/// and sends when the last report is a day old, so restarts do not send more often. A failed send
/// is logged quietly (a server with no internet should not fill its log) and tried at the next look.
/// </summary>
public sealed class TelemetryService(
    TelemetryReport report, ITelemetrySender sender, LiveSettings live, TimeProvider time, ILogger<TelemetryService> logger,
    CrashReporting? crashes = null)
    : PeriodicService("Usage report", TimeSpan.FromMinutes(5), TimeSpan.FromHours(1), time, logger, LogLevel.Debug)
{
    /// <summary>A report goes when the last one is at least this old (a day, less a little drift).</summary>
    public static readonly TimeSpan Gap = TimeSpan.FromHours(23.5);

    internal Task RunOnceAsync(CancellationToken stopping) => RunAsync(stopping);

    protected override async Task RunAsync(CancellationToken stopping)
    {
        var settings = live.Current;
        // Crash reports that could not go wait for this hourly look, usage reports on or not.
        if (crashes is not null) await crashes.RetryAsync(stopping);
        if (!settings.Telemetry) return;
        if (await report.SentAtAsync(stopping) is { } last && Time.GetUtcNow() - last < Gap) return;
        var ping = await report.BuildAsync(stopping);
        await sender.SendAsync(settings.TelemetryUrl, ping, stopping);
        await report.MarkSentAsync(Time.GetUtcNow(), stopping);
        Logger.LogDebug("Usage report sent to {Url}", settings.TelemetryUrl);
    }
}

public static class TelemetryEndpoints
{
    /// <summary>
    /// <c>GET /api/admin/telemetry</c>: whether reports go, where, and the report exactly as it
    /// would go now ("See what's sent"); <c>POST .../new-id</c> starts a new install id;
    /// <c>POST .../notice-seen</c> stops the first-start notice.
    /// </summary>
    public static RouteGroupBuilder MapTelemetry(this RouteGroupBuilder admin)
    {
        admin.MapGet("/telemetry", async (TelemetryReport report, LiveSettings live, CancellationToken cancellation) =>
        {
            var settings = live.Current;
            return new TelemetryInfo(
                settings.Telemetry,
                settings.TelemetryUrl.ToString(),
                await report.SentAtAsync(cancellation),
                await report.NoticeSeenAsync(cancellation),
                await report.BuildAsync(cancellation));
        }).RequirePermission(Permission.ManageSettings);

        admin.MapPost("/telemetry/new-id", async (TelemetryReport report, CancellationToken cancellation) =>
        {
            await report.NewInstallIdAsync(cancellation);
            return Results.NoContent();
        }).RequirePermission(Permission.ManageSettings).Audited("admin.telemetry-id-renewed", targetRoute: null);

        admin.MapPost("/telemetry/notice-seen", async (TelemetryReport report, CancellationToken cancellation) =>
        {
            await report.MarkNoticeSeenAsync(cancellation);
            return Results.NoContent();
        }).RequirePermission(Permission.ManageSettings);
        return admin;
    }
}

/// <summary>The answer of <c>GET /api/admin/telemetry</c>.</summary>
public sealed record TelemetryInfo(bool Enabled, string Url, DateTimeOffset? SentAt, bool NoticeSeen, TelemetryPing Report);
