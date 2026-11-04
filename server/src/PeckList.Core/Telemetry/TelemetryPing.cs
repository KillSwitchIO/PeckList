using System.Text.RegularExpressions;

namespace PeckList.Core.Telemetry;

/// <summary>
/// The daily usage report a server sends to the telemetry collector (spec: PL-116, ADR-0018).
/// Counts are buckets and nothing in it is content: no titles, names, emails, addresses or ids
/// other than the random install id. Fields are only ever added; <see cref="Schema"/> goes up
/// when one is, so the collector keeps reading older servers.
/// </summary>
public sealed record TelemetryPing
{
    /// <summary>
    /// 2 added <see cref="Clients"/>; 3 added <see cref="Host"/>, <see cref="Storage"/>,
    /// <see cref="Rows"/>, the rest of <see cref="TelemetrySetup"/> and the apps' versions among the
    /// clients' device kinds.
    /// </summary>
    public const int CurrentSchema = 3;

    public int Schema { get; init; } = CurrentSchema;

    /// <summary>A random id made on the server's first start; the admin can make a new one.</summary>
    public required string InstallId { get; init; }

    public required string Version { get; init; }

    /// <summary>release, pre (an -rc or other pre-release), edge (a main build) or dev.</summary>
    public required string Channel { get; init; }

    /// <summary>Whole days since the install id was made.</summary>
    public int InstallAgeDays { get; init; }

    public required TelemetryRuntime Runtime { get; init; }

    public required TelemetrySetup Setup { get; init; }

    public required TelemetryScale Scale { get; init; }

    /// <summary>What the server's apps reported (schema 2); null when no one shared any.</summary>
    public TelemetryClients? Clients { get; init; }

    /// <summary>The machine it runs on, in buckets (schema 3).</summary>
    public TelemetryHost? Host { get; init; }

    /// <summary>What its data takes on disk, and what is left (schema 3).</summary>
    public TelemetryStorage? Storage { get; init; }

    /// <summary>How many rows of each kind it holds, by <see cref="TelemetryRows.Names"/>, in buckets (schema 3).</summary>
    public IReadOnlyDictionary<string, string>? Rows { get; init; }
}

/// <summary>
/// The machine, in buckets (schema 3): processor count, memory it may use (a container's limit
/// when it has one) and what the server uses, its average processor use since it started, how
/// long it has run, the kernel's major.minor, the container runtime, and the time zone setting.
/// </summary>
public sealed record TelemetryHost(
    string Cpus, string Memory, string ProcessMemory, string CpuUse, string Uptime, string Kernel, string ContainerRuntime,
    string TimeZone);

/// <summary>Sizes on disk in buckets (schema 3): the database, attachments, snapshots, log files, and free space where the data lives.</summary>
public sealed record TelemetryStorage(string Database, string Attachments, string Snapshots, string Logs, string DiskFree);

/// <summary>The kinds of rows the report counts: synced records by collection, and the server's own tables.</summary>
public static class TelemetryRows
{
    /// <summary>The synced collections (the web app's <c>COLLECTIONS</c>), counted when not deleted.</summary>
    public static readonly IReadOnlySet<string> Collections = new HashSet<string>(StringComparer.Ordinal)
    {
        "users", "folders", "lists", "sections", "tags", "tasks", "groups", "groupMembers", "listMembers", "friendships",
        "savedFilters", "settings", "comments", "attachments",
    };

    /// <summary>The server's own tables, by the name the report gives them.</summary>
    public static readonly IReadOnlyDictionary<string, string> Tables = new Dictionary<string, string>(StringComparer.Ordinal)
    {
        ["accounts"] = "accounts",
        ["identities"] = "identities",
        ["passkeys"] = "passkeys",
        ["apiKeys"] = "api_keys",
        ["pushSubscriptions"] = "push_subscriptions",
        ["notifications"] = "notifications",
        ["taskHistory"] = "task_history",
        ["auditEntries"] = "audit_entries",
        ["serverGroups"] = "server_groups",
        ["sentReminders"] = "sent_reminders",
    };

    public static readonly IReadOnlySet<string> Names = new HashSet<string>([.. Collections, .. Tables.Keys], StringComparer.Ordinal);
}

/// <summary>Where the server runs. <see cref="DatabaseSize"/> is a bucket.</summary>
public sealed record TelemetryRuntime(
    string Os, string Arch, bool Container, string Dotnet, string Database, string DatabaseSize);

/// <summary>How the server is set up: switches and bucketed counts, never names or addresses.</summary>
public sealed record TelemetrySetup(
    bool LocalLogin,
    bool NoAuth,
    int OidcProviders,
    string Registration,
    string Backups,
    bool UpdateCheck,
    string ApiKeys,
    bool Push,
    string? Email = null,
    bool? Passkeys = null,
    bool? HttpsAddress = null,
    bool? BehindProxy = null,
    IReadOnlyList<string>? LogOutputs = null,
    bool? CrashReports = null,
    IReadOnlyList<string>? OidcPresets = null,
    bool? Demo = null);

