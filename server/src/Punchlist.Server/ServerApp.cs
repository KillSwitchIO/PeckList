using System.Reflection;
using Microsoft.AspNetCore.HttpOverrides;
using Punchlist.Core;
using Punchlist.Core.Configuration;
using Punchlist.Core.Sync;
using Punchlist.Server.Auth;

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
        // Cookie keys sit in the database next to the data they protect; ASP.NET warns that they are
        // not encrypted at rest on every start, which only alarms self-hosters.
        builder.Logging.AddFilter("Microsoft.AspNetCore.DataProtection.KeyManagement.XmlKeyManager", LogLevel.Error);
        // Configuration holds the environment variables (and test overrides); NAME_FILE works too.
        var settings = ServerSettings.Read(
            new FileAwareSecretSource(key => config[key]),
            inContainer: config["DOTNET_RUNNING_IN_CONTAINER"] == "true");
        builder.Services.AddSingleton(settings);

        builder.Services.AddHealthChecks();
        builder.Services.AddEntityStore(settings);
        // After the store: its startup (migrations) runs before the admin is made.
        builder.Services.AddPunchlistAuth(settings);
        builder.Services.AddSingleton<SyncService>();
        builder.Services.AddBackups(settings);
        builder.Services.Configure<ForwardedHeadersOptions>(options =>
        {
            options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
            // Walk back through every trusted hop, not just the last one.
            options.ForwardLimit = null;
            options.KnownIPNetworks.Clear();
            options.KnownProxies.Clear();
            foreach (var network in ProxyTrust.Parse(settings.TrustedProxies))
            {
                options.KnownIPNetworks.Add(network);
            }
        });

        var app = builder.Build();
        app.UseForwardedHeaders();
        app.UseAuthentication();
        app.UseAuthorization();
        app.UseRateLimiter();

        app.MapHealthChecks("/healthz");
        app.MapGet("/api/info", () => new ServerInfo("punchlist", Version, WorkspaceSchema.CurrentVersion));
        app.MapAuth();
        app.MapGroup("/api").RequireAuthorization().RequirePasswordChanged().MapSync();

        var webRoot = settings.WebRoot ?? Path.Combine(AppContext.BaseDirectory, "wwwroot");
        app.UseStaticSite(webRoot, app.Logger);
        return app;
    }
}

/// <summary>What clients check before syncing: which app and schema version this server runs.</summary>
public sealed record ServerInfo(string Name, string Version, int SchemaVersion);
