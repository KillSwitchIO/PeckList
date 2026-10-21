using System.Reflection;
using Microsoft.AspNetCore.HttpOverrides;
using Punchlist.Core;

namespace Punchlist.Server;

/// <summary>Composition root: services, middleware and endpoints of the one container.</summary>
public static class ServerApp
{
    public static string Version { get; } =
        typeof(ServerApp).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion.Split('+')[0]
        ?? "0.0.0";

    public static WebApplication Build(string[] args)
    {
        var builder = WebApplication.CreateBuilder(args);
        var config = builder.Configuration;

        builder.Services.AddHealthChecks();
        builder.Services.Configure<ForwardedHeadersOptions>(options =>
        {
            options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
            // Walk back through every trusted hop, not just the last one.
            options.ForwardLimit = null;
            options.KnownIPNetworks.Clear();
            options.KnownProxies.Clear();
            foreach (var network in ProxyTrust.Parse(config["TRUSTED_PROXIES"]))
            {
                options.KnownIPNetworks.Add(network);
            }
        });

        var app = builder.Build();
        app.UseForwardedHeaders();

        app.MapHealthChecks("/healthz");
        app.MapGet("/api/info", () => new ServerInfo("punchlist", Version, WorkspaceSchema.CurrentVersion));

        var webRoot = config["WEB_ROOT"] ?? Path.Combine(AppContext.BaseDirectory, "wwwroot");
        app.UseStaticSite(webRoot, app.Logger);
        return app;
    }
}

/// <summary>What clients check before syncing: which app and schema version this server runs.</summary>
public sealed record ServerInfo(string Name, string Version, int SchemaVersion);
