using System.Collections.Concurrent;
using System.Globalization;
using System.Security.Claims;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.Json.Serialization.Metadata;
using System.Threading.RateLimiting;
using ModelContextProtocol;
using ModelContextProtocol.AspNetCore;
using ModelContextProtocol.Protocol;
using ModelContextProtocol.Server;
using PeckList.Core;
using PeckList.Core.Accounts;
using PeckList.Core.Audit;
using PeckList.Core.Configuration;
using PeckList.Server.Api;
using PeckList.Server.Audit;
using PeckList.Server.Auth;

namespace PeckList.Server.Mcp;

/// <summary>
/// The MCP connector (PL-113) at <c>/mcp</c>: assistants that speak the Model Context Protocol read
/// and change a person's tasks through the same services the task API uses, so sharing, history,
/// repeats and the audit log hold as they do there. Off unless <c>MCP=on</c> (live), and never with
/// <c>AUTH_MODE=none</c>. Only a Bearer credential signs a call in, never the session cookie, so a
/// page in someone's browser cannot call it; each tool needs the scope this table names, checked
/// before it runs, and a tool the table does not name is refused (Security, PL-113 design).
/// </summary>
public static class McpConnector
{
    public const string Path = "/mcp";
    public const string Policy = "mcp";
    /// <summary>The audit event a write tool's call makes, naming the key it came by as its target.</summary>
    public const string WriteEvent = "mcp.task-changed";

    /// <summary>
    /// What each tool needs. Fail closed: a tool missing here is refused. A tool needing
    /// <see cref="ApiScopes.TasksWrite"/> is a write: it takes from the task API's write limit and
    /// is audited (<see cref="WriteAsync"/>).
    /// </summary>
    public static readonly IReadOnlyDictionary<string, string> ToolScopes = new Dictionary<string, string>(StringComparer.Ordinal)
    {
        [McpTools.ListLists] = ApiScopes.TasksRead,
        [McpTools.ListTags] = ApiScopes.TasksRead,
        [McpTools.FindTasks] = ApiScopes.TasksRead,
        [McpTools.GetTask] = ApiScopes.TasksRead,
        [McpTools.QuickAdd] = ApiScopes.TasksWrite,
        [McpTools.AddTask] = ApiScopes.TasksWrite,
        [McpTools.UpdateTask] = ApiScopes.TasksWrite,
        [McpTools.SetTaskNotes] = ApiScopes.TasksWrite,
        [McpTools.CompleteTask] = ApiScopes.TasksWrite,
        [McpTools.ReopenTask] = ApiScopes.TasksWrite,
        [McpTools.SnoozeTask] = ApiScopes.TasksWrite,
    };

    /// <summary>Whether <paramref name="tool"/> changes something.</summary>
    public static bool Writes(string? tool) =>
        tool is not null && ToolScopes.TryGetValue(tool, out var scope) && scope == ApiScopes.TasksWrite;

    /// <summary>Whether <paramref name="user"/>'s credential may call <paramref name="tool"/>.</summary>
    public static bool May(ClaimsPrincipal? user, string? tool) =>
        user is not null && user.ByKey() && tool is not null && ToolScopes.TryGetValue(tool, out var scope) && user.KeyMay(scope);

    /// <summary>Whether the connector answers at all: on, and on a server where people sign in.</summary>
    public static bool On(HttpContext context) =>
        context.RequestServices.GetRequiredService<LiveSettings>().Current.Mcp
        && context.RequestServices.GetRequiredService<ServerSettings>().AuthMode != AuthMode.None;

