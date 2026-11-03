using System.Buffers;
using System.Globalization;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;

namespace PeckList.Server.Logging;

/// <summary>The two line formats: readable text for people, JSON for machines (files, Loki, <c>LOG_FORMAT=json</c>).</summary>
public static class LogFormats
{
    public static readonly JsonWriterOptions WriterOptions = new() { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping };

    public static string Timestamp(DateTimeOffset time) =>
        time.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);

    /// <summary><c>2026-10-22T07:49:01.123Z info  PeckList.Backups: ben took a backup (request 0HN..., user 3f2...)</c></summary>
    public static string Text(LogRecord record)
    {
        var line = new StringBuilder(128);
        line.Append(Timestamp(record.Time)).Append(' ').Append(record.ShortLevel.PadRight(5)).Append(' ')
            .Append(record.Category).Append(": ").Append(record.Message);
        if (record.RequestId is not null || record.UserId is not null)
        {
            line.Append(" (");
            if (record.RequestId is not null) line.Append("request ").Append(record.RequestId);
            if (record.RequestId is not null && record.UserId is not null) line.Append(", ");
            if (record.UserId is not null) line.Append("user ").Append(record.UserId);
            line.Append(')');
        }
        if (record.Exception is not null)
        {
            foreach (var each in record.Exception.Split('\n')) line.Append("\n    ").Append(each.TrimEnd('\r'));
        }
        return line.ToString();
    }

    /// <summary>One JSON object: the standard fields, then the message's named values under <c>props</c>.</summary>
    public static void Json(Utf8JsonWriter json, LogRecord record, bool withTime = true)
    {
        json.WriteStartObject();
        if (withTime) json.WriteString("time", Timestamp(record.Time));
        json.WriteString("level", record.ShortLevel);
        json.WriteString("category", record.Category);
        json.WriteString("message", record.Message);
        if (record.Template is not null) json.WriteString("template", record.Template);
        if (record.EventId != 0) json.WriteNumber("eventId", record.EventId);
        if (record.EventName is not null) json.WriteString("eventName", record.EventName);
        if (record.RequestId is not null) json.WriteString("requestId", record.RequestId);
        if (record.TraceId is not null) json.WriteString("traceId", record.TraceId);
        if (record.SpanId is not null) json.WriteString("spanId", record.SpanId);
        if (record.UserId is not null) json.WriteString("userId", record.UserId);
        if (record.Exception is not null) json.WriteString("exception", record.Exception);
        if (record.Properties is { Count: > 0 } properties)
        {
            json.WriteStartObject("props");
            var seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (var (name, value) in properties)
            {
                if (seen.Add(name)) Value(json, name, value);
            }
            json.WriteEndObject();
        }
        json.WriteEndObject();
    }

    public static string JsonLine(LogRecord record, bool withTime = true)
    {
        var buffer = new ArrayBufferWriter<byte>(256);
        using (var json = new Utf8JsonWriter(buffer, WriterOptions)) Json(json, record, withTime);
        return Encoding.UTF8.GetString(buffer.WrittenSpan);
    }

    /// <summary>A named value as its JSON type where it has one.</summary>
    public static void Value(Utf8JsonWriter json, string name, object? value)
    {
        switch (value)
        {
            case null:
                json.WriteNull(name);
                break;
            case bool flag:
                json.WriteBoolean(name, flag);
                break;
            case int or long or short or byte or uint:
                json.WriteNumber(name, Convert.ToInt64(value, CultureInfo.InvariantCulture));
                break;
            case double or float or decimal when Convert.ToDouble(value, CultureInfo.InvariantCulture) is var number && double.IsFinite(number):
                json.WriteNumber(name, number);
                break;
            default:
                json.WriteString(name, LogTemplate.Format(value, null));
                break;
        }
    }
}
