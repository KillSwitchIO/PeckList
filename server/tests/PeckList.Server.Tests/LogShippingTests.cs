using System.IO.Compression;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Logging;
using PeckList.Core.Configuration;
using PeckList.Server.Logging;

namespace PeckList.Server.Tests;

/// <summary>Takes what an HTTP log server would, and answers as told.</summary>
internal sealed class FakeReceiver(HttpStatusCode status = HttpStatusCode.OK, string answer = "{}") : HttpMessageHandler
{
    public List<(HttpRequestMessage Request, string Body)> Received { get; } = [];
    public HttpStatusCode Status { get; set; } = status;

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var body = request.Content is null ? "" : await request.Content.ReadAsStringAsync(cancellationToken);
        lock (Received) Received.Add((request, body));
        return new HttpResponseMessage(Status) { Content = new StringContent(answer) };
    }
}

/// <summary>A log server that never answers.</summary>
internal sealed class SilentReceiver : HttpMessageHandler
{
    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        await Task.Delay(Timeout.Infinite, cancellationToken);
        throw new InvalidOperationException();
    }
}

internal sealed class ManualTime(DateTimeOffset now) : TimeProvider
{
    public DateTimeOffset Now { get; set; } = now;
    public override DateTimeOffset GetUtcNow() => Now;
}

/// <summary>
/// Each log output against a fake of what it talks to (spec: Logging): the shape every server
/// expects, credentials where they go, and failures that never hold the server up.
/// </summary>
public sealed class LogShippingTests
{
    private static CancellationToken Token => TestContext.Current.CancellationToken;

    private static readonly LogSource Source = new("punchlist", "1.2.3", "box");

    private static LogRecord Entry(string message = "Ben took a backup: b1", LogLevel level = LogLevel.Information, DateTimeOffset? time = null) => new(
        time ?? new DateTimeOffset(2026, 10, 22, 7, 49, 1, 123, TimeSpan.Zero),
        level,
        "PeckList.Backups",
        message,
        EventId: 12,
        EventName: "BackupTaken",
        Template: "{Admin} took a backup: {Name}",
        RequestId: "0HN1",
        TraceId: "4bf92f3577b34da6a3ce929d0e0e4736",
        SpanId: "00f067aa0ba902b7",
        UserId: "u-1",
        Properties: [new("Admin", "Ben"), new("Name", "b1"), new("Count", 3), new("Detail", "")]);

    [Fact]
    public async Task Otlp_posts_resource_logs_as_json_with_the_headers()
    {
        var receiver = new FakeReceiver();
        await using var sink = new OtlpSink(new Uri("http://alloy:4318"), new Dictionary<string, string> { ["Authorization"] = "Basic abc" }, Source, receiver);
        await sink.WriteAsync([Entry(), Entry("Second", LogLevel.Error)], Token);

        var (request, body) = Assert.Single(receiver.Received);
        Assert.Equal("http://alloy:4318/v1/logs", request.RequestUri!.ToString());
        Assert.Equal("Basic abc", request.Headers.GetValues("Authorization").Single());
        var resource = JsonNode.Parse(body)!["resourceLogs"]![0]!;
        Assert.Contains(resource["resource"]!["attributes"]!.AsArray(), a => (string?)a!["key"] == "service.name" && (string?)a["value"]!["stringValue"] == "punchlist");
        var scope = resource["scopeLogs"]![0]!;
        Assert.Equal("PeckList.Backups", (string?)scope["scope"]!["name"]);
        var first = scope["logRecords"]![0]!;
        Assert.Equal("1792655341123000000", (string?)first["timeUnixNano"]);
        Assert.Equal(9, (int)first["severityNumber"]!);
        Assert.Equal("Ben took a backup: b1", (string?)first["body"]!["stringValue"]);
        Assert.Equal("4bf92f3577b34da6a3ce929d0e0e4736", (string?)first["traceId"]);
        Assert.Contains(first["attributes"]!.AsArray(), a => (string?)a!["key"] == "Count" && (string?)a["value"]!["intValue"] == "3");
        Assert.DoesNotContain(first["attributes"]!.AsArray(), a => (string?)a!["key"] == "Detail");
        Assert.Equal(17, (int)scope["logRecords"]![1]!["severityNumber"]!);
    }