    public static IServiceCollection AddMcpConnector(this IServiceCollection services)
    {
        services.AddSingleton<RefusalGate>();
        services.AddAuthorizationBuilder().AddPolicy(Policy, policy => policy
            .AddAuthenticationSchemes(ApiKeyAuth.Scheme)
            .RequireAuthenticatedUser());
        services.AddMcpServer(options => options.ServerInfo = new Implementation { Name = "pecklist", Version = ServerApp.Version })
            // Stateless: one self-hosted process, nothing kept between calls (sessions are gone from
            // the protocol as of 2026-07-28; clients still on 2025-11-25 are served the same way).
            .WithHttpTransport(options => options.SessionMode = HttpServerSessionMode.Stateless)
            .WithTools<McpTools>(AnswerOptions)
            .WithRequestFilters(filters => filters.AddCallToolFilter(next => async (context, cancellation) =>
            {
                var tool = context.Params?.Name;
                if (!May(context.User, tool))
                {
                    // A known write a key may not make: noted, once a minute per key (Security, piece 2),
                    // as /mcp answers it 200 with a tool error the access log can't tell from a success.
                    if (Writes(tool) && context.User?.ByKey() == true) await RecordAsync(context, AuditOutcome.Denied, GivenId(context), gated: true);
                    return Refused(tool);
                }
                // A tool's refusal (no such task, a field it can't take) is an answer the model acts on,
                // not a server error: answered as the tool's error, without the SDK's log of a crash.
                async ValueTask<CallToolResult> Run()
                {
                    try
                    {
                        return await next(context, cancellation);
                    }
                    catch (McpException error) when (error is not McpProtocolException)
                    {
                        return Error(error.Message);
                    }
                }
                return Writes(tool) ? await WriteAsync(context, Run, cancellation) : await Run();
            }));
        return services;
    }

