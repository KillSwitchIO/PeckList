using System.Collections.Concurrent;

namespace PeckList.Server.Logging;

/// <summary>
/// Which levels are written, globally and per category (a category and those under it, the longest
/// match winning), changeable while the server runs. Framework noise starts quieter, like
/// ASP.NET's own defaults, unless an override says otherwise.
/// </summary>
public sealed class LogLevels
{
    /// <summary>Framework categories that log every request at Information.</summary>
    public static readonly IReadOnlyDictionary<string, LogLevel> Defaults = new Dictionary<string, LogLevel>
    {
        ["Microsoft.AspNetCore"] = LogLevel.Warning,
        ["System.Net.Http.HttpClient"] = LogLevel.Warning,
        // Cookie keys sit in the database next to the data they protect; ASP.NET warns that they
        // are not encrypted at rest on every start, which only alarms self-hosters.
        ["Microsoft.AspNetCore.DataProtection.KeyManagement.XmlKeyManager"] = LogLevel.Error,
    };

    private readonly ConcurrentDictionary<string, LogLevel> byCategory = new(StringComparer.Ordinal);
    private (LogLevel Global, KeyValuePair<string, LogLevel>[] Overrides) current = (LogLevel.Information, []);

    /// <summary>Bumped on each change, so loggers can cache their level.</summary>
    public int Version { get; private set; }

    public LogLevel Global => current.Global;

    public LogLevels(LogLevel global = LogLevel.Information, IReadOnlyDictionary<string, LogLevel>? overrides = null) =>
        Set(global, overrides ?? new Dictionary<string, LogLevel>());

    public void Set(LogLevel global, IReadOnlyDictionary<string, LogLevel> overrides)
    {
        var merged = new Dictionary<string, LogLevel>(Defaults, StringComparer.Ordinal);
        foreach (var (category, level) in overrides) merged[category] = level;
        current = (global, [.. merged.OrderByDescending(pair => pair.Key.Length)]);
        byCategory.Clear();
        Version++;
    }

    /// <summary>The least important level written for a category.</summary>
    public LogLevel For(string category) => byCategory.GetOrAdd(category, Resolve);

    private LogLevel Resolve(string category)
    {
        var (global, overrides) = current;
        foreach (var (prefix, level) in overrides)
        {
            if (category.StartsWith(prefix, StringComparison.Ordinal)
                && (category.Length == prefix.Length || category[prefix.Length] == '.'))
            {
                return level;
            }
        }
        return global;
    }
}
