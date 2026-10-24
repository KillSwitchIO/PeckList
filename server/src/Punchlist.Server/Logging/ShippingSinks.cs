using System.Buffers;
using System.Globalization;
using System.Net.Http.Headers;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using Punchlist.Core.Configuration;

namespace Punchlist.Server.Logging;

/// <summary>Who is sending: put on every shipped entry.</summary>
public sealed record LogSource(string Service, string Version, string Host)
{
    public static LogSource Current { get; } = new("punchlist", ServerApp.Version, Environment.MachineName);
}

/// <summary>An HTTP log server: its own client (no framework logging of its requests), 10 s per request.</summary>
public abstract class HttpSink : ILogSink
{
    private readonly HttpClient http;

    protected HttpSink(HttpMessageHandler? handler)
    {
        http = new HttpClient(handler ?? new SocketsHttpHandler { ConnectTimeout = TimeSpan.FromSeconds(5), PooledConnectionLifetime = TimeSpan.FromMinutes(5) })
        {
            Timeout = TimeSpan.FromSeconds(10),
        };
    }

    public abstract string Name { get; }
    public abstract string Destination { get; }
    public virtual int BatchSize => 500;
    public virtual TimeSpan BatchDelay => TimeSpan.FromSeconds(1);

    public abstract Task WriteAsync(IReadOnlyList<LogRecord> batch, CancellationToken cancellation);

    /// <summary>Send and return the answer's body; a refusal throws, retryable for 408, 429 and 5xx.</summary>
    protected async Task<string> SendAsync(HttpRequestMessage request, CancellationToken cancellation)
    {
        using (request)
        using (var response = await http.SendAsync(request, cancellation))
        {
            var body = await response.Content.ReadAsStringAsync(cancellation);
            if (response.IsSuccessStatusCode) return body;
            var code = (int)response.StatusCode;
            var detail = body.Length > 200 ? body[..200] : body;
            throw new LogShipException($"{code} {response.ReasonPhrase}: {detail}".TrimEnd(' ', ':'), code is 408 or 429 or >= 500);
        }
    }

    /// <summary>A URL without its user name and password, for showing.</summary>
    protected static string Shown(Uri url) => new UriBuilder(url) { UserName = "", Password = "" }.Uri.ToString();

    /// <summary>Basic credentials from settings, or from the URL's own user:password.</summary>
    protected static AuthenticationHeaderValue? Basic(Uri url, string? username, string? password)
    {
        if (username is null && url.UserInfo.Length > 0)
        {
            var parts = url.UserInfo.Split(':', 2);
            username = Uri.UnescapeDataString(parts[0]);
            password = parts.Length > 1 ? Uri.UnescapeDataString(parts[1]) : "";
        }
        return username is null ? null : new AuthenticationHeaderValue("Basic", Convert.ToBase64String(Encoding.UTF8.GetBytes($"{username}:{password}")));
    }

    protected static Uri Endpoint(Uri url, string path)
    {
        var builder = new UriBuilder(url) { UserName = "", Password = "" };
        if (!builder.Path.EndsWith(path, StringComparison.Ordinal)) builder.Path = builder.Path.TrimEnd('/') + path;
        return builder.Uri;
    }

    protected static ByteArrayContent Json(Action<Utf8JsonWriter> write, string type = "application/json")
    {
        var buffer = new ArrayBufferWriter<byte>(4096);
        using (var json = new Utf8JsonWriter(buffer, LogFormats.WriterOptions)) write(json);
        var content = new ByteArrayContent(buffer.WrittenSpan.ToArray());
        content.Headers.ContentType = new MediaTypeHeaderValue(type);
        return content;
    }

    protected static string UnixNanos(DateTimeOffset time) =>
        ((time.UtcTicks - DateTimeOffset.UnixEpoch.UtcTicks) * 100).ToString(CultureInfo.InvariantCulture);

    public virtual ValueTask DisposeAsync()
    {
        http.Dispose();
        GC.SuppressFinalize(this);
        return ValueTask.CompletedTask;
    }
}

