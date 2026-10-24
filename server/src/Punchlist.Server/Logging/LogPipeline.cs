using System.Diagnostics;
using System.Security.Claims;
using Punchlist.Core.Configuration;

namespace Punchlist.Server.Logging;

/// <summary>The request a log entry was written in, set by <see cref="LogPipeline.UseLogContext"/>.</summary>
public sealed class LogContext
{
    private static readonly AsyncLocal<LogContext?> CurrentContext = new();

    public static LogContext? Current => CurrentContext.Value;

    public string? RequestId { get; set; }
    public string? UserId { get; set; }

    internal static void Set(LogContext? context) => CurrentContext.Value = context;
}

/// <summary>
/// The server's one logging provider (spec: Logging). Every entry gets the standard fields and is
/// redacted once, then goes to each output's own queue: the console, the files and any log
/// servers. Levels and outputs change while the server runs (<see cref="Apply"/>); the latest
/// entries are kept in memory for the debug dump.
/// </summary>
public sealed class LogPipeline : ILoggerProvider, IAsyncDisposable
{
    public const int RecentCapacity = 2000;
    private const int QueueCapacity = 10_000;

    private readonly TimeProvider time;
    private readonly TextWriter console;
    private readonly LogSource source;
    private readonly Func<HttpMessageHandler>? handlers;
    private readonly LogRecord[] recent = new LogRecord[RecentCapacity];
    private readonly Lock gate = new();
    private int recentNext;
    private int recentCount;
    private LogTarget[] targets = [];
    private bool disposed;

    public LogPipeline(LoggingSettings settings, TimeProvider? time = null, TextWriter? console = null, LogSource? source = null, Func<HttpMessageHandler>? handlers = null)
    {
        this.time = time ?? TimeProvider.System;
        this.console = console ?? Console.Out;
        this.source = source ?? LogSource.Current;
        this.handlers = handlers;
        Apply(settings);
    }

    public LogLevels Levels { get; } = new();
    public Redaction Redaction { get; } = new();

    /// <summary>The logging settings in use.</summary>
    public LoggingSettings Settings { get; private set; } = new();

    public IReadOnlyList<LogTargetStatus> Status => [.. Volatile.Read(ref targets).Select(target => target.Status)];

    /// <summary>The latest entries, oldest first.</summary>
    public IReadOnlyList<LogRecord> Recent()
    {
        lock (gate)
        {
            var list = new List<LogRecord>(recentCount);
            var start = (recentNext - recentCount + RecentCapacity) % RecentCapacity;
            for (var i = 0; i < recentCount; i++) list.Add(recent[(start + i) % RecentCapacity]);
            return list;
        }
    }

    /// <summary>Use these settings from now on: levels at once; outputs whose settings changed are replaced.</summary>
    public void Apply(LoggingSettings settings)
    {
        Levels.Set(Level(settings.Level), settings.Overrides.ToDictionary(pair => pair.Key, pair => Level(pair.Value)));
        Redaction.AddSecrets([settings.LokiPassword, settings.ElasticPassword, settings.ElasticApiKey, .. settings.OtlpHeaders.Values]);
        var wanted = Sinks(settings).ToList();
        LogTarget[] retired;
        lock (gate)
        {
            if (disposed) return;
            Settings = settings;
            var keep = targets.Where(target => wanted.Any(each => each.Key == target.Key)).ToList();
            retired = [.. targets.Except(keep)];
            var added = wanted.Where(each => keep.All(target => target.Key != each.Key))
                .Select(each => new LogTarget(each.Key, each.Make(), QueueCapacity, time, Redaction.Text, HealthChanged));
            Volatile.Write(ref targets, [.. keep, .. added]);
        }
        foreach (var target in retired) _ = target.StopAsync(TimeSpan.FromSeconds(3)).AsTask();
    }

    private IEnumerable<(string Key, Func<ILogSink> Make)> Sinks(LoggingSettings settings)
    {
        HttpMessageHandler? Handler() => handlers?.Invoke();
        yield return ($"console|{settings.Format}", () => new ConsoleSink(console, settings.Format));
        if (settings.Files)
        {
            yield return ($"file|{settings.Dir}|{settings.FileMaxMegabytes}|{settings.FileKeepDays}",
                () => new FileSink(settings.Dir, settings.FileMaxMegabytes, settings.FileKeepDays, time));
        }
        if (settings.OtlpEndpoint is { } otlp)
        {
            yield return ($"otlp|{otlp}|{Fingerprint(settings.OtlpHeaders.Select(pair => pair.Key + "=" + pair.Value))}",
                () => new OtlpSink(otlp, settings.OtlpHeaders, source, Handler()));
        }
        if (settings.LokiUrl is { } loki)
        {
            yield return ($"loki|{loki}|{settings.LokiUsername}|{settings.LokiTenant}|{Fingerprint([settings.LokiPassword])}",
                () => new LokiSink(loki, settings.LokiUsername, settings.LokiPassword, settings.LokiTenant, source, Handler()));
        }
        if (settings.Gelf is { } gelf)
        {
            yield return ($"gelf|{gelf}", () => new GelfSink(gelf, source, Handler()));
        }
        if (settings.ElasticUrl is { } elastic)
        {
            yield return ($"elastic|{elastic}|{settings.ElasticIndex}|{settings.ElasticUsername}|{Fingerprint([settings.ElasticPassword, settings.ElasticApiKey])}",
                () => new ElasticSink(elastic, settings.ElasticIndex, settings.ElasticUsername, settings.ElasticPassword, settings.ElasticApiKey, source, Handler()));
        }
        if (settings.Syslog is { } syslog)
        {
            yield return ($"syslog|{syslog}", () => new SyslogSink(syslog, source));
        }
    }

