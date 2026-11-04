using System.Text.RegularExpressions;

namespace PeckList.Core.Telemetry;

/// <summary>
/// What a server's apps reported in the daily usage report (PL-116, schema 2), all bucketed:
/// the people who share, their devices by kind, feature use, error fingerprints and timings. No
/// names that are not on the lists in <see cref="ClientUsage"/> ever get this far.
/// </summary>
public sealed record TelemetryClients(
    string People,
    IReadOnlyDictionary<string, string> Devices,
    IReadOnlyDictionary<string, string> Features,
    IReadOnlyDictionary<string, string> Errors,
    IReadOnlyDictionary<string, string> Timings);

/// <summary>
/// One device's counts since it last reported, as the app sends them to its own server (never to
/// the collector). <see cref="Device"/> is a random id the app made, kept on the server only to
/// count devices.
/// </summary>
public sealed record ClientReport(
    string? Device = null,
    string? Platform = null,
    string? Browser = null,
    string? Os = null,
    string? Screen = null,
    string? Theme = null,
    string? Language = null,
    IReadOnlyDictionary<string, int>? Features = null,
    IReadOnlyDictionary<string, int>? Errors = null,
    IReadOnlyDictionary<string, int[]>? Timings = null,
    string? Notify = null,
    string? Exact = null,
    string? Battery = null,
    string? Web = null,
    string? App = null);

/// <summary>
/// The names client counts may use, and how a day of reports becomes the report's
/// <see cref="TelemetryClients"/>. Anything not on these lists is dropped where it arrives.
/// </summary>
public static partial class ClientUsage
{
    public static readonly IReadOnlySet<string> Platforms = new HashSet<string>(StringComparer.Ordinal) { "tab", "pwa", "android" };
    public static readonly IReadOnlySet<string> Browsers = new HashSet<string>(StringComparer.Ordinal) { "chrome", "edge", "firefox", "safari", "samsung", "other" };
    public static readonly IReadOnlySet<string> Systems = new HashSet<string>(StringComparer.Ordinal) { "windows", "macos", "linux", "android", "ios", "chromeos", "other" };
    public static readonly IReadOnlySet<string> Screens = new HashSet<string>(StringComparer.Ordinal) { "phone", "tablet", "desktop" };
    public static readonly IReadOnlySet<string> Themes = new HashSet<string>(StringComparer.Ordinal) { "light", "dark" };

    /// <summary>Things people do that are worth counting; the app counts nothing else.</summary>
    public static readonly IReadOnlySet<string> Features = new HashSet<string>(StringComparer.Ordinal)
    {
        "view.today", "view.inbox", "view.upcoming", "view.due", "view.all", "view.calendar", "view.day", "view.search",
        "view.completed", "view.trash", "view.list", "view.tag", "view.filter", "view.assigned", "view.shared",
        "view.friends", "view.notifications", "view.stats", "view.settings",
        "task.added", "task.completed", "quickAdd.date", "quickAdd.tag", "quickAdd.list", "quickAdd.priority",
        "drag.reschedule", "undo", "shortcut", "swipe", "easterEgg", "dataError",
        // The Android app: how late reminders showed against when they were due.
        "reminder.onTime", "reminder.late1m", "reminder.late5m", "reminder.lateMore",
    };

    /** On or off: the Android permissions reminders need (notifications, exact alarms, no battery limits). */
    public static readonly IReadOnlySet<string> Switches = new HashSet<string>(StringComparer.Ordinal) { "on", "off" };

    public static readonly IReadOnlySet<string> Timings = new HashSet<string>(StringComparer.Ordinal) { "coldStart", "sync", "search" };

    public const int MaxErrors = 20;
    public const int MaxCount = 100_000;
    public const int MaxSamples = 200;

    [GeneratedRegex("^[0-9a-f]{8}$")]
    public static partial Regex Fingerprint();

    [GeneratedRegex("^[a-z]{2}$")]
    private static partial Regex Language();

    [GeneratedRegex("^[A-Za-z0-9_-]{8,64}$")]
    private static partial Regex DeviceId();

    /// <summary>A release, pre-release or build version (0.7.1, 0.7.1-rc.1, 0.7.1-edge.1a2b3c4d), nothing longer.</summary>
    [GeneratedRegex(@"^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,6}(-[a-z]{1,8}(\.[0-9a-z]{1,40})?)?$")]
    private static partial Regex AppVersion();

    /// <summary>A median time in buckets.</summary>
    public static string Duration(double milliseconds) => milliseconds switch
    {
        < 100 => "<100ms",
        < 300 => "100-300ms",
        < 1000 => "300ms-1s",
        < 3000 => "1-3s",
        < 10_000 => "3-10s",
        _ => "10s+",
    };

    /// <summary>The device's kind as dimension:value pairs, each from its list (unknowns left out).</summary>
    public static IEnumerable<string> Kinds(ClientReport report)
    {
        if (report.Platform is { } platform && Platforms.Contains(platform)) yield return $"platform:{platform}";
        if (report.Browser is { } browser && Browsers.Contains(browser)) yield return $"browser:{browser}";
        if (report.Os is { } os && Systems.Contains(os)) yield return $"os:{os}";
        if (report.Screen is { } screen && Screens.Contains(screen)) yield return $"screen:{screen}";
        if (report.Theme is { } theme && Themes.Contains(theme)) yield return $"theme:{theme}";
        if (report.Language is { } language && Language().IsMatch(language)) yield return $"language:{language}";
        if (report.Notify is { } notify && Switches.Contains(notify)) yield return $"notify:{notify}";
        if (report.Exact is { } exact && Switches.Contains(exact)) yield return $"exact:{exact}";
        if (report.Battery is { } battery && Switches.Contains(battery)) yield return $"battery:{battery}";
        // The web app's version, and the Android app's around it (schema 3).
        if (report.Web is { } web && AppVersion().IsMatch(web)) yield return $"web:{web}";
        if (report.App is { } app && AppVersion().IsMatch(app)) yield return $"app:{app}";
    }

