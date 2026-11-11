using System.Diagnostics;
using System.Net;
using System.Security.Claims;
using System.Threading.Channels;
using Microsoft.AspNetCore.Routing.Patterns;
using PeckList.Core;
using PeckList.Core.Accounts;
using PeckList.Core.Audit;
using PeckList.Server.Auth;

namespace PeckList.Server.Audit;

/// <summary>Which route value names an event's target, and what kind of thing it is.</summary>
public enum AuditTarget
{
    None,

    /// <summary>An account id, shown by username.</summary>
    User,

    /// <summary>A server group id, shown by name.</summary>
    Group,

    /// <summary>Shown as it is (a provider, a backup's file name).</summary>
    Name,
}

/// <summary>Endpoint metadata: requests to it are this event (spec: Access and event log).</summary>
public sealed record AuditedMetadata(string Type, string? TargetRoute, AuditTarget Target);

/// <summary>
/// What an endpoint (or a sign-in handler) adds to its request's entries: a type when the endpoint
/// has none, who acted when the request was anonymous (signing in), the target and a short note.
/// </summary>
public sealed class AuditNote
{
    public string? Type { get; set; }
    public string? Outcome { get; set; }
    public string? ActorId { get; set; }
    public string? ActorName { get; set; }
    public string? TargetId { get; set; }
    public string? TargetName { get; set; }
    public string? Detail { get; set; }

    /// <summary>The event has no actor whoever's session sent it (a failed sign-in names who it tried, not the browser's session).</summary>
    public bool Anonymous { get; set; }

    public AuditNote Actor(Account account)
    {
        ActorId = account.Id;
        ActorName = account.Username;
        return this;
    }

    public AuditNote On(string? id, string? name)
    {
        TargetId = id;
        TargetName = name;
        return this;
    }
}

public static class AuditExtensions
{
    /// <summary>Requests to this endpoint are recorded as <paramref name="type"/>, about the route value <paramref name="targetRoute"/>.</summary>
    public static TBuilder Audited<TBuilder>(this TBuilder builder, string type, string? targetRoute = "id", AuditTarget target = AuditTarget.User)
        where TBuilder : IEndpointConventionBuilder =>
        builder.WithMetadata(new AuditedMetadata(type, targetRoute, targetRoute is null ? AuditTarget.None : target));

    /// <summary>This request's note for the access and event log.</summary>
    public static AuditNote Audit(this HttpContext context)
    {
        if (context.Features.Get<AuditNote>() is { } note) return note;
        note = new AuditNote();
        context.Features.Set(note);
        return note;
    }
}

/// <summary>
/// Writes the access and event log: entries queue (up to 10,000, then dropped and counted) and a
/// background writer stores them in batches (gathered for <see cref="Gather"/>), so a request never waits on it. Each entry also goes to
/// the logs (<c>PeckList.Audit</c>, <c>PeckList.Access</c>), and so to any log server.
/// </summary>
public sealed class AuditLog : BackgroundService
{
    private const int DeviceLength = 200;

    private readonly IAuditStore store;
    private readonly TimeProvider time;
    private readonly Channel<AuditEntry> queue;
    private readonly ILogger events;
    private readonly ILogger access;
    private int pending;
    private long dropped;

    /// <summary>
    /// How long the writer gathers entries before storing them, so the few requests of one app
    /// exchange share one database write instead of one each (PL-095).
    /// </summary>
    internal static readonly TimeSpan Gather = TimeSpan.FromSeconds(2);
    private readonly TimeSpan gather;
    private const int BatchSize = 500;
    // Completed by FlushAsync: store what is queued now instead of waiting out the gather.
    private volatile TaskCompletionSource hurry = new(TaskCreationOptions.RunContinuationsAsynchronously);

    private readonly Logging.Redaction redaction;

    public AuditLog(IAuditStore store, TimeProvider time, ILoggerFactory logs, Logging.LogPipeline? pipeline = null)
        : this(store, time, logs, Gather, pipeline)
    {
    }

    /// <param name="gather">How long the writer waits for more entries; tests set a long one.</param>
    internal AuditLog(IAuditStore store, TimeProvider time, ILoggerFactory logs, TimeSpan gather, Logging.LogPipeline? pipeline = null)
    {
        this.gather = gather;
        redaction = pipeline?.Redaction ?? new Logging.Redaction();
        this.store = store;
        this.time = time;
        events = logs.CreateLogger("PeckList.Audit");
        access = logs.CreateLogger("PeckList.Access");
        queue = Channel.CreateBounded<AuditEntry>(
            new BoundedChannelOptions(10_000) { FullMode = BoundedChannelFullMode.DropWrite, SingleReader = true },
            _ =>
            {
                Interlocked.Decrement(ref pending);
                Interlocked.Increment(ref dropped);
            });
    }

