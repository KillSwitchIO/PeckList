using System.Text.RegularExpressions;

namespace PeckList.Core.Telemetry;

/// <summary>
/// A crash report (PL-116, ADR-0018): sent only when the person says so (or chose "always"), and
/// shown to them in full first. It holds where the app broke, never what they wrote: the error's
/// kind, a fingerprint, the stack with addresses taken out, and the last warnings in the server's
/// log (already redacted, and scrubbed again here).
/// </summary>
public sealed record CrashReport
{
    public const int CurrentSchema = 1;
    public const int MaxStack = 8 * 1024;
    public const int MaxLogLines = 50;
    public const int MaxLogLine = 500;

    public int Schema { get; init; } = CurrentSchema;

    /// <summary>The server's random install id, so reports from one install group together.</summary>
    public string? InstallId { get; init; }

    /// <summary><c>web</c>, <c>android</c> or <c>server</c>.</summary>
    public required string Source { get; init; }

    public required string Version { get; init; }

    public required string Channel { get; init; }

    /// <summary>The device's kind, as in the usage counts (<c>browser:firefox</c>, ...).</summary>
    public IReadOnlyList<string> Device { get; init; } = [];

    /// <summary>The error's type name (<c>TypeError</c>, <c>NullReferenceException</c>).</summary>
    public required string Kind { get; init; }

    /// <summary>Eight hex digits: the same bug, the same fingerprint.</summary>
    public required string Fingerprint { get; init; }

    public required string Stack { get; init; }

    public IReadOnlyList<string> Logs { get; init; } = [];
}

public static partial class CrashReports
{
    public static readonly IReadOnlySet<string> Sources = new HashSet<string>(StringComparer.Ordinal) { "web", "android", "server" };

    // An address with a scheme: keep the path, drop who it was.
    [GeneratedRegex(@"\b[a-z][a-z0-9+.-]*://[^/\s)""']+", RegexOptions.IgnoreCase)]
    private static partial Regex Origin();

    // A query string or fragment after a path.
    [GeneratedRegex(@"[?#][^\s)""':]*")]
    private static partial Regex Query();

    // Emails, and long hex or base64-ish runs (tokens, ids).
    [GeneratedRegex(@"[\w.+-]+@[\w-]+(\.[\w-]+)+")]
    private static partial Regex Email();

    [GeneratedRegex(@"\b[A-Za-z0-9_-]{24,}\b")]
    private static partial Regex LongToken();

    [GeneratedRegex(@"^[A-Za-z_$][\w.$]{0,79}$")]
    private static partial Regex KindText();

    /// <summary>Text with addresses, queries, emails and long tokens taken out.</summary>
    public static string Scrub(string text)
    {
        text = Origin().Replace(text, "");
        text = Query().Replace(text, "");
        text = Email().Replace(text, "[email]");
        return LongToken().Replace(text, "[id]");
    }

    /// <summary>The report cut to size and scrubbed once more, whoever made it.</summary>
    public static CrashReport Clean(CrashReport report)
    {
        var stack = Scrub(report.Stack ?? "");
        return report with
        {
            Stack = SafeText.Cut(stack, CrashReport.MaxStack),
            Logs = [.. (report.Logs ?? []).TakeLast(CrashReport.MaxLogLines).Select(line => SafeText.Cut(Scrub(line), CrashReport.MaxLogLine))],
            Device = [.. (report.Device ?? []).Where(ClientUsage.KnownKind)],
        };
    }

    /// <summary>Why a report cannot be taken, or null when it can.</summary>
    public static string? Problem(CrashReport report)
    {
        if (report.Schema is < 1 or > 100) return "schema";
        if (report.InstallId is { } id && !Guid.TryParse(id, out _)) return "installId";
        if (!Sources.Contains(report.Source)) return "source";
        if (report.Version is not { Length: > 0 and <= 64 }) return "version";
        if (!TelemetryBuckets.Channels.Contains(report.Channel)) return "channel";
        if (report.Kind is null || !KindText().IsMatch(report.Kind)) return "kind";
        if (report.Fingerprint is null || !ClientUsage.Fingerprint().IsMatch(report.Fingerprint)) return "fingerprint";
        if (report.Stack is null || report.Stack.Length > CrashReport.MaxStack) return "stack";
        if (report.Logs is null || report.Logs.Count > CrashReport.MaxLogLines || report.Logs.Any(line => line.Length > CrashReport.MaxLogLine)) return "logs";
        return null;
    }
}
