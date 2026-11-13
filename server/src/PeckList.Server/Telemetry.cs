using System.Diagnostics;
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
        var databaseBytes = await source.DatabaseBytesAsync(cancellation);
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
                TelemetryBuckets.Bytes(databaseBytes)),
            Setup = new TelemetrySetup(
                settings.AuthMode == AuthMode.Local && !settings.LocalLoginDisabled,
                settings.AuthMode == AuthMode.None,
                settings.OidcProviders.Count,
                settings.Registration.ToString().ToLowerInvariant(),
                settings.SnapshotSchedule.ToString().ToLowerInvariant(),
                settings.UpdateCheck,
                TelemetryBuckets.Count(await source.ActiveApiKeysAsync(now, cancellation)),
                await source.AnyPushSubscriptionAsync(cancellation),
                Email: settings.Mail is null ? "off" : settings.MailProvider ?? "custom",
                Passkeys: settings.Passkeys,
                HttpsAddress: settings.PublicUrl?.Scheme == Uri.UriSchemeHttps,
                BehindProxy: !string.IsNullOrWhiteSpace(settings.TrustedProxies),
                LogOutputs: LogOutputs(settings.Logging),
                CrashReports: settings.CrashReports,
                OidcPresets: [.. settings.OidcProviders.Select(provider => provider.Preset is "google" ? "google" : "custom")],
                Demo: settings.DemoMode),
            Scale = new TelemetryScale(
                TelemetryBuckets.Count(totals.Users),
                TelemetryBuckets.Count(totals.Lists),
                TelemetryBuckets.Count(totals.SharedLists),
                TelemetryBuckets.Count(totals.OpenTasks),
                TelemetryBuckets.Count(totals.ClosedTasks),
                TelemetryBuckets.Bytes(totals.StorageBytes)),
            Clients = clients is null ? null : await clients.SummaryAsync(cancellation),
            Host = Machine.Facts(now),
            Storage = new TelemetryStorage(
                TelemetryBuckets.Bytes(databaseBytes),
                TelemetryBuckets.Bytes(totals.StorageBytes),
                TelemetryBuckets.Bytes(Machine.FolderBytes(settings.SnapshotDir)),
                TelemetryBuckets.Bytes(settings.Logging.Files ? Machine.FolderBytes(settings.Logging.Dir) : 0),
                TelemetryBuckets.Disk(Machine.FreeBytes(settings.DbProvider == DbProvider.Sqlite ? settings.DbPath : settings.AttachmentDir))),
            Rows = (await source.RowCountsAsync(cancellation))
                .ToDictionary(each => each.Key, each => TelemetryBuckets.Count(each.Value), StringComparer.Ordinal),
        };
    }

    private static IReadOnlyList<string> LogOutputs(LoggingSettings logging) =>
    [
        .. new (bool On, string Name)[]
        {
            (logging.Files, "file"), (logging.OtlpEndpoint is not null, "otlp"), (logging.LokiUrl is not null, "loki"),
            (logging.Gelf is not null, "gelf"), (logging.ElasticUrl is not null, "elastic"), (logging.Syslog is not null, "syslog"),
        }.Where(each => each.On).Select(each => each.Name),
    ];

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

/// <summary>The machine's facts for the report (schema 3), each read so that a failure only leaves it "unknown".</summary>
internal static class Machine
{
    public static TelemetryHost Facts(DateTimeOffset now)
    {
        using var process = Process.GetCurrentProcess();
        var running = now - new DateTimeOffset(process.StartTime.ToUniversalTime(), TimeSpan.Zero);
        var cpus = Environment.ProcessorCount;
        var share = running.TotalSeconds > 0 ? process.TotalProcessorTime.TotalSeconds / (running.TotalSeconds * cpus) : 0;
        return new TelemetryHost(
            TelemetryBuckets.Cpus(cpus),
            TelemetryBuckets.Memory(GC.GetGCMemoryInfo().TotalAvailableMemoryBytes),
            TelemetryBuckets.ProcessMemory(Environment.WorkingSet),
            TelemetryBuckets.CpuUse(share),
            TelemetryBuckets.Uptime(running),
            Environment.OSVersion.Version is { Major: > 0 } kernel ? $"{kernel.Major}.{kernel.Minor}" : "unknown",
            ContainerRuntime(),
            TimeZoneInfo.Local.Id is { Length: > 0 and <= 40 } zone ? zone : "unknown");
    }

    private static string ContainerRuntime()
    {
        if (Environment.GetEnvironmentVariable("KUBERNETES_SERVICE_HOST") is { Length: > 0 }) return "kubernetes";
        if (File.Exists("/run/.containerenv")) return "podman";
        if (File.Exists("/.dockerenv")) return "docker";
        return Environment.GetEnvironmentVariable("DOTNET_RUNNING_IN_CONTAINER") == "true" ? "other" : "none";
    }

    /// <summary>The bytes the files under a folder take; 0 when it is missing or cannot be read.</summary>
    public static long FolderBytes(string path)
    {
        try
        {
            return Directory.Exists(path)
                ? new DirectoryInfo(path).EnumerateFiles("*", new EnumerationOptions { RecurseSubdirectories = true, IgnoreInaccessible = true })
                    .Sum(file => file.Length)
                : 0;
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            return 0;
        }
    }

    /// <summary>Free space on the disk a path is on; 0 when it cannot be told.</summary>
    public static long FreeBytes(string path)
    {
        try
        {
            var folder = Path.GetDirectoryName(Path.GetFullPath(path)) ?? path;
            while (!Directory.Exists(folder) && Path.GetDirectoryName(folder) is { } parent) folder = parent;
            return new DriveInfo(folder).AvailableFreeSpace;
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or ArgumentException)
        {
            return 0;
        }
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
        }).WithSummary("Telemetry: whether it is on, where it goes, when it last went, and the report it sends").RequirePermission(Permission.ManageSettings);

        admin.MapPost("/telemetry/new-id", async (TelemetryReport report, CancellationToken cancellation) =>
        {
            await report.NewInstallIdAsync(cancellation);
            return Results.NoContent();
        }).Doc("A new anonymous server id for telemetry").RequirePermission(Permission.ManageSettings).Audited("admin.telemetry-id-renewed", targetRoute: null);

        admin.MapPost("/telemetry/notice-seen", async (TelemetryReport report, CancellationToken cancellation) =>
        {
            await report.MarkNoticeSeenAsync(cancellation);
            return Results.NoContent();
        }).Doc("Mark the telemetry notice seen, so the admin pages stop showing it").RequirePermission(Permission.ManageSettings);
        return admin;
    }
}

/// <summary>The answer of <c>GET /api/admin/telemetry</c>.</summary>
public sealed record TelemetryInfo(bool Enabled, string Url, DateTimeOffset? SentAt, bool NoticeSeen, TelemetryPing Report);