/// <summary>
/// OpenTelemetry logs over OTLP/HTTP with JSON (<c>POST /v1/logs</c>): the Collector, Grafana
/// Alloy, SigNoz, Elastic and others take it as is.
/// </summary>
public sealed class OtlpSink(Uri endpoint, IReadOnlyDictionary<string, string> headers, LogSource source, HttpMessageHandler? handler = null)
    : HttpSink(handler)
{
    private readonly Uri url = Endpoint(endpoint, "/v1/logs");

    public override string Name => "otlp";
    public override string Destination => url.ToString();

    public override async Task WriteAsync(IReadOnlyList<LogRecord> batch, CancellationToken cancellation)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, url) { Content = Json(json => Write(json, batch)) };
        foreach (var (name, value) in headers) request.Headers.TryAddWithoutValidation(name, value);
        await SendAsync(request, cancellation);
    }

    private void Write(Utf8JsonWriter json, IReadOnlyList<LogRecord> batch)
    {
        json.WriteStartObject();
        json.WriteStartArray("resourceLogs");
        json.WriteStartObject();
        json.WriteStartObject("resource");
        json.WriteStartArray("attributes");
        Attribute(json, "service.name", source.Service);
        Attribute(json, "service.version", source.Version);
        Attribute(json, "host.name", source.Host);
        json.WriteEndArray();
        json.WriteEndObject();
        json.WriteStartArray("scopeLogs");
        foreach (var scope in batch.GroupBy(record => record.Category))
        {
            json.WriteStartObject();
            json.WriteStartObject("scope");
            json.WriteString("name", scope.Key);
            json.WriteEndObject();
            json.WriteStartArray("logRecords");
            foreach (var record in scope) Record(json, record);
            json.WriteEndArray();
            json.WriteEndObject();
        }
        json.WriteEndArray();
        json.WriteEndObject();
        json.WriteEndArray();
        json.WriteEndObject();
    }

    private static void Record(Utf8JsonWriter json, LogRecord record)
    {
        json.WriteStartObject();
        json.WriteString("timeUnixNano", UnixNanos(record.Time));
        json.WriteString("observedTimeUnixNano", UnixNanos(record.Time));
        json.WriteNumber("severityNumber", record.Level switch
        {
            LogLevel.Trace => 1,
            LogLevel.Debug => 5,
            LogLevel.Information => 9,
            LogLevel.Warning => 13,
            LogLevel.Error => 17,
            _ => 21,
        });
        json.WriteString("severityText", record.Level.ToString());
        json.WriteStartObject("body");
        json.WriteString("stringValue", record.Message);
        json.WriteEndObject();
        if (record.EventName is not null) json.WriteString("eventName", record.EventName);
        json.WriteStartArray("attributes");
        if (record.EventId != 0) Attribute(json, "event.id", record.EventId);
        if (record.Template is not null) Attribute(json, "message.template", record.Template);
        if (record.RequestId is not null) Attribute(json, "request.id", record.RequestId);
        if (record.UserId is not null) Attribute(json, "user.id", record.UserId);
        if (record.Exception is not null) Attribute(json, "exception.stacktrace", record.Exception);
        // An empty value says nothing (no impersonator, no detail): left out, as Graylog does.
        foreach (var (name, value) in record.Properties ?? []) if (value is not "") Attribute(json, name, value);
        json.WriteEndArray();
        if (record.TraceId is not null) json.WriteString("traceId", record.TraceId);
        if (record.SpanId is not null) json.WriteString("spanId", record.SpanId);
        json.WriteEndObject();
    }

    private static void Attribute(Utf8JsonWriter json, string key, object? value)
    {
        json.WriteStartObject();
        json.WriteString("key", key);
        json.WriteStartObject("value");
        switch (value)
        {
            case bool flag:
                json.WriteBoolean("boolValue", flag);
                break;
            case int or long or short or byte or uint:
                json.WriteString("intValue", Convert.ToInt64(value, CultureInfo.InvariantCulture).ToString(CultureInfo.InvariantCulture));
                break;
            case double or float or decimal when Convert.ToDouble(value, CultureInfo.InvariantCulture) is var number && double.IsFinite(number):
                json.WriteNumber("doubleValue", number);
                break;
            default:
                json.WriteString("stringValue", LogTemplate.Format(value, null));
                break;
        }
        json.WriteEndObject();
        json.WriteEndObject();
    }
}

