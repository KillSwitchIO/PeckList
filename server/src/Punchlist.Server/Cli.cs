using Punchlist.Core.Accounts;
using Punchlist.Core.Backup;
using Punchlist.Core.Configuration;
using Punchlist.Core.Storage;
using Punchlist.Storage.Postgres;
using Punchlist.Storage.Sql;
using Punchlist.Storage.Sqlite;

namespace Punchlist.Server;

/// <summary>
/// The commands in the container (<c>docker exec &lt;container&gt; punchlist ...</c>). They read the
/// same settings as the server and work while it runs.
/// </summary>
public static class Cli
{
    public static readonly string[] Commands = ["export", "import", "migrate-db", "snapshot", "admin", "help", "--help", "-h"];

    public const string Usage = """
        Usage: punchlist <command>

          export [file]                 Write a full backup as JSON (to stdout without a file).
          import <file> [--replace]     Load a backup into an empty database (--replace: delete what is there first).
          migrate-db --to sqlite --path <file>
          migrate-db --to postgres --connection <connection string>
                                        Copy everything into another, empty database.
          snapshot                      Take a snapshot now (into SNAPSHOT_DIR).
          admin reset-password [user]   Give an account (default: admin) a new password to change at login.
          admin add-user <user> [--admin]
                                        Add an account; its generated password must be changed at first login.
          healthcheck                   Exit 0 when the running server answers /healthz.

        Settings come from the same environment variables as the server.
        """;

    public static async Task<int> RunAsync(string[] args, TextWriter output, TextWriter errors, Stream standardOutput, ServerSettings? settings = null)
    {
        var command = args.Length > 0 ? args[0] : "help";
        if (command is "help" or "--help" or "-h")
        {
            await output.WriteLineAsync(Usage);
            return 0;
        }
        try
        {
            settings ??= ServerSettings.Read(FileAwareSecretSource.FromEnvironment(),
                Environment.GetEnvironmentVariable("DOTNET_RUNNING_IN_CONTAINER") == "true");
            var (database, backup) = await OpenAsync(settings.DbProvider, settings.DbPath, settings.DbConnectionString, settings.DbMigrateOnStart);
            switch (command)
            {
                case "export":
                {
                    BackupSummary summary;
                    if (args.Length > 1)
                    {
                        await using var file = File.Create(args[1]);
                        summary = await backup.ExportAsync(file, ServerApp.Version);
                    }
                    else
                    {
                        summary = await backup.ExportAsync(standardOutput, ServerApp.Version);
                    }
                    await errors.WriteLineAsync($"Exported {summary.Accounts} accounts and {summary.Entities} entities.");
                    return 0;
                }
                case "import":
                {
                    var path = args.Skip(1).FirstOrDefault(arg => !arg.StartsWith("--", StringComparison.Ordinal));
                    if (path is null) return await Fail(errors, "import needs a file: punchlist import <file> [--replace]");
                    await using var file = File.OpenRead(path);
                    var summary = await backup.ImportAsync(file, replace: args.Contains("--replace"));
                    await output.WriteLineAsync($"Imported {summary.Accounts} accounts and {summary.Entities} entities.");
                    return 0;
                }
                case "migrate-db":
                    return await MigrateAsync(args, backup, output, errors);
                case "snapshot":
                {
                    var snapshots = new Snapshots(backup, settings.SnapshotDir, settings.SnapshotKeep, TimeProvider.System);
                    await output.WriteLineAsync($"Snapshot written to {await snapshots.TakeAsync(ServerApp.Version)}");
                    return 0;
                }
                case "admin" when args.Length > 1 && args[1] == "add-user":
                {
                    var username = args.Skip(2).FirstOrDefault(arg => !arg.StartsWith("--", StringComparison.Ordinal));
                    if (username is null) return await Fail(errors, "admin add-user needs a username: punchlist admin add-user <user> [--admin]");
                    var accounts = new AccountService(new SqlAccountStore(database), new AspNetPasswordHasher(), TimeProvider.System);
                    var password = Core.Ids.NewPassword();
                    var role = args.Contains("--admin") ? Role.Admin : Role.User;
                    await accounts.CreateUserAsync(username, password, role);
                    await output.WriteLineAsync($"Added {username.Trim().ToLowerInvariant()} ({role.ToString().ToLowerInvariant()}). Password: {password}");
                    await output.WriteLineAsync("It must be changed at the first login.");
                    return 0;
                }
                case "admin" when args.Length > 1 && args[1] == "reset-password":
                {
                    var username = args.Length > 2 ? args[2] : AccountService.AdminUsername;
                    var accounts = new AccountService(new SqlAccountStore(database), new AspNetPasswordHasher(), TimeProvider.System);
                    var password = await accounts.ResetPasswordAsync(username);
                    await output.WriteLineAsync($"New password for {username}: {password}");
                    await output.WriteLineAsync("It must be changed at the next login. Other sessions of this account have ended.");
                    return 0;
                }
                default:
                    return await Fail(errors, $"unknown command '{string.Join(' ', args)}'\n\n{Usage}");
            }
        }
        catch (Exception error) when (error is SettingsException or BackupException or IOException or UnauthorizedAccessException
            or KeyNotFoundException or ArgumentException or DuplicateUsernameException)
        {
            return await Fail(errors, error.Message);
        }
    }

    private static async Task<int> MigrateAsync(string[] args, BackupService source, TextWriter output, TextWriter errors)
    {
        string? Option(string name)
        {
            var index = Array.IndexOf(args, name);
            return index >= 0 && index + 1 < args.Length ? args[index + 1] : null;
        }
        var to = Option("--to");
        if (!Enum.TryParse<DbProvider>(to, ignoreCase: true, out var provider))
        {
            return await Fail(errors, "migrate-db needs --to sqlite or --to postgres");
        }
        var path = Option("--path");
        var connection = Option("--connection");
        if (provider == DbProvider.Sqlite && path is null) return await Fail(errors, "migrate-db --to sqlite needs --path <file>");
        if (provider == DbProvider.Postgres && connection is null) return await Fail(errors, "migrate-db --to postgres needs --connection <connection string>");

        var (_, target) = await OpenAsync(provider, path ?? "", connection, migrate: true);
        using var buffer = new MemoryStream();
        await source.ExportAsync(buffer, ServerApp.Version);
        buffer.Position = 0;
        var summary = await target.ImportAsync(buffer);
        await output.WriteLineAsync($"Copied {summary.Accounts} accounts and {summary.Entities} entities. Point DB_PROVIDER (and DB_PATH or DB_CONNECTION_STRING) at the new database and restart.");
        return 0;
    }

    private static async Task<(SqlDatabase, BackupService)> OpenAsync(DbProvider provider, string path, string? connection, bool migrate)
    {
        SqlDatabase database = provider == DbProvider.Postgres ? new PostgresDatabase(connection!) : new SqliteDatabase(path);
        if (migrate) await database.MigrateAsync();
        var backup = new BackupService(database, new SqlEntityStore(database), new SqlAccountStore(database), new SqlSecretStore(database), TimeProvider.System);
        return (database, backup);
    }

    private static async Task<int> Fail(TextWriter errors, string message)
    {
        await errors.WriteLineAsync(message);
        return 1;
    }
}