    public long Dropped => Interlocked.Read(ref dropped);

    private readonly Lock idGate = new();
    private string? lastId;

    /// <summary>
    /// Ids in the order things happened: entries sort by time then id, and a request made just after
    /// another (the same millisecond) must not sort before it.
    /// </summary>
    private string NextId()
    {
        lock (idGate) return lastId = Ids.NewUlidAfter(lastId, time);
    }

    /// <summary>When a request began, and the ids its entries will have (taken then, so they sort in that order).</summary>
    internal readonly record struct RequestStart(long Timestamp, DateTimeOffset At, string AccessId, string EventId);

    internal RequestStart Begin() => new(Stopwatch.GetTimestamp(), time.GetUtcNow(), NextId(), NextId());

    /// <summary>An event that happened outside a request (at startup, on a schedule).</summary>
    public void RecordSystem(string type, string outcome = AuditOutcome.Ok, string? detail = null) => Record(new AuditEntry
    {
        Id = NextId(),
        Time = time.GetUtcNow(),
        Kind = AuditKind.Event,
        Type = type,
        Outcome = outcome,
        ActorName = "system",
        Detail = detail,
    });

    /// <summary>
    /// An event a request causes besides its own (one sync can share a list and add three people):
    /// where it came from is the request's.
    /// </summary>
    public void RecordEvent(
        HttpContext? context, string type, string? actorId, string? actorName, string? targetId, string? targetName, string? detail,
        string? impersonatorId = null, string? impersonatorName = null) => Record(new AuditEntry
    {
        Id = NextId(),
        Time = time.GetUtcNow(),
        Kind = AuditKind.Event,
        Type = type,
        Outcome = AuditOutcome.Ok,
        ActorId = actorId,
        ActorName = actorName,
        ImpersonatorId = impersonatorId,
        ImpersonatorName = impersonatorName,
        TargetId = targetId,
        TargetName = targetName,
        Detail = detail,
        Ip = context is null ? null : Address(context.Connection.RemoteIpAddress),
        Device = context is null ? null : DeviceOf(context),
        RequestId = context?.TraceIdentifier,
    });

    /// <summary>The longest detail kept in the audit log and written to the logs.</summary>
    public const int MaxDetailLength = 1000;

    public void Record(AuditEntry entry)
    {
        // Notes come from requests and providers: the same masking as the logs, as text the store takes.
        entry = entry with
        {
            Type = SafeText.Clean(entry.Type),
            Outcome = SafeText.Clean(entry.Outcome),
            ActorId = SafeText.Clean(entry.ActorId),
            ActorName = SafeText.Clean(entry.ActorName),
            ImpersonatorId = SafeText.Clean(entry.ImpersonatorId),
            ImpersonatorName = SafeText.Clean(entry.ImpersonatorName),
            TargetId = SafeText.Clean(entry.TargetId),
            TargetName = SafeText.Clean(entry.TargetName),
            Ip = SafeText.Clean(entry.Ip),
            Method = SafeText.Clean(entry.Method),
            Route = SafeText.Clean(entry.Route),
            RequestId = SafeText.Clean(entry.RequestId),
            Detail = entry.Detail is null ? null : Capped(redaction.Text(SafeText.Clean(entry.Detail))),
            Device = entry.Device is null ? null : redaction.Text(SafeText.Clean(entry.Device)),
        };
        Interlocked.Increment(ref pending);
        // A full queue drops the entry (counted by the queue's callback); a closed one at shutdown too.
        if (!queue.Writer.TryWrite(entry))
        {
            Interlocked.Decrement(ref pending);
            Interlocked.Increment(ref dropped);
        }
        WriteLog(entry);
    }

    /// <summary>
    /// A detail can hold what someone else wrote (a provider's error, a typed reason). Cut after the
    /// masking, so a cut can never leave half a secret unmasked (audit S17).
    /// </summary>
    private static string Capped(string detail) => detail.Length <= MaxDetailLength ? detail : SafeText.Cut(detail, MaxDetailLength) + "...";