/// <summary>The names <see cref="TelemetrySetup"/>'s lists may hold (schema 3).</summary>
public static class TelemetrySetupNames
{
    /// <summary>off, custom, or a mail provider preset's name.</summary>
    public static IReadOnlySet<string> Email { get; } =
        new HashSet<string>(["off", "custom", .. Mail.MailProviders.Names], StringComparer.Ordinal);

    public static readonly IReadOnlySet<string> LogOutputs = new HashSet<string>(StringComparer.Ordinal)
    {
        "file", "otlp", "loki", "gelf", "elastic", "syslog",
    };

    /// <summary>An identity provider set up from a preset, or "custom" for any other.</summary>
    public static readonly IReadOnlySet<string> OidcPresets = new HashSet<string>(StringComparer.Ordinal) { "google", "custom" };

    public static readonly IReadOnlySet<string> ContainerRuntimes = new HashSet<string>(StringComparer.Ordinal)
    {
        "none", "docker", "podman", "kubernetes", "other",
    };
}

/// <summary>How big the server is, in buckets (<see cref="TelemetryBuckets"/>).</summary>
public sealed record TelemetryScale(
    string Users, string Lists, string SharedLists, string OpenTasks, string ClosedTasks, string Storage);

/// <summary>Buckets for counts and sizes, so no install can be told apart by its exact numbers.</summary>
public static partial class TelemetryBuckets
{
    public static readonly IReadOnlyList<string> Channels = ["release", "pre", "edge", "dev"];

    public static string Count(long count) => count switch
    {
        <= 0 => "0",
        1 => "1",
        <= 5 => "2-5",
        <= 20 => "6-20",
        <= 100 => "21-100",
        <= 500 => "101-500",
        <= 2000 => "501-2000",
        _ => "2001+",
    };

    public static string Cpus(int count) => count switch
    {
        <= 1 => "1",
        2 => "2",
        <= 4 => "3-4",
        <= 8 => "5-8",
        <= 16 => "9-16",
        <= 32 => "17-32",
        _ => "33+",
    };

    /// <summary>Memory a machine or container has.</summary>
    public static string Memory(long bytes) => bytes switch
    {
        < 1L << 30 => "<1GB",
        < 2L << 30 => "1-2GB",
        < 4L << 30 => "2-4GB",
        < 8L << 30 => "4-8GB",
        < 16L << 30 => "8-16GB",
        < 32L << 30 => "16-32GB",
        < 64L << 30 => "32-64GB",
        _ => "64GB+",
    };

    /// <summary>Memory the server itself uses.</summary>
    public static string ProcessMemory(long bytes) => bytes switch
    {
        < 100L << 20 => "<100MB",
        < 250L << 20 => "100-250MB",
        < 500L << 20 => "250-500MB",
        < 1L << 30 => "500MB-1GB",
        _ => "1GB+",
    };

    /// <summary>Free space on a disk.</summary>
    public static string Disk(long bytes) => bytes switch
    {
        < 1L << 30 => "<1GB",
        < 10L << 30 => "1-10GB",
        < 100L << 30 => "10-100GB",
        < 1L << 40 => "100GB-1TB",
        _ => "1TB+",
    };

    /// <summary>Average processor use, as a share of all the processors it may use.</summary>
    public static string CpuUse(double share) => share switch
    {
        < 0.01 => "<1%",
        < 0.05 => "1-5%",
        < 0.20 => "5-20%",
        < 0.50 => "20-50%",
        _ => "50%+",
    };

    public static string Uptime(TimeSpan running) => running.TotalHours switch
    {
        < 1 => "<1h",
        < 24 => "1-24h",
        < 24 * 7 => "1-7d",
        < 24 * 30 => "7-30d",
        _ => "30d+",
    };

    public static string Bytes(long bytes) => bytes switch
    {
        < 1L << 20 => "<1MB",
        < 10L << 20 => "1-10MB",
        < 100L << 20 => "10-100MB",
        < 1L << 30 => "100MB-1GB",
        < 10L << 30 => "1-10GB",
        _ => "10GB+",
    };

    /// <summary>
    /// The channel a version comes from: <c>0.3.0</c> release, <c>0.3.0-rc.1</c> pre,
    /// <c>0.3.1-edge.1a2b3c4d</c> edge, <c>0.0.0-dev</c> or <c>…-dev…</c> dev.
    /// </summary>
    public static string ChannelOf(string version)
    {
        var pre = version.Split('+')[0].Split('-', 2) is [_, var rest] ? rest : null;
        if (pre is null) return version.StartsWith("0.0.0", StringComparison.Ordinal) ? "dev" : "release";
        if (pre.StartsWith("edge", StringComparison.Ordinal)) return "edge";
        if (pre.StartsWith("dev", StringComparison.Ordinal)) return "dev";
        return "pre";
    }