/// <summary>
/// Grafana Loki's push API (<c>POST /loki/api/v1/push</c>). Labels stay few (service and level);
/// each line is the JSON entry, so <c>| json</c> in LogQL reaches every field.
/// </summary>
public sealed class LokiSink(Uri baseUrl, string? username, string? password, string? tenant, LogSource source, HttpMessageHandler? handler = null)
    : HttpSink(handler)
{
    private readonly Uri url = Endpoint(baseUrl, "/loki/api/v1/push");
    private readonly AuthenticationHeaderValue? auth = Basic(baseUrl, username, password);

    public override string Name => "loki";
    public override string Destination => url.ToString();

    public override async Task WriteAsync(IReadOnlyList<LogRecord> batch, CancellationToken cancellation)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, url) { Content = Json(json => Write(json, batch)) };
        request.Headers.Authorization = auth;
        if (tenant is not null) request.Headers.TryAddWithoutValidation("X-Scope-OrgID", tenant);
        await SendAsync(request, cancellation);
    }

    private void Write(Utf8JsonWriter json, IReadOnlyList<LogRecord> batch)
    {
        json.WriteStartObject();
        json.WriteStartArray("streams");
        foreach (var stream in batch.GroupBy(record => record.ShortLevel))
        {
            json.WriteStartObject();
            json.WriteStartObject("stream");
            json.WriteString("service_name", source.Service);
            json.WriteString("host", source.Host);
            json.WriteString("level", stream.Key);
            json.WriteEndObject();
            json.WriteStartArray("values");
            foreach (var record in stream.OrderBy(record => record.Time))
            {
                json.WriteStartArray();
                json.WriteStringValue(UnixNanos(record.Time));
                json.WriteStringValue(LogFormats.JsonLine(record, withTime: false));
                json.WriteEndArray();
            }
            json.WriteEndArray();
            json.WriteEndObject();
        }
        json.WriteEndArray();
        json.WriteEndObject();
    }
}

