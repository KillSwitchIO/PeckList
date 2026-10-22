using System.Globalization;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using Punchlist.Core.Accounts;
using Punchlist.Core.Backup;
using Punchlist.Core.Storage;
using Punchlist.Server.Audit;
using Punchlist.Server.Auth;
using Punchlist.Server.Logging;

namespace Punchlist.Server;

public sealed record LoggingView(string Level, IReadOnlyDictionary<string, string> Overrides, IReadOnlyList<LogTargetStatus> Outputs);

/// <summary><c>/api/admin/logging</c>: how each log output is doing, and the debug dump download.</summary>
public static class LoggingEndpoints
{
    public static RouteGroupBuilder MapLogging(this RouteGroupBuilder admin)
    {
        admin.MapGet("/logging", (LogPipeline pipeline) => new LoggingView(
            pipeline.Settings.Level.ToString().ToLowerInvariant(),
            pipeline.Settings.Overrides.ToDictionary(pair => pair.Key, pair => pair.Value.ToString().ToLowerInvariant()),
            pipeline.Status))
            .RequirePermission(Permission.ViewLogs);

        admin.MapGet("/debug-dump", async (
            HttpContext context, LoadedSettings loaded, ISecretStore secrets, IDatabase database, LogPipeline pipeline,
            HealthCheckService health, Snapshots snapshots, TimeProvider time) =>
        {
            var cancellation = context.RequestAborted;
            var layers = loaded.Layers.WithPage(await SettingsLoader.ReadPageAsync(secrets, cancellation));
            var dump = new DebugDump(layers, loaded.Settings, database, loaded.InContainer, time)
            {
                Pipeline = pipeline,
                Health = health,
                Snapshots = snapshots,
            };
            // A zip is written synchronously at the end; build it in a temporary file first.
            var file = new FileStream(Path.GetTempFileName(), FileMode.Create, FileAccess.ReadWrite, FileShare.None, 81920, FileOptions.DeleteOnClose);
            await dump.WriteAsync(file, cancellation);
            file.Position = 0;
            var name = $"punchlist-debug-{time.GetUtcNow().ToString("yyyyMMdd-HHmmss", CultureInfo.InvariantCulture)}.zip";
            return Results.File(file, "application/zip", name);
        }).RequirePermission(Permission.ViewLogs).Audited("logs.debug-dump", targetRoute: null);

        return admin;
    }
}