    /// <summary>Why a ping cannot be taken, or null when it can.</summary>
    public static string? Problem(TelemetryPing ping)
    {
        if (ping.Schema < 1 || ping.Schema > 100) return "schema";
        if (!Guid.TryParse(ping.InstallId, out _)) return "installId";
        if (ping.Version is not { Length: > 0 and <= 64 } || !VersionText().IsMatch(ping.Version)) return "version";
        if (!Channels.Contains(ping.Channel)) return "channel";
        if (ping.InstallAgeDays is < 0 or > 100_000) return "installAgeDays";
        if (ping.Runtime is null || ping.Setup is null || ping.Scale is null) return "sections";
        string?[] texts =
        [
            ping.Runtime.Os, ping.Runtime.Arch, ping.Runtime.Dotnet, ping.Runtime.Database, ping.Runtime.DatabaseSize,
            ping.Setup.Registration, ping.Setup.Backups, ping.Setup.ApiKeys,
            ping.Scale.Users, ping.Scale.Lists, ping.Scale.SharedLists, ping.Scale.OpenTasks, ping.Scale.ClosedTasks, ping.Scale.Storage,
        ];
        if (texts.Any(text => text is null || text.Length > 40)) return "text";
        if (ping.Setup.OidcProviders is < 0 or > 1000) return "oidcProviders";
        if (ping.Clients is { } clients && ClientsProblem(clients) is { } problem) return problem;
        if (SetupProblem(ping.Setup) is { } setup) return setup;
        if (ping.Host is { } host && HostProblem(host) is { } machine) return machine;
        if (ping.Storage is { } storage
            && new[] { storage.Database, storage.Attachments, storage.Snapshots, storage.Logs, storage.DiskFree }
                .Any(value => value is not { Length: > 0 and <= 12 } || !BucketText().IsMatch(value))) return "storage";
        if (ping.Rows is { } rows
            && (rows.Count > TelemetryRows.Names.Count
                || rows.Any(each => !TelemetryRows.Names.Contains(each.Key) || each.Value is not { Length: > 0 and <= 12 } || !BucketText().IsMatch(each.Value))))
        {
            return "rows";
        }
        return null;
    }

    private static string? SetupProblem(TelemetrySetup setup)
    {
        if (setup.Email is { } email && !TelemetrySetupNames.Email.Contains(email)) return "setup.email";
        if (setup.LogOutputs is { } outputs && (outputs.Count > 10 || outputs.Any(each => !TelemetrySetupNames.LogOutputs.Contains(each)))) return "setup.logOutputs";
        if (setup.OidcPresets is { } presets && (presets.Count > 1000 || presets.Any(each => !TelemetrySetupNames.OidcPresets.Contains(each)))) return "setup.oidcPresets";
        return null;
    }

    private static string? HostProblem(TelemetryHost host)
    {
        static bool Bucket(string? value) => value is { Length: > 0 and <= 12 } && BucketText().IsMatch(value);
        if (!Bucket(host.Cpus) || !Bucket(host.Memory) || !Bucket(host.ProcessMemory) || !Bucket(host.Uptime)) return "host";
        if (host.CpuUse is not { Length: > 0 and <= 12 } || !PercentText().IsMatch(host.CpuUse)) return "host.cpuUse";
        if (host.Kernel is null || (host.Kernel != "unknown" && !KernelText().IsMatch(host.Kernel))) return "host.kernel";
        if (!TelemetrySetupNames.ContainerRuntimes.Contains(host.ContainerRuntime)) return "host.containerRuntime";
        if (host.TimeZone is not { Length: > 0 and <= 40 } || !TimeZoneText().IsMatch(host.TimeZone)) return "host.timeZone";
        return null;
    }

    /// <summary>Every name on its list and every value a bucket, so nothing else can ride along.</summary>
    private static string? ClientsProblem(TelemetryClients clients)
    {
        static bool Bucket(string? value) => value is { Length: > 0 and <= 12 } && BucketText().IsMatch(value);
        if (!Bucket(clients.People)) return "clients.people";
        if (clients.Devices is null || clients.Features is null || clients.Errors is null || clients.Timings is null) return "clients";
        if (clients.Devices.Any(each => !ClientUsage.KnownKind(each.Key) || !Bucket(each.Value))) return "clients.devices";
        if (clients.Features.Any(each => !ClientUsage.Features.Contains(each.Key) || !Bucket(each.Value))) return "clients.features";
        if (clients.Errors.Count > ClientUsage.MaxErrors
            || clients.Errors.Any(each => !ClientUsage.Fingerprint().IsMatch(each.Key) || !Bucket(each.Value))) return "clients.errors";
        if (clients.Timings.Any(each => !ClientUsage.Timings.Contains(each.Key) || !Bucket(each.Value))) return "clients.timings";
        return null;
    }

    [GeneratedRegex(@"^[0-9a-zA-Z<+.-]+$")]
    private static partial Regex BucketText();

    [GeneratedRegex(@"^[0-9A-Za-z.+-]+$")]
    private static partial Regex VersionText();

    [GeneratedRegex(@"^[<0-9-]+%\+?$")]
    private static partial Regex PercentText();

    [GeneratedRegex(@"^[0-9]{1,3}\.[0-9]{1,3}$")]
    private static partial Regex KernelText();

    [GeneratedRegex(@"^[A-Za-z0-9_+/-]+$")]
    private static partial Regex TimeZoneText();
}