/// <summary>
/// Elasticsearch and OpenSearch through the bulk API, with ECS field names. The default index
/// <c>logs-punchlist-default</c> lands in Elasticsearch's built-in <c>logs</c> data streams.
/// </summary>
public sealed class ElasticSink(
    Uri baseUrl, string index, string? username, string? password, string? apiKey, LogSource source, HttpMessageHandler? handler = null)
    : HttpSink(handler)
{
    private readonly Uri url = Endpoint(baseUrl, "/_bulk");
    private readonly AuthenticationHeaderValue? auth = apiKey is not null ? new AuthenticationHeaderValue("ApiKey", apiKey) : Basic(baseUrl, username, password);

    public override string Name => "elastic";
    public override string Destination => $"{Shown(baseUrl)} ({index})";

    public override async Task WriteAsync(IReadOnlyList<LogRecord> batch, CancellationToken cancellation)
    {
        var buffer = new ArrayBufferWriter<byte>(8192);
        foreach (var record in batch)
        {
            using (var json = new Utf8JsonWriter(buffer, LogFormats.WriterOptions))
            {
                json.WriteStartObject();
                json.WriteStartObject("create");
                json.WriteString("_index", index);
                json.WriteEndObject();
                json.WriteEndObject();
            }
            buffer.Write("\n"u8);
            using (var json = new Utf8JsonWriter(buffer, LogFormats.WriterOptions)) Document(json, record);
            buffer.Write("\n"u8);
        }
        var content = new ByteArrayContent(buffer.WrittenSpan.ToArray());
        content.Headers.ContentType = new MediaTypeHeaderValue("application/x-ndjson");
        var request = new HttpRequestMessage(HttpMethod.Post, url) { Content = content };
        request.Headers.Authorization = auth;
        var answer = await SendAsync(request, cancellation);
        // A bulk request succeeds as a whole even when entries were refused (a mapping clash);
        // sending them again would not help.
        using var result = JsonDocument.Parse(answer);
        if (result.RootElement.TryGetProperty("errors", out var errors) && errors.ValueKind == JsonValueKind.True)
        {
            var reason = result.RootElement.GetProperty("items").EnumerateArray()
                .Select(item => item.EnumerateObject().First().Value)
                .Where(item => item.TryGetProperty("error", out _))
                .Select(item => item.GetProperty("error").TryGetProperty("reason", out var why) ? why.GetString() : item.GetProperty("error").ToString())
                .FirstOrDefault();
            throw new LogShipException($"entries refused: {reason}", retry: false);
        }
    }

    private void Document(Utf8JsonWriter json, LogRecord record)
    {
        json.WriteStartObject();
        json.WriteString("@timestamp", LogFormats.Timestamp(record.Time));
        json.WriteString("message", record.Message);
        json.WriteStartObject("log");
        json.WriteString("level", record.ShortLevel);
        json.WriteString("logger", record.Category);
        json.WriteEndObject();
        json.WriteStartObject("service");
        json.WriteString("name", source.Service);
        json.WriteString("version", source.Version);
        json.WriteEndObject();
        json.WriteStartObject("host");
        json.WriteString("hostname", source.Host);
        json.WriteEndObject();
        if (record.EventId != 0 || record.EventName is not null)
        {
            json.WriteStartObject("event");
            if (record.EventId != 0) json.WriteString("code", record.EventId.ToString(CultureInfo.InvariantCulture));
            if (record.EventName is not null) json.WriteString("action", record.EventName);
            json.WriteEndObject();
        }
        if (record.TraceId is not null)
        {
            json.WriteStartObject("trace");
            json.WriteString("id", record.TraceId);
            json.WriteEndObject();
        }
        if (record.SpanId is not null)
        {
            json.WriteStartObject("span");
            json.WriteString("id", record.SpanId);
            json.WriteEndObject();
        }
        if (record.UserId is not null)
        {
            json.WriteStartObject("user");
            json.WriteString("id", record.UserId);
            json.WriteEndObject();
        }
        if (record.RequestId is not null)
        {
            json.WriteStartObject("http");
            json.WriteStartObject("request");
            json.WriteString("id", record.RequestId);
            json.WriteEndObject();
            json.WriteEndObject();
        }
        if (record.Exception is not null)
        {
            json.WriteStartObject("error");
            json.WriteString("stack_trace", record.Exception);
            json.WriteEndObject();
        }
        if (record.Properties is { Count: > 0 } || record.Template is not null)
        {
            // ECS labels are keywords: values as text.
            json.WriteStartObject("labels");
            if (record.Template is not null) json.WriteString("template", record.Template);
            var seen = new HashSet<string>(StringComparer.Ordinal) { "template" };
            foreach (var (name, value) in record.Properties ?? [])
            {
                var key = name.Replace('.', '_');
                if (value is not "" && seen.Add(key)) json.WriteString(key, LogTemplate.Format(value, null));
            }
            json.WriteEndObject();
        }
        json.WriteEndObject();
    }
}

/// <summary>A stream or datagram connection that reconnects after a failure.</summary>
internal sealed class Wire(LogAddress address) : IAsyncDisposable
{
    private Socket? socket;

    public async Task SendAsync(ReadOnlyMemory<byte> data, CancellationToken cancellation)
    {
        try
        {
            if (socket is null)
            {
                var udp = address.Scheme == "udp";
                var next = new Socket(udp ? SocketType.Dgram : SocketType.Stream, udp ? ProtocolType.Udp : ProtocolType.Tcp);
                using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellation);
                timeout.CancelAfter(TimeSpan.FromSeconds(5));
                try
                {
                    await next.ConnectAsync(address.Host, address.Port, timeout.Token);
                }
                catch
                {
                    next.Dispose();
                    throw;
                }
                socket = next;
            }
            while (data.Length > 0)
            {
                var written = await socket.SendAsync(data, SocketFlags.None, cancellation);
                data = data[written..];
            }
        }
        catch (Exception error) when (error is SocketException or IOException or OperationCanceledException && !cancellation.IsCancellationRequested)
        {
            socket?.Dispose();
            socket = null;
            throw new LogShipException(error is OperationCanceledException ? $"no connection to {address} in 5 s" : $"{address}: {error.Message}", retry: true);
        }
    }

    public ValueTask DisposeAsync()
    {
        socket?.Dispose();
        socket = null;
        return ValueTask.CompletedTask;
    }
}

