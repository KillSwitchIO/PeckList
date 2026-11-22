using System.Security.Claims;
using ModelContextProtocol.AspNetCore;
using ModelContextProtocol.Protocol;
using PeckList.Core.Accounts;
using PeckList.Core.Configuration;
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

    /// <summary>What each tool needs. Fail closed: a tool missing here is refused.</summary>
    public static readonly IReadOnlyDictionary<string, string> ToolScopes = new Dictionary<string, string>(StringComparer.Ordinal)
    {
        [McpTools.ListLists] = ApiScopes.TasksRead,
        [McpTools.GetTask] = ApiScopes.TasksRead,
    };

    /// <summary>Whether <paramref name="user"/>'s credential may call <paramref name="tool"/>.</summary>
    public static bool May(ClaimsPrincipal? user, string? tool) =>
        user is not null && user.ByKey() && tool is not null && ToolScopes.TryGetValue(tool, out var scope) && user.KeyMay(scope);

    /// <summary>Whether the connector answers at all: on, and on a server where people sign in.</summary>
    public static bool On(HttpContext context) =>
        context.RequestServices.GetRequiredService<LiveSettings>().Current.Mcp
        && context.RequestServices.GetRequiredService<ServerSettings>().AuthMode != AuthMode.None;

    public static IServiceCollection AddMcpConnector(this IServiceCollection services)
    {
        services.AddAuthorizationBuilder().AddPolicy(Policy, policy => policy
            .AddAuthenticationSchemes(ApiKeyAuth.Scheme)
            .RequireAuthenticatedUser());
        services.AddMcpServer(options => options.ServerInfo = new Implementation { Name = "pecklist", Version = ServerApp.Version })
            // Stateless: one self-hosted process, nothing kept between calls (sessions are gone from
            // the protocol as of 2026-07-28; clients still on 2025-11-25 are served the same way).
            .WithHttpTransport(options => options.SessionMode = HttpServerSessionMode.Stateless)
            .WithTools<McpTools>()
            .WithRequestFilters(filters => filters.AddCallToolFilter(next => async (context, cancellation) =>
                May(context.User, context.Params?.Name) ? await next(context, cancellation) : Refused(context.Params?.Name)));
        return services;
    }

    private static CallToolResult Refused(string? tool) => new()
    {
        IsError = true,
        Content =
        [
            new TextContentBlock
            {
                Text = tool is not null && ToolScopes.TryGetValue(tool, out var scope)
                    ? $"This API key lacks the {scope} permission that {tool} needs."
                    : $"There is no tool called {tool}.",
            },
        ],
    };

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
