using System.Globalization;
using System.Security.Claims;
using Punchlist.Core.Accounts;
using Punchlist.Core.Backup;
using Punchlist.Server.Auth;

namespace Punchlist.Server;

public sealed record BackupFile(string Name, DateTimeOffset Taken, long Size);

/// <summary>
/// <c>/api/admin/backups</c> and exports (spec: Backup and restore): the scheduled backups (list,
/// take one now, download), the whole server or one person as a download, and restoring one person
/// from an uploaded file or a backup already on the server. Backups hold password hashes, so every
/// one of these needs the backups permission and is logged.
/// </summary>
public static class BackupEndpoints
{
    public static RouteGroupBuilder MapBackups(this RouteGroupBuilder admin)
    {
        admin.MapGet("/backups", (Snapshots snapshots) =>
            snapshots.List().Select(each => new BackupFile(Path.GetFileName(each.Path), each.Taken, new FileInfo(each.Path).Length)))
            .RequirePermission(Permission.ManageBackups);

        admin.MapPost("/backups", async (Snapshots snapshots, ClaimsPrincipal user, ILoggerFactory logs, CancellationToken cancellation) =>
        {
            var path = await snapshots.TakeAsync(ServerApp.Version, cancellation);
            Log(logs, "{Admin} took a backup: {Name}", user, Path.GetFileName(path));
            return Results.Ok(new { Name = Path.GetFileName(path) });
        }).RequirePermission(Permission.ManageBackups);

        admin.MapGet("/backups/{name}", (string name, Snapshots snapshots, ClaimsPrincipal user, ILoggerFactory logs) =>
        {
            if (Find(snapshots, name) is not { } path) return Results.NotFound();
            Log(logs, "{Admin} downloaded the backup {Name}", user, name);
            return Results.File(path, "application/json", name);
        }).RequirePermission(Permission.ManageBackups);

        admin.MapGet("/export", async (HttpContext context, BackupService backup, ClaimsPrincipal user, ILoggerFactory logs, TimeProvider time) =>
        {
            Log(logs, "{Admin} exported the whole server", user, "");
            Attach(context, $"punchlist-{Stamp(time)}.json");
            await backup.ExportAsync(context.Response.Body, ServerApp.Version, context.RequestAborted);
        }).RequirePermission(Permission.ManageBackups);

        admin.MapGet("/users/{id}/export", async (
            string id, HttpContext context, UserBackups users, IAccountStore accounts, ClaimsPrincipal user, ILoggerFactory logs, TimeProvider time) =>
        {
            if (await accounts.FindByIdAsync(id, context.RequestAborted) is not { } account) return Results.NotFound();
            Log(logs, "{Admin} exported {Name}", user, account.Username);
            Attach(context, $"punchlist-{account.Username}-{Stamp(time)}.json");
            await users.ExportAsync(id, context.Response.Body, ServerApp.Version, context.RequestAborted);
            return Results.Empty;
        }).RequirePermission(Permission.ManageBackups);

        // One person back as they were in a backup: an uploaded file (field "file") or a backup on
        // the server (field "backup"); from a whole-server backup, "username" says who.
        admin.MapPost("/users/restore", async (
            HttpRequest request, UserBackups users, Snapshots snapshots, ClaimsPrincipal user, ILoggerFactory logs, CancellationToken cancellation) =>
        {
            var form = await request.ReadFormAsync(cancellation);
            Stream input;
            if (form.Files["file"] is { } file) input = file.OpenReadStream();
            else if (form["backup"].FirstOrDefault() is { } name && Find(snapshots, name) is { } path) input = File.OpenRead(path);
            else return Results.BadRequest(new AdminError("no_backup", "upload a backup file or pick one on the server"));
            await using (input)
            {
                // A way back if the restore was not what was wanted.
                var safety = await snapshots.TakeAsync(ServerApp.Version, cancellation);
                try
                {
                    var result = await users.RestoreAsync(input, form["username"].FirstOrDefault(), cancellation);
                    Log(logs, "{Admin} restored {Name} (safety backup " + Path.GetFileName(safety) + ")", user, result.Username);
                    return Results.Ok(result);
                }
                catch (BackupException error)
                {
                    return Results.BadRequest(new AdminError("bad_backup", error.Message));
                }
            }
        }).RequirePermission(Permission.ManageBackups).DisableAntiforgery();

        return admin;
    }

    /// <summary>A scheduled backup by its file name; nothing outside the backup folder.</summary>
    private static string? Find(Snapshots snapshots, string name) =>
        snapshots.List().Select(each => each.Path).FirstOrDefault(path => Path.GetFileName(path) == name);

    private static void Attach(HttpContext context, string name)
    {
        context.Response.ContentType = "application/json";
        context.Response.Headers.ContentDisposition = $"attachment; filename=\"{name}\"";
    }

    private static string Stamp(TimeProvider time) => time.GetUtcNow().ToString("yyyyMMdd-HHmmss", CultureInfo.InvariantCulture);

    private static void Log(ILoggerFactory logs, string message, ClaimsPrincipal user, string detail) =>
        logs.CreateLogger("Punchlist.Backups").LogWarning(message, user.FindFirstValue(ClaimTypes.Name), detail);
}