    private void WriteLog(AuditEntry entry)
    {
        if (entry.Kind == AuditKind.Access)
        {
            access.Log(entry.Status >= 500 ? LogLevel.Warning : LogLevel.Information,
                "{Method} {Route} {Status} in {DurationMs} ms by {Actor} from {Ip}",
                entry.Method, entry.Route, entry.Status, entry.DurationMs, entry.ActorName ?? "-", entry.Ip ?? "-");
            return;
        }
        events.Log(entry.Outcome is AuditOutcome.Ok or AuditOutcome.Pending ? LogLevel.Information : LogLevel.Warning,
            "{Type} {Outcome} by {Actor}{Impersonator} on {Target} from {Ip}{Detail}",
            entry.Type, entry.Outcome, entry.ActorName ?? "-",
            entry.ImpersonatorName is null ? "" : $" (viewed as by {entry.ImpersonatorName})",
            entry.TargetName ?? entry.TargetId ?? "-", entry.Ip ?? "-",
            entry.Detail is null ? "" : $": {entry.Detail}");
    }

    /// <summary>Wait until everything queued so far is stored (tests, shutdown).</summary>
    public async Task FlushAsync(CancellationToken cancellation = default)
    {
        var deadline = DateTime.UtcNow.AddSeconds(10);
        while (Volatile.Read(ref pending) > 0 && DateTime.UtcNow < deadline)
        {
            hurry.TrySetResult();
            await Task.Delay(10, cancellation);
        }
    }

    protected override async Task ExecuteAsync(CancellationToken stopping)
    {
        var batch = new List<AuditEntry>(500);
        try
        {
            while (await queue.Reader.WaitToReadAsync(stopping))
            {
                var now = hurry;
                if (queue.Reader.Count < BatchSize) await Task.WhenAny(Task.Delay(gather, stopping), now.Task);
                if (now.Task.IsCompleted) hurry = new(TaskCreationOptions.RunContinuationsAsynchronously);
                await DrainAsync(batch, CancellationToken.None);
            }
        }
        catch (OperationCanceledException)
        {
        }
        await DrainAsync(batch, CancellationToken.None);
    }

    private async Task DrainAsync(List<AuditEntry> batch, CancellationToken cancellation)
    {
        while (true)
        {
            batch.Clear();
            while (batch.Count < BatchSize && queue.Reader.TryRead(out var entry)) batch.Add(entry);
            if (batch.Count == 0) return;
            for (var attempt = 1; ; attempt++)
            {
                try
                {
                    await store.AppendAsync(batch, cancellation);
                    break;
                }
                catch (Exception error) when (attempt < 3)
                {
                    events.LogWarning(error, "Storing {Count} audit entries failed; trying again", batch.Count);
                    await Task.Delay(500 * attempt, cancellation);
                }
                catch (Exception error)
                {
                    var lost = await StoreOneByOneAsync(batch, cancellation);
                    if (lost > 0)
                    {
                        events.LogError(error, "Dropped {Count} of {Batch} audit entries that could not be stored", lost, batch.Count);
                        Interlocked.Add(ref dropped, lost);
                    }
                    break;
                }
            }
            Interlocked.Add(ref pending, -batch.Count);
        }
    }

    /// <summary>
    /// After a batch failed for good: one entry the store refuses should not cost the others. A few
    /// failures in a row means the store is down, so the rest are not tried. How many were lost.
    /// </summary>
    private async Task<int> StoreOneByOneAsync(List<AuditEntry> batch, CancellationToken cancellation)
    {
        var (lost, inARow) = (0, 0);
        foreach (var entry in batch)
        {
            if (inARow >= 3)
            {
                lost++;
                continue;
            }
            try
            {
                await store.AppendAsync([entry], cancellation);
                inARow = 0;
            }
            catch (Exception)
            {
                lost++;
                inARow++;
            }
        }
        return lost;
    }

