using System.Security.Claims;
using PeckList.Core;
using PeckList.Core.Accounts;
using PeckList.Core.Backup;
using PeckList.Server.Audit;
using PeckList.Server.Auth;

namespace PeckList.Server;

public sealed record BackupFile(string Name, DateTimeOffset Taken, long Size);

/// <summary>
/// <c>/api/admin/backups</c> and exports (spec: Backup and restore): the scheduled backups (list,
/// take one now, download), the whole server or one person as a download, and restoring one person
/// from an uploaded file or a backup already on the server. Backups hold password hashes, so every
/// one of these needs the backups permission and is logged. Whole-server backups also hold the keys
/// that sign sessions: downloading, exporting and restoring one is for super admins only
/// (<see cref="Permission.ManageSecurity"/>), and an admin exports and restores plain users only.
/// </summary>
public static class BackupEndpoints
{
    public static RouteGroupBuilder MapBackups(this RouteGroupBuilder admin)
    {
        admin.MapGet("/backups", (Snapshots snapshots) =>
            snapshots.List().Select(each => new BackupFile(Path.GetFileName(each.Path), each.Taken, new FileInfo(each.Path).Length)))
            .RequirePermission(Permission.ManageBackups);

        admin.MapPost("/backups", async (Snapshots snapshots, HttpContext context, CancellationToken cancellation) =>
        {
            var path = await snapshots.TakeAsync(ServerApp.Version, cancellation);
            context.Audit().On(null, Path.GetFileName(path));
            return Results.Ok(new { Name = Path.GetFileName(path) });
        }).RequirePermission(Permission.ManageBackups).Audited("backup.taken", targetRoute: null);

        admin.MapGet("/backups/{name}", (string name, Snapshots snapshots) =>
        {
            if (Find(snapshots, name) is not { } path) return Results.NotFound();
            return Results.File(path, path.EndsWith(".gz", StringComparison.Ordinal) ? "application/gzip" : "application/json", name);
        }).RequirePermission(Permission.ManageSecurity).Audited("backup.downloaded", "name", AuditTarget.Name);

        admin.MapGet("/export", async (HttpContext context, BackupService backup, TimeProvider time) =>
        {
            Attach(context, $"pecklist-{Stamp(time)}.json");
            await backup.ExportAsync(context.Response.Body, ServerApp.Version, context.RequestAborted);
        }).RequirePermission(Permission.ManageSecurity).Audited("backup.exported", targetRoute: null);

        admin.MapGet("/users/{id}/export", async (
            string id, ClaimsPrincipal user, HttpContext context, UserBackups users, IAccountStore accounts, TimeProvider time) =>
            await AdminEndpoints.OnAccountAsync(id, user, accounts, async account =>
            {
                Attach(context, $"pecklist-{account.Username}-{Stamp(time)}.json");
                await users.ExportAsync(id, context.Response.Body, ServerApp.Version, context.RequestAborted);
                return Results.Empty;
            }, context.RequestAborted)).RequirePermission(Permission.ManageBackups).Audited("backup.user-exported");

        // One person back as they were in a backup: an uploaded file (field "file") or a backup on
        // the server (field "backup"); from a whole-server backup, "username" says who.
        admin.MapPost("/users/restore", async (
            HttpRequest request, ClaimsPrincipal user, UserBackups users, Snapshots snapshots, CancellationToken cancellation) =>
        {
            var form = await request.ReadFormAsync(cancellation);
            if (OpenBackup(form, snapshots) is not { } input) return NoBackup();
            await using (input)
            {
                // A way back if the restore was not what was wanted.
                var safety = await snapshots.TakeAsync(ServerApp.Version, cancellation);
                try
                {
                    var result = await users.RestoreAsync(input, form["username"].FirstOrDefault(),
                        mayRestoreAdmins: user.AccountRole().Can(Permission.ManageAdmins), cancellation);
                    request.HttpContext.Audit().On(null, result.Username).Detail = $"safety backup {Path.GetFileName(safety)}";
                    return Results.Ok(result);
                }
                catch (RestoreRefusedException error)
                {
                    return Results.Json(new AdminError("admins_only_by_super_admins", error.Message), statusCode: StatusCodes.Status403Forbidden);
                }
                catch (BackupException error)
                {
                    return Results.BadRequest(new AdminError("bad_backup", error.Message));
                }
            }
        }).RequirePermission(Permission.ManageBackups).DisableAntiforgery().Audited("backup.user-restored", targetRoute: null);

        // The whole server back as a backup had it: checked now, restored at a restart (a safety
        // backup first). Devices notice the new epoch and start over from what the server has.
        admin.MapPost("/restore", async (
            HttpRequest request, PendingRestore pending, Snapshots snapshots, IHostApplicationLifetime lifetime, CancellationToken cancellation) =>
        {
            if (OpenBackup(await request.ReadFormAsync(cancellation), snapshots) is not { } input) return NoBackup();
            await using (input)
            {
                try
                {
                    await pending.ParkAsync(input, cancellation);
                }
                catch (BackupException error)
                {
                    return Results.BadRequest(new AdminError("bad_backup", error.Message));
                }
            }
            var safety = await snapshots.TakeAsync(ServerApp.Version, cancellation);
            request.HttpContext.Audit().Detail = $"safety backup {Path.GetFileName(safety)}; restarting";
            ServerApp.StopSoon(lifetime);
            return Results.Accepted(value: new { Safety = Path.GetFileName(safety) });
        }).RequirePermission(Permission.ManageSecurity).DisableAntiforgery().Audited("backup.server-restore-started", targetRoute: null);

        return admin;
    }

    /// <summary>A scheduled backup by its file name; nothing outside the backup folder.</summary>
    private static string? Find(Snapshots snapshots, string name) =>
        snapshots.List().Select(each => each.Path).FirstOrDefault(path => Path.GetFileName(path) == name);

    /// <summary>The backup a restore form names: an uploaded file (field "file") or one on the server (field "backup"); null for neither.</summary>
    private static Stream? OpenBackup(IFormCollection form, Snapshots snapshots)
    {
        if (form.Files["file"] is { } file) return Uncompressed(file.OpenReadStream());
        return form["backup"].FirstOrDefault() is { } name && Find(snapshots, name) is { } path ? Snapshots.OpenRead(path) : null;
    }

    /// <summary>An uploaded backup as JSON: a downloaded snapshot (<c>.json.gz</c>) is unpacked, plain JSON passes through.</summary>
    private static Stream Uncompressed(Stream upload)
    {
        Span<byte> magic = stackalloc byte[2];
        var read = upload.ReadAtLeast(magic, 2, throwOnEndOfStream: false);
        upload.Position = 0;
        return read == 2 && magic[0] == 0x1f && magic[1] == 0x8b
            ? new System.IO.Compression.GZipStream(upload, System.IO.Compression.CompressionMode.Decompress)
            : upload;
    }

    private static IResult NoBackup() => Results.BadRequest(new AdminError("no_backup", "upload a backup file or pick one on the server"));

    private static void Attach(HttpContext context, string name)
    {
        context.Response.ContentType = "application/json";
        context.Response.Headers.ContentDisposition = $"attachment; filename=\"{name}\"";
    }

    private static string Stamp(TimeProvider time) => time.FileStamp();
}