    [Fact]
    public async Task Loki_pushes_streams_by_level_with_json_lines_and_credentials()
    {
        var receiver = new FakeReceiver(HttpStatusCode.NoContent, "");
        await using var sink = new LokiSink(new Uri("https://loki.home"), "pl", "hunter22", "tenant-a", Source, receiver);
        await sink.WriteAsync([Entry(), Entry("Oops", LogLevel.Warning)], Token);

        var (request, body) = Assert.Single(receiver.Received);
        Assert.Equal("https://loki.home/loki/api/v1/push", request.RequestUri!.ToString());
        Assert.Equal("Basic " + Convert.ToBase64String("pl:hunter22"u8.ToArray()), request.Headers.Authorization!.ToString());
        Assert.Equal("tenant-a", request.Headers.GetValues("X-Scope-OrgID").Single());
        var streams = JsonNode.Parse(body)!["streams"]!.AsArray();
        Assert.Equal(["info", "warn"], streams.Select(s => (string)s!["stream"]!["level"]!).Order());
        var info = streams.Single(s => (string?)s!["stream"]!["level"] == "info")!;
        Assert.Equal("punchlist", (string?)info["stream"]!["service_name"]);
        var value = info["values"]![0]!;
        Assert.Equal("1792655341123000000", (string?)value[0]);
        var line = JsonNode.Parse((string)value[1]!)!;
        Assert.Equal(("Ben took a backup: b1", "PeckList.Backups", "u-1"), ((string?)line["message"], (string?)line["category"], (string?)line["userId"]));
        Assert.Equal("Ben", (string?)line["props"]!["Admin"]);
    }

    [Fact]
    public async Task Elastic_bulk_creates_ecs_documents_and_reports_refused_entries()
    {
        var receiver = new FakeReceiver(answer: """{"errors":false,"items":[{"create":{"status":201}}]}""");
        await using var sink = new ElasticSink(new Uri("https://es:9200"), "logs-punchlist-default", null, null, "a2V5", Source, receiver);
        await sink.WriteAsync([Entry()], Token);

        var (request, body) = Assert.Single(receiver.Received);
        Assert.Equal("https://es:9200/_bulk", request.RequestUri!.ToString());
        Assert.Equal("ApiKey a2V5", request.Headers.Authorization!.ToString());
        Assert.Equal("application/x-ndjson", request.Content!.Headers.ContentType!.MediaType);
        var lines = body.Split('\n', StringSplitOptions.RemoveEmptyEntries);
        Assert.Equal("logs-punchlist-default", (string?)JsonNode.Parse(lines[0])!["create"]!["_index"]);
        var doc = JsonNode.Parse(lines[1])!;
        Assert.Equal("2026-10-22T07:49:01.123Z", (string?)doc["@timestamp"]);
        Assert.Equal(("info", "PeckList.Backups"), ((string?)doc["log"]!["level"], (string?)doc["log"]!["logger"]));
        Assert.Equal(("u-1", "4bf92f3577b34da6a3ce929d0e0e4736"), ((string?)doc["user"]!["id"], (string?)doc["trace"]!["id"]));
        Assert.Equal("3", (string?)doc["labels"]!["Count"]);
        Assert.Null(doc["labels"]!["Detail"]);

        var refusing = new FakeReceiver(answer: """{"errors":true,"items":[{"create":{"status":400,"error":{"type":"mapper_parsing_exception","reason":"bad field"}}}]}""");
        await using var refused = new ElasticSink(new Uri("https://es:9200"), "logs", null, null, null, Source, refusing);
        var error = await Assert.ThrowsAsync<LogShipException>(() => refused.WriteAsync([Entry()], Token));
        Assert.False(error.Retry);
        Assert.Contains("bad field", error.Message);
    }