    /// <summary>The entries one request makes: an access entry, and an event when the endpoint is one.</summary>
    internal async Task RecordRequestAsync(HttpContext context, int status, RequestStart started)
    {
        var note = context.Features.Get<AuditNote>() ?? new AuditNote();
        var endpoint = context.GetEndpoint();
        var metadata = endpoint?.Metadata.GetMetadata<AuditedMetadata>();
        var route = (endpoint as RouteEndpoint)?.RoutePattern;
        // The web app's fallback: judged by its path like a request no endpoint took.
        if (route?.RawText?.Contains("{*path", StringComparison.Ordinal) == true) route = null;
        var path = context.Request.Path.Value ?? "";
        var user = context.User;
        var common = new AuditEntry
        {
            Id = "",
            Time = started.At,
            Kind = AuditKind.Access,
            Type = "request",
            Outcome = AuditOutcome.Of(status),
            ActorId = note.ActorId ?? user.FindFirstValue(ClaimTypes.NameIdentifier),
            ActorName = note.ActorName ?? user.FindFirstValue(ClaimTypes.Name),
            ImpersonatorId = user.FindFirstValue(ImpersonationSetup.ByClaim),
            ImpersonatorName = user.FindFirstValue(ImpersonationSetup.ByNameClaim),
            Ip = Address(context.Connection.RemoteIpAddress),
            Device = DeviceOf(context),
            Method = context.Request.Method,
            Route = route is not null ? Template(route) : path,
            Status = status,
            DurationMs = (int)Math.Min(int.MaxValue, Stopwatch.GetElapsedTime(started.Timestamp).TotalMilliseconds),
            RequestId = context.TraceIdentifier,
        };

        // Every API and sign-in request; not the web app's files, the SPA fallback or health checks.
        var isApp = route is null
            ? path.StartsWith("/api/", StringComparison.Ordinal) || path.StartsWith("/auth/", StringComparison.Ordinal)
                || path.StartsWith("/signin-", StringComparison.Ordinal) || path.StartsWith("/signout-", StringComparison.Ordinal)
            : route.RawText != "/healthz";
        if (isApp) Record(common with { Id = started.AccessId });

        var type = note.Type ?? metadata?.Type;
        if (type is null) return;
        var (targetId, targetName) = (note.TargetId, note.TargetName);
        if (targetId is null && targetName is null && metadata is { TargetRoute: { } key }
            && context.Request.RouteValues.TryGetValue(key, out var value) && value?.ToString() is { } raw)
        {
            targetId = raw;
            targetName = metadata.Target switch
            {
                AuditTarget.User => (await context.RequestServices.GetRequiredService<IAccountStore>().FindByIdAsync(raw))?.Username,
                AuditTarget.Group => (await context.RequestServices.GetRequiredService<IServerGroupStore>().FindAsync(raw))?.Name,
                _ => raw,
            };
            if (metadata.Target == AuditTarget.Name) targetId = null;
        }
        Record(common with
        {
            Id = started.EventId,
            Kind = AuditKind.Event,
            Type = type,
            Outcome = note.Outcome ?? common.Outcome,
            ActorId = note.Anonymous ? null : common.ActorId,
            ActorName = note.Anonymous ? null : common.ActorName,
            ImpersonatorId = note.Anonymous ? null : common.ImpersonatorId,
            ImpersonatorName = note.Anonymous ? null : common.ImpersonatorName,
            TargetId = targetId,
            TargetName = targetName,
            Detail = note.Detail,
        });
    }

    /// <summary>The full template with route parameter names, never values.</summary>
    private static string Template(RoutePattern pattern) => "/" + (pattern.RawText ?? "").TrimStart('/');

    /// <summary>
    /// The browser or app, from the user agent, cut to <see cref="DeviceLength"/>; null without one.
    /// A request signed in by an API key names the key first, so what a key did can be told apart
    /// (a CLI's export, a script's writes) and the key revoked.
    /// </summary>
    private static string? DeviceOf(HttpContext context)
    {
        var agent = context.Request.Headers.UserAgent.ToString();
        if (context.User.ByKey() && context.User.FindFirstValue(ApiKeyAuth.KeyClaim) is { } key)
        {
            agent = agent.Length > 0 ? $"API key {key}; {agent}" : $"API key {key}";
        }
        return agent.Length > 0 ? SafeText.Cut(agent, DeviceLength) : null;
    }

    private static string? Address(IPAddress? address) =>
        address is null ? null : (address.IsIPv4MappedToIPv6 ? address.MapToIPv4() : address).ToString();

    /// <summary>Times each request and records it once the answer is decided (after authentication, so the user is known).</summary>
    public static void UseAuditLog(IApplicationBuilder app)
    {
        var audit = app.ApplicationServices.GetRequiredService<AuditLog>();
        app.Use(async (context, next) =>
        {
            var started = audit.Begin();
            context.Audit();
            var status = 500;
            try
            {
                await next(context);
                status = context.Response.StatusCode;
            }
            finally
            {
                try
                {
                    await audit.RecordRequestAsync(context, status, started);
                }
                catch (Exception error)
                {
                    audit.events.LogError(error, "Could not record {Path} in the access log", context.Request.Path.Value);
                }
            }
        });
    }
}
