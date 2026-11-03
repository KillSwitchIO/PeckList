using System.Globalization;

namespace PeckList.Core.Configuration;

public enum LogFormat
{
    /// <summary>Readable lines (the console's default).</summary>
    Text,

    /// <summary>One JSON object per line.</summary>
    Json,
}

/// <summary>Where a GELF or syslog target listens: <c>udp://host:port</c>, <c>tcp://host:port</c> or (GELF) an http(s) URL.</summary>
public sealed record LogAddress(string Scheme, string Host, int Port, Uri? Url = null)
{
    public override string ToString() => Url?.ToString() ?? $"{Scheme}://{Host}:{Port}";
}

/// <summary>
/// Logging (spec: Accounts &amp; Admin, Logging): levels, console format, local files and the
/// shipping targets. Everything here applies while the server runs, except <see cref="Dir"/>.
/// </summary>
public sealed record LoggingSettings
{
    public LogLevelSetting Level { get; init; } = LogLevelSetting.Information;

    /// <summary>Per category (and the categories under it): <c>LOG_LEVEL_OVERRIDES=Microsoft.AspNetCore=Warning,PeckList.Sync=Debug</c>.</summary>
    public IReadOnlyDictionary<string, LogLevelSetting> Overrides { get; init; } = new Dictionary<string, LogLevelSetting>();

    public LogFormat Format { get; init; } = LogFormat.Text;

    /// <summary>Whether logs are also written to files in <see cref="Dir"/>.</summary>
    public bool Files { get; init; } = true;

    /// <summary><c>logs</c> next to the SQLite file (<c>/data/logs</c> in the image).</summary>
    public string Dir { get; init; } = "/data/logs";

    /// <summary>A file rolls at midnight UTC or when it reaches this size.</summary>
    public int FileMaxMegabytes { get; init; } = 50;

    /// <summary>Rolled files are gzipped, and deleted after this many days.</summary>
    public int FileKeepDays { get; init; } = 14;

    public Uri? OtlpEndpoint { get; init; }

    /// <summary>Headers sent to the OTLP endpoint (<c>Authorization=Basic ...</c>), like <c>OTEL_EXPORTER_OTLP_HEADERS</c>.</summary>
    public IReadOnlyDictionary<string, string> OtlpHeaders { get; init; } = new Dictionary<string, string>();

    public Uri? LokiUrl { get; init; }
    public string? LokiUsername { get; init; }
    public string? LokiPassword { get; init; }

    /// <summary>Sent as <c>X-Scope-OrgID</c> for multi-tenant Loki.</summary>
    public string? LokiTenant { get; init; }

    public LogAddress? Gelf { get; init; }

    public Uri? ElasticUrl { get; init; }
    public string? ElasticUsername { get; init; }
    public string? ElasticPassword { get; init; }
    public string? ElasticApiKey { get; init; }

    /// <summary>The index or data stream written to.</summary>
    public string ElasticIndex { get; init; } = "logs-pecklist-default";

    public LogAddress? Syslog { get; init; }