    [Fact]
    public async Task Gelf_over_udp_sends_one_datagram_per_entry_and_chunks_big_ones()
    {
        using var listener = new UdpClient(new IPEndPoint(IPAddress.Loopback, 0));
        var port = ((IPEndPoint)listener.Client.LocalEndPoint!).Port;
        await using var sink = new GelfSink(new LogAddress("udp", "127.0.0.1", port), Source);
        await sink.WriteAsync([Entry()], Token);

        var datagram = await listener.ReceiveAsync(Token);
        var message = JsonNode.Parse(datagram.Buffer)!;
        Assert.Equal(("1.1", "box", "Ben took a backup: b1", 6), ((string?)message["version"], (string?)message["host"], (string?)message["short_message"], (int)message["level"]!));
        Assert.Equal(1792655341.123, (double)message["timestamp"]!, 3);
        Assert.Equal(("PeckList.Backups", "u-1", "Ben"), ((string?)message["_category"], (string?)message["_user_id"], (string?)message["_prop_Admin"]));

        var big = Entry(new string('x', 20_000));
        await sink.WriteAsync([big], Token);
        var pieces = new List<byte[]>();
        for (var i = 0; i < 3; i++) pieces.Add((await listener.ReceiveAsync(Token)).Buffer);
        Assert.All(pieces, piece => Assert.Equal((0x1e, 0x0f, 3), (piece[0], piece[1], (int)piece[11])));
        var whole = pieces.OrderBy(piece => piece[10]).SelectMany(piece => piece.Skip(12)).ToArray();
        Assert.Equal(big.Message, (string?)JsonNode.Parse(whole)!["short_message"]);
    }

    [Fact]
    public async Task Gelf_over_tcp_ends_each_message_with_a_null_byte()
    {
        using var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var port = ((IPEndPoint)listener.LocalEndpoint).Port;
        await using var sink = new GelfSink(new LogAddress("tcp", "127.0.0.1", port), Source);
        var accept = listener.AcceptTcpClientAsync(Token).AsTask();
        await sink.WriteAsync([Entry("one"), Entry("two")], Token);
        using var client = await accept;
        var messages = await ReadUntil(client.GetStream(), bytes => bytes.Count(b => b == 0) >= 2);
        Assert.Equal(["one", "two"], Encoding.UTF8.GetString(messages).Split('\0', StringSplitOptions.RemoveEmptyEntries).Select(m => (string)JsonNode.Parse(m)!["short_message"]!));
    }

    [Fact]
    public async Task Gelf_over_http_posts_to_the_gelf_input()
    {
        var receiver = new FakeReceiver(HttpStatusCode.Accepted);
        await using var sink = new GelfSink(new LogAddress("http", "graylog", 12201, new Uri("http://graylog:12201")), Source, receiver);
        await sink.WriteAsync([Entry()], Token);
        var (request, body) = Assert.Single(receiver.Received);
        Assert.Equal("http://graylog:12201/gelf", request.RequestUri!.ToString());
        Assert.Equal("1.1", (string?)JsonNode.Parse(body)!["version"]);
    }

    [Fact]
    public async Task Syslog_writes_rfc5424_over_udp_and_octet_counted_over_tcp()
    {
        using var udp = new UdpClient(new IPEndPoint(IPAddress.Loopback, 0));
        await using (var sink = new SyslogSink(new LogAddress("udp", "127.0.0.1", ((IPEndPoint)udp.Client.LocalEndPoint!).Port), Source))
        {
            await sink.WriteAsync([Entry(level: LogLevel.Warning)], Token);
        }
        var line = Encoding.UTF8.GetString((await udp.ReceiveAsync(Token)).Buffer);
        // local0 (16) * 8 + warning (4) = 132
        Assert.StartsWith($"<132>1 2026-10-22T07:49:01.123Z box punchlist {Environment.ProcessId} BackupTaken [punchlist@32473 category=\"PeckList.Backups\" level=\"warn\" eventId=\"12\" requestId=\"0HN1\"", line);
        Assert.EndsWith("userId=\"u-1\"] Ben took a backup: b1", line);

        using var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        await using var tcp = new SyslogSink(new LogAddress("tcp", "127.0.0.1", ((IPEndPoint)listener.LocalEndpoint).Port), Source);
        var accept = listener.AcceptTcpClientAsync(Token).AsTask();
        await tcp.WriteAsync([Entry("a \"quoted\" ] thing")], Token);
        using var client = await accept;
        var framed = Encoding.UTF8.GetString(await ReadUntil(client.GetStream(), bytes => bytes.Length > 0 && Encoding.UTF8.GetString(bytes).EndsWith("thing", StringComparison.Ordinal)));
        var space = framed.IndexOf(' ');
        Assert.Equal(Encoding.UTF8.GetByteCount(framed[(space + 1)..]), int.Parse(framed[..space]));
    }

