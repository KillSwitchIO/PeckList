using System.Text.RegularExpressions;

namespace Punchlist.Core.Telemetry;

/// <summary>
/// The daily usage report a server sends to the telemetry collector (spec: PL-116, ADR-0018).
/// Counts are buckets and nothing in it is content: no titles, names, emails, addresses or ids
/// other than the random install id. Fields are only ever added; <see cref="Schema"/> goes up
/// when one is, so the collector keeps reading older servers.
/// </summary>
public sealed record TelemetryPing
{
    public const int CurrentSchema = 1;

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
    bool Push);

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
        return null;
    }

    [GeneratedRegex(@"^[0-9A-Za-z.+-]+$")]
    private static partial Regex VersionText();
}