/// <summary>
/// Graylog's GELF 1.1: over UDP (chunked past 8 KB), TCP (null-terminated) or HTTP (one message
/// per request, to the GELF HTTP input).
/// </summary>
public sealed class GelfSink : ILogSink
{
    private const int ChunkSize = 8192;
    private readonly LogAddress address;
    private readonly LogSource source;
    private readonly Wire? wire;
    private readonly GelfHttp? http;

    public GelfSink(LogAddress address, LogSource source, HttpMessageHandler? handler = null)
    {
        this.address = address;
        this.source = source;
        if (address.Url is { } url) http = new GelfHttp(url, handler);
        else wire = new Wire(address);
    }

    public string Name => "gelf";
    public string Destination => address.ToString();
    public int BatchSize => 200;
    public TimeSpan BatchDelay => TimeSpan.FromMilliseconds(500);

    public async Task WriteAsync(IReadOnlyList<LogRecord> batch, CancellationToken cancellation)
    {
        foreach (var record in batch)
        {
            var message = Message(record);
            if (http is not null)
            {
                await http.PostAsync(message, cancellation);
            }
            else if (address.Scheme == "tcp")
            {
                await wire!.SendAsync(message.Append((byte)0).ToArray(), cancellation);
            }
            else if (message.Length <= ChunkSize)
            {
                await wire!.SendAsync(message, cancellation);
            }
            else
            {
                foreach (var chunk in Chunks(message)) await wire!.SendAsync(chunk, cancellation);
            }
        }
    }

    /// <summary>GELF chunking: magic bytes, an 8-byte message id, sequence number and count, then the piece.</summary>
    public static IEnumerable<byte[]> Chunks(byte[] message)
    {
        const int header = 12;
        const int piece = ChunkSize - header;
        var count = (message.Length + piece - 1) / piece;
        if (count > 128) yield break;
        var id = new byte[8];
        Random.Shared.NextBytes(id);
        for (var i = 0; i < count; i++)
        {
            var length = Math.Min(piece, message.Length - i * piece);
            var chunk = new byte[header + length];
            chunk[0] = 0x1e;
            chunk[1] = 0x0f;
            id.CopyTo(chunk, 2);
            chunk[10] = (byte)i;
            chunk[11] = (byte)count;
            Array.Copy(message, i * piece, chunk, header, length);
            yield return chunk;
        }
    }

    public byte[] Message(LogRecord record)
    {
        var buffer = new ArrayBufferWriter<byte>(512);
        using (var json = new Utf8JsonWriter(buffer, LogFormats.WriterOptions))
        {
            json.WriteStartObject();
            json.WriteString("version", "1.1");
            json.WriteString("host", source.Host);
            json.WriteString("short_message", record.Message.Length > 0 ? record.Message : "-");
            if (record.Exception is not null) json.WriteString("full_message", record.Message + "\n" + record.Exception);
            json.WriteNumber("timestamp", Math.Round((record.Time.UtcTicks - DateTimeOffset.UnixEpoch.UtcTicks) / (double)TimeSpan.TicksPerSecond, 3));
            json.WriteNumber("level", record.SyslogSeverity);
            json.WriteString("_service", source.Service);
            json.WriteString("_version", source.Version);
            json.WriteString("_category", record.Category);
            json.WriteString("_level_name", record.ShortLevel);
            if (record.EventId != 0) json.WriteNumber("_event_id", record.EventId);
            if (record.EventName is not null) json.WriteString("_event_name", record.EventName);
            if (record.Template is not null) json.WriteString("_template", record.Template);
            if (record.RequestId is not null) json.WriteString("_request_id", record.RequestId);
            if (record.TraceId is not null) json.WriteString("_trace_id", record.TraceId);
            if (record.SpanId is not null) json.WriteString("_span_id", record.SpanId);
            if (record.UserId is not null) json.WriteString("_user_id", record.UserId);
            var seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (var (name, value) in record.Properties ?? [])
            {
                // GELF field names: letters, digits, underscores, dashes and dots; "_id" is reserved.
                var key = "_prop_" + new string([.. name.Select(c => char.IsAsciiLetterOrDigit(c) || c is '_' or '-' or '.' ? c : '_')]);
                if (seen.Add(key)) LogFormats.Value(json, key, value);
            }
            json.WriteEndObject();
        }
        return buffer.WrittenSpan.ToArray();
    }