    /// <summary>
    /// Nulls written out: each tool's output schema names every field as required, and a client that
    /// checks answers against it (the MCP Inspector, the official TypeScript client) refused the SDK's
    /// default, which leaves them out. That holds for our own types' fields that leave themselves out
    /// in the task API too, such as a reminder's <c>before</c> or <c>at</c> (QA, piece 2).
    /// </summary>
    private static readonly JsonSerializerOptions AnswerOptions = new(McpJsonUtilities.DefaultOptions)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.Never,
        TypeInfoResolver = McpJsonUtilities.DefaultOptions.TypeInfoResolver!.WithAddedModifier(type =>
        {
            if (type.Type.Namespace?.StartsWith("PeckList.", StringComparison.Ordinal) != true) return;
            foreach (var property in type.Properties) property.ShouldSerialize = null;
        }),
    };

    private static CallToolResult Refused(string? tool) => Error(
        tool is not null && ToolScopes.TryGetValue(tool, out var scope)
            ? $"This API key lacks the {scope} permission that {tool} needs."
            : $"There is no tool called {tool}.");

    private static CallToolResult Error(string text) => new() { IsError = true, Content = [new TextContentBlock { Text = text }] };

    /// <summary>
    /// A write tool's call (Security and Dev 1, PL-113 piece 1): it takes a turn from the task API's
    /// write limit, the one the account's keys and sessions share, so MCP is no way around it; and
    /// it is audited as <see cref="WriteEvent"/>, naming the key it came by as the target and the
    /// tool and task in the detail ("update_task 01K..."), refused when the tool answered an error.
    /// One entry per call, not the request's note: a JSON-RPC batch (older revisions) carries
    /// several calls in one request (Dev 1, piece 2). A throttled call is noted once a minute per key
    /// (Security, piece 2). History names the person, as for any API write.
    /// </summary>
    private static async ValueTask<CallToolResult> WriteAsync(
        RequestContext<CallToolRequestParams> context, Func<ValueTask<CallToolResult>> run, CancellationToken cancellation)
    {
        var given = GivenId(context);
        Task AuditAsync(string outcome, string? taskId) => RecordAsync(context, outcome, taskId);
        using var turn = context.Services!.GetRequiredService<TaskWriteLimit>().Take(TaskWriteLimit.KeyOf(context.User!));
        if (!turn.IsAcquired)
        {
            await RecordAsync(context, AuditOutcome.Throttled, given, gated: true);
            var wait = turn.TryGetMetadata(MetadataName.RetryAfter, out var after) ? after : TimeSpan.FromMinutes(1);
            return Error($"Too many changes this minute (at most {TaskApiEndpoints.WritesPerMinute}, shared with the user's other apps and keys): "
                + $"try again in {Math.Max(1, (int)Math.Ceiling(wait.TotalSeconds)).ToString(CultureInfo.InvariantCulture)} seconds.");
        }
        CallToolResult result;
        try
        {
            result = await run();
        }
        catch (McpException)
        {
            // Bad arguments the SDK answers as a protocol error.
            await AuditAsync(AuditOutcome.Refused, given);
            throw;
        }
        // A task just made: the detail names it, as it names the one changed.
        await AuditAsync(result.IsError == true ? AuditOutcome.Refused : AuditOutcome.Ok, given ?? (result.IsError == true ? null : TaskIdOf(result)));
        return result;
    }

    /// <summary>The task id a call names, cut short for the audit log; null when it names none.</summary>
    private static string? GivenId(RequestContext<CallToolRequestParams> context) =>
        context.Params?.Arguments?.TryGetValue("id", out var id) == true && id.ValueKind == JsonValueKind.String
            ? SafeText.Cut(id.GetString() ?? "", 64)
            : null;

    /// <summary>
    /// A write tool's call in the audit log as <see cref="WriteEvent"/>: the person, the key it came
    /// by as the target, the tool and task as the detail. <paramref name="gated"/>: a refusal a
    /// client may repeat in a loop (throttled, denied), noted at most once a minute per key and kind.
    /// </summary>
    private static async Task RecordAsync(RequestContext<CallToolRequestParams> context, string outcome, string? taskId, bool gated = false)
    {
        var services = context.Services!;
        var user = context.User!;
        var tool = context.Params!.Name;
        var keyId = user.FindFirstValue(ApiKeyAuth.KeyClaim);
        if (gated && !services.GetRequiredService<RefusalGate>().Pass($"{keyId ?? user.UserId()} {outcome}")) return;
        var key = keyId is null ? null : await services.GetRequiredService<IApiKeyStore>().FindAsync(keyId, CancellationToken.None);
        services.GetRequiredService<AuditLog>().RecordEvent(
            services.GetService<IHttpContextAccessor>()?.HttpContext, WriteEvent, user.UserId(), user.FindFirstValue(ClaimTypes.Name),
            keyId, key is null ? null : SafeText.Cut(key.Name, 100), taskId is null ? tool : $"{tool} {taskId}", outcome: outcome);
    }

    /// <summary>
    /// Whether a refusal may be noted now: the first for its key and kind in a minute. A client that
    /// loops on a refused write leaves one line a minute, not hundreds (Security, piece 2). It holds
    /// one time per key and kind, so it grows with the keys, not the calls.
    /// </summary>
    public sealed class RefusalGate(TimeProvider time)
    {
        public static readonly TimeSpan Every = TimeSpan.FromMinutes(1);

        private readonly ConcurrentDictionary<string, DateTimeOffset> noted = new(StringComparer.Ordinal);

        public bool Pass(string name)
        {
            var now = time.GetUtcNow();
            while (true)
            {
                if (!noted.TryGetValue(name, out var last)) return noted.TryAdd(name, now) || Pass(name);
                if (now - last < Every) return false;
                if (noted.TryUpdate(name, now, last)) return true;
            }
        }
    }

    /// <summary>The id of the task a tool answered with, from its structured result.</summary>
    private static string? TaskIdOf(CallToolResult result) =>
        result.StructuredContent is { ValueKind: JsonValueKind.Object } content
        && content.TryGetProperty("task", out var task) && task.ValueKind == JsonValueKind.Object
        && task.TryGetProperty("id", out var id) && id.ValueKind == JsonValueKind.String
            ? id.GetString()
            : null;

    /// <summary>Off, or on a server without sign-in, <c>/mcp</c> is not there: 404 before anything else looks.</summary>
    public static void UseMcpGate(this WebApplication app) => app.Use(async (context, next) =>
    {
        if (context.Request.Path.StartsWithSegments(Path) && !On(context))
        {
            context.Response.StatusCode = StatusCodes.Status404NotFound;
            return;
        }
        await next(context);
    });

    public static void MapMcpConnector(this WebApplication app)
    {
        var group = app.MapGroup(Path)
            .RequireAuthorization(Policy)
            .EnsureProfiles()
            // The task API's limit, per account and shared with it: more keys do not mean more calls.
            .RequireRateLimiting(Api.TaskApiEndpoints.ReadRateLimit)
            .ExcludeFromDescription();
        group.MapMcp();
    }
}