    /// <summary>Read the <c>LOG_*</c> settings; problems go into <paramref name="errors"/>.</summary>
    public static LoggingSettings Read(Func<string, string?> get, string defaultDir, List<string> errors)
    {
        LogLevelSetting Level(string name, string raw)
        {
            if (Enum.TryParse<LogLevelSetting>(raw.Trim(), ignoreCase: true, out var level) && !int.TryParse(raw, out _)) return level;
            errors.Add($"{name}: '{raw}' is not one of {string.Join(", ", Enum.GetNames<LogLevelSetting>().Select(each => each.ToLowerInvariant()))}");
            return LogLevelSetting.Information;
        }
        int Count(string name, int fallback, int min)
        {
            var raw = get(name);
            if (raw is null) return fallback;
            if (int.TryParse(raw, NumberStyles.None, CultureInfo.InvariantCulture, out var value) && value >= min) return value;
            errors.Add($"{name}: '{raw}' is not a whole number of at least {min}");
            return fallback;
        }
        Uri? Url(string name)
        {
            var raw = get(name);
            if (raw is null) return null;
            if (Uri.TryCreate(raw.Trim(), UriKind.Absolute, out var url) && (url.Scheme == Uri.UriSchemeHttp || url.Scheme == Uri.UriSchemeHttps)) return url;
            errors.Add($"{name}: '{raw}' is not an http or https address");
            return null;
        }
        LogAddress? Address(string name, int defaultPort, bool http)
        {
            var raw = get(name);
            if (raw is null) return null;
            if (Uri.TryCreate(raw.Trim(), UriKind.Absolute, out var url) && url.Host.Length > 0)
            {
                var scheme = url.Scheme.ToLowerInvariant();
                if (scheme is "udp" or "tcp") return new LogAddress(scheme, url.Host, url.IsDefaultPort || url.Port < 0 ? defaultPort : url.Port);
                if (http && scheme is "http" or "https") return new LogAddress(scheme, url.Host, url.Port, url);
            }
            errors.Add($"{name}: '{raw}' is not {(http ? "udp://, tcp:// or an http(s) address" : "udp://host:port or tcp://host:port")}");
            return null;
        }

        var overrides = new Dictionary<string, LogLevelSetting>(StringComparer.Ordinal);
        foreach (var entry in Split(get("LOG_LEVEL_OVERRIDES")))
        {
            var parts = entry.Split('=', 2, StringSplitOptions.TrimEntries);
            if (parts.Length != 2 || parts[0].Length == 0)
            {
                errors.Add($"LOG_LEVEL_OVERRIDES: '{entry}' is not category=level");
                continue;
            }
            overrides[Renamed(parts[0])] = Level("LOG_LEVEL_OVERRIDES", parts[1]);
        }

        // The code was Punchlist.* before the rename (PL-127): an override saved then still applies.
        static string Renamed(string category) =>
            category == "Punchlist" || category.StartsWith("Punchlist.", StringComparison.Ordinal)
                ? "PeckList" + category["Punchlist".Length..]
                : category;

        var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var entry in Split(get("LOG_OTLP_HEADERS")))
        {
            var parts = entry.Split('=', 2, StringSplitOptions.TrimEntries);
            if (parts.Length != 2 || parts[0].Length == 0) errors.Add("LOG_OTLP_HEADERS: an entry is not name=value");
            else headers[parts[0]] = Uri.UnescapeDataString(parts[1]);
        }

        string? format = get("LOG_FORMAT")?.Trim().ToLowerInvariant();
        if (format is not (null or "text" or "json")) errors.Add($"LOG_FORMAT: '{format}' is not one of text, json");

        string? files = get("LOG_FILES")?.Trim().ToLowerInvariant();
        if (files is not (null or "true" or "1" or "yes" or "on" or "false" or "0" or "no" or "off")) errors.Add($"LOG_FILES: '{files}' is not true or false");

        var index = get("LOG_ELASTIC_INDEX")?.Trim();
        if (index is not null && (index.Length == 0 || index != index.ToLowerInvariant() || index.IndexOfAny([' ', ',', '/', '\\', '*', '?', '"', '<', '>', '|', '#']) >= 0))
        {
            errors.Add($"LOG_ELASTIC_INDEX: '{index}' is not a valid index name (lowercase, no spaces or ,/\\*?\"<>|#)");
            index = null;
        }

        return new LoggingSettings
        {
            Level = get("LOG_LEVEL") is { } level ? Level("LOG_LEVEL", level) : LogLevelSetting.Information,
            Overrides = overrides,
            Format = format == "json" ? LogFormat.Json : LogFormat.Text,
            Files = files is null or "true" or "1" or "yes" or "on",
            Dir = get("LOG_DIR") ?? defaultDir,
            FileMaxMegabytes = Count("LOG_FILE_MAX_MB", 50, 1),
            FileKeepDays = Count("LOG_FILE_KEEP_DAYS", 14, 1),
            OtlpEndpoint = Url("LOG_OTLP_ENDPOINT"),
            OtlpHeaders = headers,
            LokiUrl = Url("LOG_LOKI_URL"),
            LokiUsername = get("LOG_LOKI_USERNAME"),
            LokiPassword = get("LOG_LOKI_PASSWORD"),
            LokiTenant = get("LOG_LOKI_TENANT"),
            Gelf = Address("LOG_GELF_ADDRESS", 12201, http: true),
            ElasticUrl = Url("LOG_ELASTIC_URL"),
            ElasticUsername = get("LOG_ELASTIC_USERNAME"),
            ElasticPassword = get("LOG_ELASTIC_PASSWORD"),
            ElasticApiKey = get("LOG_ELASTIC_API_KEY"),
            ElasticIndex = index ?? "logs-pecklist-default",
            Syslog = Address("LOG_SYSLOG_ADDRESS", 514, http: false),
        };
    }

    private static IEnumerable<string> Split(string? raw) =>
        (raw ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
}