    public async ValueTask DisposeAsync()
    {
        if (wire is not null) await wire.DisposeAsync();
        if (http is not null) await http.DisposeAsync();
    }

    private sealed class GelfHttp(Uri url, HttpMessageHandler? handler) : HttpSink(handler)
    {
        private readonly Uri target = url.AbsolutePath is "" or "/" ? Endpoint(url, "/gelf") : url;

        public override string Name => "gelf";
        public override string Destination => target.ToString();

        public Task PostAsync(byte[] message, CancellationToken cancellation)
        {
            var content = new ByteArrayContent(message);
            content.Headers.ContentType = new MediaTypeHeaderValue("application/json");
            return SendAsync(new HttpRequestMessage(HttpMethod.Post, target) { Content = content }, cancellation);
        }

        public override Task WriteAsync(IReadOnlyList<LogRecord> batch, CancellationToken cancellation) => Task.CompletedTask;
    }
}

/// <summary>
/// Syslog in RFC 5424 form, facility local0, over UDP (one entry per datagram, cut at 8 KB) or TCP
/// (octet counting, RFC 6587). The standard fields go in structured data.
/// </summary>
public sealed class SyslogSink(LogAddress address, LogSource source) : ILogSink
{
    private const int Facility = 16;
    private const int UdpLimit = 8192;
    private readonly Wire wire = new(address);

    public string Name => "syslog";
    public string Destination => address.ToString();
    public int BatchSize => 200;
    public TimeSpan BatchDelay => TimeSpan.FromMilliseconds(500);

    public async Task WriteAsync(IReadOnlyList<LogRecord> batch, CancellationToken cancellation)
    {
        foreach (var record in batch)
        {
            var line = Encoding.UTF8.GetBytes(Line(record));
            if (address.Scheme == "tcp")
            {
                await wire.SendAsync(Encoding.ASCII.GetBytes(line.Length.ToString(CultureInfo.InvariantCulture) + " ").Concat(line).ToArray(), cancellation);
            }
            else
            {
                await wire.SendAsync(line.Length > UdpLimit ? line.AsMemory(0, UdpLimit) : line, cancellation);
            }
        }
    }

    public string Line(LogRecord record)
    {
        var line = new StringBuilder(256);
        line.Append('<').Append((Facility * 8 + record.SyslogSeverity).ToString(CultureInfo.InvariantCulture)).Append(">1 ")
            .Append(LogFormats.Timestamp(record.Time)).Append(' ')
            .Append(Token(source.Host, 255)).Append(' ')
            .Append(Token(source.Service, 48)).Append(' ')
            .Append(Environment.ProcessId.ToString(CultureInfo.InvariantCulture)).Append(' ')
            .Append(record.EventName is { } name ? Token(name, 32) : "-").Append(' ');
        // 32473 is the enterprise number RFC 5612 sets aside for examples and private use.
        line.Append("[punchlist@32473");
        Param(line, "category", record.Category);
        Param(line, "level", record.ShortLevel);
        if (record.EventId != 0) Param(line, "eventId", record.EventId.ToString(CultureInfo.InvariantCulture));
        if (record.RequestId is not null) Param(line, "requestId", record.RequestId);
        if (record.TraceId is not null) Param(line, "traceId", record.TraceId);
        if (record.UserId is not null) Param(line, "userId", record.UserId);
        line.Append("] ").Append(record.Message);
        if (record.Exception is not null) line.Append('\n').Append(record.Exception);
        return line.ToString();
    }

    private static void Param(StringBuilder line, string name, string value) =>
        line.Append(' ').Append(name).Append("=\"").Append(value.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("]", "\\]")).Append('"');

    /// <summary>Header fields: printable ASCII, no spaces.</summary>
    private static string Token(string value, int max)
    {
        var token = new string([.. value.Where(c => c > ' ' && c < 127).Take(max)]);
        return token.Length == 0 ? "-" : token;
    }

    public ValueTask DisposeAsync() => wire.DisposeAsync();
}
