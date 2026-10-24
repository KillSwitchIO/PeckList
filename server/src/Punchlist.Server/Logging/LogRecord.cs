namespace Punchlist.Server.Logging;

/// <summary>
/// One log entry in the shape every output shares (spec: Logging): UTC time, level, category,
/// message, event id, request id, trace id and the user when there is one, plus the message's
/// named values. Already redacted: nothing here may hold a secret.
/// </summary>
public sealed record LogRecord(
    DateTimeOffset Time,
    LogLevel Level,
    string Category,
    string Message,
    int EventId = 0,
    string? EventName = null,
    string? Template = null,
    string? Exception = null,
    string? RequestId = null,
    string? TraceId = null,
    string? SpanId = null,
    string? UserId = null,
    IReadOnlyList<KeyValuePair<string, object?>>? Properties = null)
{
    /// <summary>The short level names the text format and Loki use.</summary>
    public string ShortLevel => Level switch
    {
        LogLevel.Trace => "trace",
        LogLevel.Debug => "debug",
        LogLevel.Information => "info",
        LogLevel.Warning => "warn",
        LogLevel.Error => "error",
        _ => "critical",
    };

    /// <summary>Syslog severity, which GELF uses too: critical 2, error 3, warning 4, info 6, debug 7.</summary>
    public int SyslogSeverity => Level switch
    {
        LogLevel.Critical => 2,
        LogLevel.Error => 3,
        LogLevel.Warning => 4,
        LogLevel.Information => 6,
        _ => 7,
    };
}