    /// <summary>Tells changed credentials apart without keeping them in the key.</summary>
    private static string Fingerprint(IEnumerable<string?> values) =>
        Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(string.Join("\n", values))))[..12];

    private void HealthChanged(LogTarget target, bool healthy)
    {
        var status = target.Status;
        Write(healthy
            ? new LogRecord(time.GetUtcNow(), LogLevel.Information, "Punchlist.Logging", $"Log output {status.Name} is sending again ({status.Dropped} entries dropped so far)")
            : new LogRecord(time.GetUtcNow(), LogLevel.Warning, "Punchlist.Logging",
                $"Log output {status.Name} ({status.Destination}) is failing: {status.LastError}. Up to {QueueCapacity} entries wait for it; more are dropped."));
    }

    public static LogLevel Level(LogLevelSetting setting) => (LogLevel)(int)setting;

    public ILogger CreateLogger(string categoryName) => new PipelineLogger(this, categoryName);

    public void Write(LogRecord record)
    {
        lock (gate)
        {
            recent[recentNext] = record;
            recentNext = (recentNext + 1) % RecentCapacity;
            recentCount = Math.Min(recentCount + 1, RecentCapacity);
        }
        foreach (var target in Volatile.Read(ref targets)) target.Offer(record);
    }

    internal LogRecord Build<TState>(string category, LogLevel level, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
    {
        string? template = null;
        string message;
        List<KeyValuePair<string, object?>>? properties = null;
        if (state is IReadOnlyList<KeyValuePair<string, object?>> pairs)
        {
            var named = new List<KeyValuePair<string, object?>>(pairs.Count);
            foreach (var (name, value) in pairs)
            {
                if (name == "{OriginalFormat}")
                {
                    template = value as string;
                    continue;
                }
                named.Add(new(name, Redaction.IsSecretName(name) ? Redaction.Mask : value));
                (properties ??= []).Add(new(name, Redaction.Value(name, value)));
            }
            // Holes are filled by name: the framework's own states do not list values in template order.
            message = template is not null && LogTemplate.Fill(template, named) is { } filled ? filled : formatter(state, exception);
        }
        else
        {
            message = formatter(state, exception);
        }
        var activity = Activity.Current;
        var context = LogContext.Current;
        return new LogRecord(
            time.GetUtcNow(),
            level,
            category,
            Redaction.Text(message),
            eventId.Id,
            eventId.Name,
            template,
            exception is null ? null : Redaction.Text(exception.ToString()),
            context?.RequestId,
            activity is { TraceId: var trace } && trace != default ? trace.ToHexString() : null,
            activity is { SpanId: var span } && span != default ? span.ToHexString() : null,
            context?.UserId,
            properties);
    }

    public void Dispose() => DisposeAsync().AsTask().GetAwaiter().GetResult();

    public async ValueTask DisposeAsync()
    {
        LogTarget[] stopping;
        lock (gate)
        {
            if (disposed) return;
            disposed = true;
            stopping = targets;
            targets = [];
        }
        await Task.WhenAll(stopping.Select(target => target.StopAsync(TimeSpan.FromSeconds(3)).AsTask()));
    }

    /// <summary>Request id first thing; the user once authentication has run (call again after it).</summary>
    public static void UseLogContext(IApplicationBuilder app, bool user)
    {
        if (!user)
        {
            app.Use(async (context, next) =>
            {
                LogContext.Set(new LogContext { RequestId = context.TraceIdentifier });
                try
                {
                    await next(context);
                }
                finally
                {
                    LogContext.Set(null);
                }
            });
            return;
        }
        app.Use((context, next) =>
        {
            if (LogContext.Current is { } current) current.UserId = context.User.FindFirstValue(ClaimTypes.NameIdentifier);
            return next(context);
        });
    }

    private sealed class PipelineLogger(LogPipeline pipeline, string category) : ILogger
    {
        private int version = -1;
        private LogLevel minimum;

        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel)
        {
            if (logLevel == LogLevel.None) return false;
            var levels = pipeline.Levels;
            if (version != levels.Version)
            {
                minimum = levels.For(category);
                version = levels.Version;
            }
            return logLevel >= minimum;
        }

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
        {
            if (!IsEnabled(logLevel)) return;
            pipeline.Write(pipeline.Build(category, logLevel, eventId, state, exception, formatter));
        }
    }
}
