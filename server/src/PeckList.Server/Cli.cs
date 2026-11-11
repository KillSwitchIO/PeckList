using PeckList.Core.Accounts;
using PeckList.Core.Backup;
using PeckList.Core.Configuration;
using PeckList.Core.Storage;
using PeckList.Storage.Postgres;
using PeckList.Storage.Sql;
using PeckList.Storage.Sqlite;
using PeckList.Server.Logging;

namespace PeckList.Server;

/// <summary>
/// The commands in the container (<c>docker exec &lt;container&gt; pecklist ...</c>). They read the
/// same settings as the server and work while it runs.
/// </summary>
public static class Cli
{
    public static readonly string[] Commands = ["export", "import", "migrate-db", "upgrade-db", "snapshot", "admin", "oidc", "config", "debug-dump", "help", "--help", "-h"];

    public const string Usage = """
        Usage: pecklist <command>

          export [file]                 Write a full backup as JSON (to stdout without a file).
          export --user <user> [file]   Write one person's data (to stdout without a file).
          import <file> [--replace] [--shift-dates]
                                        Load a backup into an empty database (--replace: delete what is
                                        there first; --shift-dates: move its dates on by the days since
                                        it was made, for a demo seed).
          import --user <file> [user]   Put one person back as a backup had them (from a whole-server
                                        backup, say who). Restart the server afterwards.
          migrate-db --to sqlite --path <file>
          migrate-db --to postgres --connection <connection string>
                                        Copy everything into another, empty database.
          upgrade-db                    Apply database schema upgrades and exit (for servers
                                        running with DB_MIGRATE_ON_START=false).
          snapshot                      Take a snapshot now (into SNAPSHOT_DIR).
          admin reset-password [user]   Give an account (default: admin) a new password to change at login.
          admin add-user <user> [--admin]
                                        Add an account; its generated password must be changed at first login.
          admin set-role <user> <role>  Make an account a user, admin or superadmin.
          admin login-link <user>       Print a one-time sign-in link (24 hours).
          oidc unlink <user> [provider] Detach a user's provider accounts (all, or one provider's).
          oidc unbind-all <provider>    Detach every account from a provider (moving to another).
          oidc migration-window <provider> <hours|close>
                                        Until it closes, a first sign-in through the provider joins
                                        the account with the same username.
          config key                    Print a new CONFIG_KEY for encrypted values.
          config encrypt [value]        Print the value (or standard input) encrypted with CONFIG_KEY,
                                        for the environment or CONFIG_FILE: enc:v1:...
          config show                   Every setting with where it comes from (secrets hidden).
          debug-dump [file]             Write a zip for bug reports: recent logs, settings (secrets
                                        hidden), versions and database counts (stdout without a file).
          healthcheck                   Exit 0 when the running server answers /healthz.
          --version                     Print the version and build.

        Settings come from the same environment variables as the server.
        """;