    /** Whether a dimension:value pair is one <see cref="Kinds"/> can make. */
    public static bool KnownKind(string kind)
    {
        string? Value(string dimension) => kind.StartsWith(dimension + ":", StringComparison.Ordinal) ? kind[(dimension.Length + 1)..] : null;
        return Kinds(new ClientReport(
            Platform: Value("platform"), Browser: Value("browser"), Os: Value("os"), Screen: Value("screen"), Theme: Value("theme"),
            Language: Value("language"), Notify: Value("notify"), Exact: Value("exact"), Battery: Value("battery"),
            Web: Value("web"), App: Value("app"))).Contains(kind);
    }

    /// <summary>The report with everything not on the lists dropped and counts capped; null when its device id is no good.</summary>
    public static ClientReport? Clean(ClientReport report)
    {
        if (report.Device is not { } device || !DeviceId().IsMatch(device)) return null;
        static int Cap(int count) => Math.Clamp(count, 0, MaxCount);
        return report with
        {
            Features = (report.Features ?? new Dictionary<string, int>())
                .Where(each => Features.Contains(each.Key) && each.Value > 0)
                .ToDictionary(each => each.Key, each => Cap(each.Value), StringComparer.Ordinal),
            Errors = (report.Errors ?? new Dictionary<string, int>())
                .Where(each => Fingerprint().IsMatch(each.Key) && each.Value > 0)
                .Take(MaxErrors)
                .ToDictionary(each => each.Key, each => Cap(each.Value), StringComparer.Ordinal),
            Timings = (report.Timings ?? new Dictionary<string, int[]>())
                .Where(each => Timings.Contains(each.Key))
                .ToDictionary(each => each.Key, each => each.Value.Where(ms => ms is >= 0 and < 3_600_000).Take(MaxSamples).ToArray(),
                    StringComparer.Ordinal),
        };
    }
}

/// <summary>
/// A day of client reports added up, as the server keeps it until the next report goes:
/// devices (by their app-made id) and their kinds, the people who shared (by account id), and
/// the counts. Ids never leave the server; only how many there were.
/// </summary>
public sealed class ClientTally
{
    public Dictionary<string, string[]> Devices { get; init; } = new(StringComparer.Ordinal);
    public HashSet<string> People { get; init; } = new(StringComparer.Ordinal);
    public Dictionary<string, long> Features { get; init; } = new(StringComparer.Ordinal);
    public Dictionary<string, long> Errors { get; init; } = new(StringComparer.Ordinal);
    public Dictionary<string, List<int>> Timings { get; init; } = new(StringComparer.Ordinal);

    public bool Empty => Devices.Count == 0;

    /// <summary>Add one cleaned report from a person's device.</summary>
    public void Add(string person, ClientReport report)
    {
        People.Add(person);
        Devices[report.Device!] = [.. ClientUsage.Kinds(report)];
        foreach (var (name, count) in report.Features ?? new Dictionary<string, int>()) Features[name] = Features.GetValueOrDefault(name) + count;
        foreach (var (print, count) in report.Errors ?? new Dictionary<string, int>())
        {
            if (Errors.ContainsKey(print) || Errors.Count < ClientUsage.MaxErrors * 2) Errors[print] = Errors.GetValueOrDefault(print) + count;
        }
        foreach (var (name, samples) in report.Timings ?? new Dictionary<string, int[]>())
        {
            var kept = Timings.TryGetValue(name, out var list) ? list : Timings[name] = [];
            kept.AddRange(samples);
            if (kept.Count > ClientUsage.MaxSamples) kept.RemoveRange(0, kept.Count - ClientUsage.MaxSamples);
        }
    }

    /// <summary>The tally as the report carries it: every number a bucket, timings as medians.</summary>
    public TelemetryClients Summary() => new(
        TelemetryBuckets.Count(People.Count),
        Devices.Values.SelectMany(kinds => kinds).GroupBy(kind => kind)
            .ToDictionary(group => group.Key, group => TelemetryBuckets.Count(group.Count()), StringComparer.Ordinal),
        Features.ToDictionary(each => each.Key, each => TelemetryBuckets.Count(each.Value), StringComparer.Ordinal),
        Errors.OrderByDescending(each => each.Value).Take(ClientUsage.MaxErrors)
            .ToDictionary(each => each.Key, each => TelemetryBuckets.Count(each.Value), StringComparer.Ordinal),
        Timings.Where(each => each.Value.Count > 0)
            .ToDictionary(each => each.Key, each => ClientUsage.Duration(Median(each.Value)), StringComparer.Ordinal));

    private static double Median(List<int> samples)
    {
        var sorted = samples.Order().ToList();
        return sorted.Count % 2 == 1 ? sorted[sorted.Count / 2] : (sorted[sorted.Count / 2 - 1] + sorted[sorted.Count / 2]) / 2.0;
    }
}