    [Fact]
    public async Task A_server_that_is_down_or_silent_never_holds_up_logging_and_drops_are_counted()
    {
        var sink = new OtlpSink(new Uri("http://alloy:4318"), new Dictionary<string, string>(), Source, new SilentReceiver());
        var target = new LogTarget("otlp", sink, capacity: 100, TimeProvider.System, text => text);
        var started = DateTime.UtcNow;
        for (var i = 0; i < 5_000; i++) target.Offer(Entry());
        Assert.True(DateTime.UtcNow - started < TimeSpan.FromSeconds(1));
        Assert.True(target.Status.Dropped >= 4_000);
        await target.StopAsync(TimeSpan.FromMilliseconds(200));
        Assert.Equal(5_000, target.Status.Dropped + target.Status.Sent);
    }

    [Fact]
    public async Task A_failing_server_is_retried_and_reported_until_it_takes_the_batch()
    {
        var receiver = new FakeReceiver(HttpStatusCode.ServiceUnavailable);
        var changes = new List<bool>();
        var target = new LogTarget("loki", new LokiSink(new Uri("http://loki:3100"), null, null, null, Source, receiver), 100, TimeProvider.System,
            text => text, (_, healthy) => changes.Add(healthy));
        target.Offer(Entry());
        await Until(() => target.Status.Failures > 0);
        Assert.False(target.Status.Healthy);
        Assert.StartsWith("503", target.Status.LastError);

        receiver.Status = HttpStatusCode.NoContent;
        await Until(() => target.Status.Sent == 1);
        Assert.True(target.Status.Healthy);
        Assert.Equal([false, true], changes);
        await target.StopAsync(TimeSpan.FromSeconds(1));
    }

    [Fact]
    public async Task Files_roll_by_day_and_size_are_gzipped_and_expire()
    {
        var dir = Directory.CreateTempSubdirectory("punchlist-logs-").FullName;
        try
        {
            var day = new DateTimeOffset(2026, 10, 1, 12, 0, 0, TimeSpan.Zero);
            var time = new ManualTime(day);
            // An archive from long ago that is past the keep window.
            File.WriteAllText(Path.Combine(dir, "punchlist-20260901-001.log.gz"), "old");
            await using (var sink = new FileSink(dir, maxMegabytes: 1, keepDays: 7, time))
            {
                await sink.WriteAsync([Entry(time: day)], Token);
                Assert.EndsWith("punchlist-20261001-001.log", sink.CurrentPath);
                Assert.False(File.Exists(Path.Combine(dir, "punchlist-20260901-001.log.gz")));

                // Over 1 MB: the next entry starts file 002 and 001 is archived.
                var big = Entry(new string('y', 600_000), time: day);
                await sink.WriteAsync([big, big], Token);
                await sink.WriteAsync([Entry(time: day)], Token);
                Assert.EndsWith("punchlist-20261001-002.log", sink.CurrentPath);
                Assert.True(File.Exists(Path.Combine(dir, "punchlist-20261001-001.log.gz")));

                // Midnight: a new day's file.
                time.Now = day.AddDays(1);
                await sink.WriteAsync([Entry("tomorrow", time: day.AddDays(1))], Token);
                Assert.EndsWith("punchlist-20261002-001.log", sink.CurrentPath);
            }
            Assert.Equal(["punchlist-20261001-001.log.gz", "punchlist-20261001-002.log.gz", "punchlist-20261002-001.log"],
                Directory.GetFiles(dir).Select(Path.GetFileName).Order());
            await using (var gzip = new GZipStream(File.OpenRead(Path.Combine(dir, "punchlist-20261001-002.log.gz")), CompressionMode.Decompress))
            using (var reader = new StreamReader(gzip))
            {
                Assert.Equal("Ben took a backup: b1", (string?)JsonNode.Parse((await reader.ReadLineAsync(Token))!)!["message"]);
            }

            // A restart the same day carries on in the last file.
            await using (var again = new FileSink(dir, 1, 7, time))
            {
                await again.WriteAsync([Entry("after restart", time: day.AddDays(1))], Token);
                Assert.EndsWith("punchlist-20261002-001.log", again.CurrentPath);
            }
            Assert.Equal(2, File.ReadAllLines(Path.Combine(dir, "punchlist-20261002-001.log")).Length);
        }
        finally
        {
            Directory.Delete(dir, recursive: true);
        }
    }