    public static async Task<int> RunAsync(
        string[] args, TextWriter output, TextWriter errors, Stream standardOutput, ServerSettings? settings = null,
        ISecretSource? environment = null, TextReader? input = null)
    {
        var command = args.Length > 0 ? args[0] : "help";
        if (command is "help" or "--help" or "-h")
        {
            await output.WriteLineAsync(Usage);
            return 0;
        }
        environment ??= FileAwareSecretSource.FromEnvironment();
        var inContainer = Environment.GetEnvironmentVariable("DOTNET_RUNNING_IN_CONTAINER") == "true";
        try
        {
            // These work before (and without) a working configuration.
            if (command == "config") return await ConfigAsync(args, environment, inContainer, output, errors, input ?? Console.In);
            settings ??= SettingsLoader.Load(environment, inContainer).Settings;
            var (database, backup) = await OpenAsync(
                settings.DbProvider, settings.DbPath, settings.DbConnectionString, settings.DbMigrateOnStart || command == "upgrade-db");
            switch (command)
            {
                case "upgrade-db":
                    await output.WriteLineAsync($"The {settings.DbProvider.ToString().ToLowerInvariant()} database is up to date for PeckList {ServerApp.Version}.");
                    return 0;
                case "export" when args.Contains("--user"):
                case "import" when args.Contains("--user"):
                    return await UserBackupAsync(command, [.. args.Skip(1).Where(arg => arg != "--user")], database, output, errors, standardOutput);
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
                    if (path is null) return await Fail(errors, "import needs a file: pecklist import <file> [--replace] [--shift-dates]");
                    await using var file = Snapshots.OpenRead(path);
                    var summary = await backup.ImportAsync(file, replace: args.Contains("--replace"), shiftDates: args.Contains("--shift-dates"));
                    await output.WriteLineAsync($"Imported {summary.Accounts} accounts and {summary.Entities} entities.");
                    return 0;
                }
                case "migrate-db":
                    return await MigrateAsync(args, backup, output, errors);
                case "debug-dump":
                {
                    var loaded = SettingsLoader.Load(environment, inContainer);
                    var dump = new DebugDump(loaded.Layers, settings, database, inContainer, TimeProvider.System)
                    {
                        Snapshots = new Snapshots(backup, settings.SnapshotDir, () => settings.SnapshotKeep, TimeProvider.System, () => settings.SnapshotKeepWeekly),
                        MadeBy = "cli",
                    };
                    if (args.Length > 1)
                    {
                        await using (var file = File.Create(args[1])) await dump.WriteAsync(file);
                        await errors.WriteLineAsync($"Debug dump written to {args[1]}.");
                    }
                    else
                    {
                        await dump.WriteAsync(standardOutput);
                    }
                    return 0;
                }
                case "snapshot":
                {
                    var snapshots = new Snapshots(backup, settings.SnapshotDir, () => settings.SnapshotKeep, TimeProvider.System, () => settings.SnapshotKeepWeekly);
                    await output.WriteLineAsync($"Snapshot written to {await snapshots.TakeAsync(ServerApp.Version)}");
                    return 0;
                }
                case "admin" when args.Length > 1 && args[1] == "add-user":
                {
                    var username = args.Skip(2).FirstOrDefault(arg => !arg.StartsWith("--", StringComparison.Ordinal));
                    if (username is null) return await Fail(errors, "admin add-user needs a username: pecklist admin add-user <user> [--admin]");
                    var accounts = Accounts(database);
                    var password = Core.Ids.NewPassword();
                    var role = args.Contains("--admin") ? Role.Admin : Role.User;
                    var added = await accounts.CreateUserAsync(username, password, role);
                    await RecordAsync(database, "admin.user-created", added, role.Name());
                    await output.WriteLineAsync($"Added {username.Trim().ToLowerInvariant()} ({role.Name()}). Password: {password}");
                    await output.WriteLineAsync("It must be changed at the first login.");
                    return 0;
                }
                case "admin" when args.Length > 1 && args[1] == "set-role":
                {
                    if (args.Length < 4 || !Roles.TryParse(args[3], out var role))
                    {
                        return await Fail(errors, "admin set-role needs a user and a role: pecklist admin set-role <user> <user|admin|superadmin>");
                    }
                    var account = await UserAsync(database, args[2]);
                    await Accounts(database).SetRoleAsync(account.Id, role);
                    await RecordAsync(database, "admin.role-changed", account, $"{account.Role.Name()} to {role.Name()}");
                    await output.WriteLineAsync($"{account.Username} is now {role.Name()}. It applies from their next request.");
                    return 0;
                }
                case "admin" when args.Length > 1 && args[1] == "login-link":
                {
                    if (args.Length < 3) return await Fail(errors, "admin login-link needs a user: pecklist admin login-link <user>");
                    var account = await UserAsync(database, args[2]);
                    var (token, expires) = await new LoginLinks(new SqlSecretStore(database), new SqlAccountStore(database), TimeProvider.System).CreateAsync(account.Id);
                    await RecordAsync(database, "admin.login-link-created", account, $"until {expires:yyyy-MM-dd HH:mm} UTC");
                    var origin = settings.PublicUrl?.ToString().TrimEnd('/') ?? "<server address>";
                    await output.WriteLineAsync($"{origin}/auth/link/{token}");
                    await output.WriteLineAsync($"Signs {account.Username} in once, until {expires:yyyy-MM-dd HH:mm} UTC.");
                    return 0;
                }
                case "oidc":
                    return await OidcAsync(args, database, output, errors);
                case "admin" when args.Length > 1 && args[1] == "reset-password":
                {
                    var username = args.Length > 2 ? args[2] : AccountService.AdminUsername;
                    var password = await Accounts(database).ResetPasswordAsync(username);
                    await RecordAsync(database, "admin.password-reset", await UserAsync(database, username));
                    await output.WriteLineAsync($"New password for {username}: {password}");
                    await output.WriteLineAsync("It must be changed at the next login. Other sessions of this account have ended.");
                    return 0;
                }
                default:
                    return await Fail(errors, $"unknown command '{string.Join(' ', args)}'\n\n{Usage}");
            }
        }
        catch (Exception error) when (error is SettingsException or BackupException or IOException or UnauthorizedAccessException
            or KeyNotFoundException or ArgumentException or DuplicateUsernameException or LastSuperAdminException or NewerDatabaseException)
        {
            return await Fail(errors, error.Message);
        }
    }

    private static async Task<int> ConfigAsync(
        string[] args, ISecretSource environment, bool inContainer, TextWriter output, TextWriter errors, TextReader input)
    {
        switch (args.Length > 1 ? args[1] : "")
        {
            case "key":
                await output.WriteLineAsync(ConfigCipher.NewKeyText());
                await errors.WriteLineAsync("Keep it in a Docker secret and point CONFIG_KEY_FILE at it.");
                return 0;
            case "encrypt":
            {
                if (environment.Get("CONFIG_KEY") is not { } key) return await Fail(errors, "config encrypt needs CONFIG_KEY (or CONFIG_KEY_FILE)");
                var value = args.Length > 2 ? args[2] : (await input.ReadToEndAsync()).TrimEnd('\r', '\n');
                if (value.Length == 0) return await Fail(errors, "config encrypt needs a value: pecklist config encrypt <value>");
                await output.WriteLineAsync(ConfigCipher.FromText(key).Encrypt(value));
                return 0;
            }
            case "show":
            {
                var loaded = SettingsLoader.Load(environment, inContainer);
                var layers = loaded.Layers;
                foreach (var definition in SettingsCatalog.For(layers))
                {
                    var (value, source) = layers.Explain(definition.Key);
                    var shown = value is null ? $"(default: {definition.Default ?? "none"})"
                        : definition.Kind == SettingKind.Secret ? SettingsEndpoints.Hidden : value;
                    await output.WriteLineAsync($"{definition.Key,-28} {shown}  [{source.ToString().ToLowerInvariant()}]");
                }
                if (loaded.PageProblem is { } problem) await output.WriteLineAsync($"Page values not used: {problem}");
                return 0;
            }
            default:
                return await Fail(errors, $"unknown config command\n\n{Usage}");
        }
    }

    private static async Task<int> OidcAsync(string[] args, SqlDatabase database, TextWriter output, TextWriter errors)
    {
        var store = new SqlAccountStore(database);
        var signIn = new ExternalSignIn(store, Accounts(database),
            new SqlIdentityStore(database), new SqlServerGroupStore(database), new SqlSecretStore(database), TimeProvider.System);
        switch (args.Length > 1 ? args[1] : "")
        {
            case "unlink" when args.Length > 2:
            {
                var account = await UserAsync(database, args[2]);
                var gone = 0;
                foreach (var identity in await signIn.IdentitiesOfAsync(account.Id))
                {
                    if (args.Length > 3 && identity.Provider != args[3]) continue;
                    await signIn.UnlinkAsync(account.Id, identity.Provider, identity.Subject, selfService: false);
                    await RecordAsync(database, "admin.identity-unlinked", account, identity.Provider);
                    gone++;
                }
                await output.WriteLineAsync($"Detached {gone} provider account(s) from {account.Username}.");
                if (!await signIn.CanSignInAsync((await store.FindByIdAsync(account.Id))!))
                {
                    await output.WriteLineAsync($"{account.Username} has no way to sign in now: give them a link with pecklist admin login-link {account.Username}");
                }
                return 0;
            }
            case "unbind-all" when args.Length > 2:
            {
                var (unbound, stranded) = await signIn.UnbindProviderAsync(args[2]);
                await RecordAsync(database, "admin.provider-unbound", null, $"{args[2]}, {unbound} accounts");
                await output.WriteLineAsync($"Detached {unbound} account(s) from {args[2]}.");
                if (stranded.Count > 0)
                {
                    await output.WriteLineAsync($"No way to sign in now: {string.Join(", ", stranded)}. Open a migration window on the new provider, or give them login links.");
                }
                return 0;
            }
            case "migration-window" when args.Length > 3:
                if (args[3] == "close")
                {
                    await signIn.CloseMigrationWindowAsync(args[2]);
                    await RecordAsync(database, "admin.migration-window-closed", null, args[2]);
                    await output.WriteLineAsync($"Migration window for {args[2]} closed.");
                    return 0;
                }
                if (!double.TryParse(args[3], System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var hours)
                    || hours <= 0 || hours > 24 * 30)
                {
                    return await Fail(errors, "the window needs a number of hours (up to 720) or close");
                }
                var until = await signIn.OpenMigrationWindowAsync(args[2], TimeSpan.FromHours(hours));
                await RecordAsync(database, "admin.migration-window-opened", null, $"{args[2]}, until {until:yyyy-MM-dd HH:mm} UTC");
                await output.WriteLineAsync($"Until {until:yyyy-MM-dd HH:mm} UTC, a first sign-in through {args[2]} joins the account with the same username.");
                return 0;
            default:
                return await Fail(errors, $"unknown oidc command\n\n{Usage}");
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
        var backup = new BackupService(database, new SqlEntityStore(database), new SqlAccountStore(database),
            new SqlServerGroupStore(database), new SqlIdentityStore(database), new SqlSecretStore(database), TimeProvider.System);
        return (database, backup);
    }

    /// <summary>One person's data: <c>export --user &lt;user&gt; [file]</c>, <c>import --user &lt;file&gt; [user]</c>.</summary>
    private static async Task<int> UserBackupAsync(
        string command, string[] rest, SqlDatabase database, TextWriter output, TextWriter errors, Stream standardOutput)
    {
        var accounts = new SqlAccountStore(database);
        var entities = new SqlEntityStore(database);
        var sharing = new Core.Sharing.SharingState();
        await sharing.LoadAsync(entities, (await accounts.ListAsync()).Select(account => account.Id));
        var sync = new Core.Sync.SyncService(entities, TimeProvider.System, new Core.Sync.InProcessChangeNotifier(), sharing);
        var users = new UserBackups(entities, accounts, new SqlIdentityStore(database), sync, new Core.Sync.ServerClock(TimeProvider.System), TimeProvider.System);
        if (command == "export")
        {
            if (rest.Length == 0) return await Fail(errors, "export --user needs a username: pecklist export --user <user> [file]");
            var account = await UserAsync(database, rest[0]);
            int count;
            if (rest.Length > 1)
            {
                await using var file = File.Create(rest[1]);
                count = await users.ExportAsync(account.Id, file, ServerApp.Version);
            }
            else
            {
                count = await users.ExportAsync(account.Id, standardOutput, ServerApp.Version);
            }
            await errors.WriteLineAsync($"Exported {account.Username}: {count} entities.");
            return 0;
        }
        if (rest.Length == 0) return await Fail(errors, "import --user needs a file: pecklist import --user <file> [user]");
        await using (var file = Snapshots.OpenRead(rest[0]))
        {
            var result = await users.RestoreAsync(file, rest.Length > 1 ? rest[1] : null, mayRestoreAdmins: true);
            await output.WriteLineAsync(
                $"{result.Username} {(result.Created ? "added" : "restored")}: {result.Restored} restored, {result.Removed} removed, {result.Dropped} left out.");
        }
        // The running server keeps who-sees-what in memory: it reads it again at its next start.
        await output.WriteLineAsync("Restart the server so it picks up the change.");
        return 0;
    }

    private static async Task<int> Fail(TextWriter errors, string message)
    {
        await errors.WriteLineAsync(message);
        return 1;
    }

    /// <summary>
    /// A shell command that changed an account or sign-in leaves an event like the admin pages' own,
    /// by "shell" (audit Y3). Someone with a shell could change the database anyway; this is for an
    /// operator explaining later what happened.
    /// </summary>
    private static Task RecordAsync(SqlDatabase database, string type, Account? target, string? detail = null) =>
        new SqlAuditStore(database).AppendAsync(
        [
            new Core.Audit.AuditEntry
            {
                Id = Core.Ids.NewUlid(TimeProvider.System),
                Time = TimeProvider.System.GetUtcNow(),
                Kind = Core.Audit.AuditKind.Event,
                Type = type,
                Outcome = Core.Audit.AuditOutcome.Ok,
                ActorName = ShellActor,
                TargetId = target?.Id,
                TargetName = target?.Username,
                Detail = detail,
            },
        ]);

    /// <summary>Who the audit log says made a change from the shell.</summary>
    public const string ShellActor = "shell";

    private static AccountService Accounts(SqlDatabase database) =>
        new(new SqlAccountStore(database), new AspNetPasswordHasher(), TimeProvider.System);

    /// <exception cref="KeyNotFoundException">No account has that username.</exception>
    private static async Task<Account> UserAsync(SqlDatabase database, string username) =>
        await new SqlAccountStore(database).FindByUsernameAsync(username) ?? throw new KeyNotFoundException($"no user '{username}'");
}