    [Fact]
    public void Text_and_json_lines_carry_the_standard_fields()
    {
        var withError = Entry() with { Exception = "System.Exception: boom\n   at Here" };
        Assert.Equal("2026-10-22T07:49:01.123Z info  PeckList.Backups: Ben took a backup: b1 (request 0HN1, user u-1)\n    System.Exception: boom\n       at Here",
            LogFormats.Text(withError));
        var json = JsonNode.Parse(LogFormats.JsonLine(withError))!;
        Assert.Equal("2026-10-22T07:49:01.123Z", (string?)json["time"]);
        foreach (var field in new[] { "level", "category", "message", "template", "eventId", "eventName", "requestId", "traceId", "spanId", "userId", "exception" })
        {
            Assert.NotNull(json[field]);
        }
        Assert.Equal(3, (int)json["props"]!["Count"]!);
    }

    [Fact]
    public void Levels_match_a_category_and_those_under_it_and_change_live()
    {
        var levels = new LogLevels(LogLevel.Information, new Dictionary<string, LogLevel> { ["PeckList.Sync"] = LogLevel.Debug });
        Assert.Equal(LogLevel.Debug, levels.For("PeckList.Sync"));
        Assert.Equal(LogLevel.Debug, levels.For("PeckList.Sync.Engine"));
        Assert.Equal(LogLevel.Information, levels.For("PeckList.SyncOther"));
        Assert.Equal(LogLevel.Warning, levels.For("Microsoft.AspNetCore.Hosting.Diagnostics"));
        Assert.Equal(LogLevel.Error, levels.For("Microsoft.AspNetCore.DataProtection.KeyManagement.XmlKeyManager"));
        levels.Set(LogLevel.Warning, new Dictionary<string, LogLevel> { ["Microsoft.AspNetCore"] = LogLevel.Debug });
        Assert.Equal(LogLevel.Warning, levels.For("PeckList.Sync"));
        Assert.Equal(LogLevel.Debug, levels.For("Microsoft.AspNetCore.Routing"));
    }

    [Fact]
    public void Messages_render_like_the_framework_but_with_secrets_masked()
    {
        using var pipeline = new LogPipeline(new LoggingSettings { Files = false }, console: TextWriter.Null);
        pipeline.Redaction.AddSecrets(["s3cret-value"]);
        var logger = pipeline.CreateLogger("PeckList.Test");
        logger.LogInformation("{User} signed in with {Password} at {When:yyyy} ({Count,3})", "kim", "hunter2", new DateTime(2026, 1, 2), 7);
        logger.LogWarning("Callback https://pl.home/signin-oidc?code=abc123&state=xyz789 failed for Bearer eyJhbGciOi.payload");
        logger.LogInformation("Connecting with Host=db;Password=pgpass;Username=pl and s3cret-value");
        logger.LogInformation("Shipping to https://pl:lokipass@loki.home");
        logger.LogDebug("Not written at information");

        var recent = pipeline.Recent();
        Assert.Equal(4, recent.Count);
        Assert.Equal("kim signed in with [redacted] at 2026 (  7)", recent[0].Message);
        Assert.Equal("[redacted]", recent[0].Properties!.Single(p => p.Key == "Password").Value);
        Assert.Equal("Callback https://pl.home/signin-oidc?code=[redacted]&state=[redacted] failed for Bearer [redacted]", recent[1].Message);
        Assert.Equal("Connecting with Host=db;Password=[redacted];Username=pl and [redacted]", recent[2].Message);
        Assert.Equal("Shipping to https://pl:[redacted]@loki.home", recent[3].Message);
    }

    private static async Task<byte[]> ReadUntil(NetworkStream stream, Func<byte[], bool> done)
    {
        var received = new List<byte>();
        var buffer = new byte[4096];
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(Token);
        timeout.CancelAfter(TimeSpan.FromSeconds(10));
        while (!done([.. received]))
        {
            var read = await stream.ReadAsync(buffer, timeout.Token);
            if (read == 0) break;
            received.AddRange(buffer.AsSpan(0, read).ToArray());
        }
        return [.. received];
    }

    private static async Task Until(Func<bool> condition)
    {
        var deadline = DateTime.UtcNow.AddSeconds(15);
        while (!condition())
        {
            if (DateTime.UtcNow > deadline) throw new TimeoutException();
            await Task.Delay(20, Token);
        }
    }
}
