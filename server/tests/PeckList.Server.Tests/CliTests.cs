using System.Text;
using PeckList.Core.Backup;
using PeckList.Core.Configuration;

namespace PeckList.Server.Tests;

public sealed class CliTests : IDisposable
{
    private readonly string folder = Directory.CreateTempSubdirectory("punchlist-cli-").FullName;

    public void Dispose()
    {
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        Directory.Delete(folder, recursive: true);
    }

    private ServerSettings Settings(string db = "punchlist.db") => new()
    {
        DbPath = Path.Combine(folder, db),
        SnapshotDir = Path.Combine(folder, "snapshots"),
        SnapshotKeep = 2,
    };

    private static async Task<(int Code, string Output, string Errors, string Stdout)> Run(ServerSettings settings, params string[] args)
    {
        var output = new StringWriter();
        var errors = new StringWriter();
        using var stdout = new MemoryStream();
        var code = await Cli.RunAsync(args, output, errors, stdout, settings);
        return (code, output.ToString(), errors.ToString(), Encoding.UTF8.GetString(stdout.ToArray()));
    }

    [Fact]
    public async Task Prints_help()
    {
        var (code, output, _, _) = await Run(Settings(), "help");
        Assert.Equal(0, code);
        Assert.Contains("admin reset-password", output);
    }

    [Fact]
    public async Task Names_an_unknown_command()
    {
        var (code, _, errors, _) = await Run(Settings(), "admin", "frobnicate");
        Assert.Equal(1, code);
        Assert.Contains("unknown command 'admin frobnicate'", errors);
    }

    [Fact]
    public async Task Upgrade_db_brings_the_schema_up_to_date_even_when_start_up_may_not()
    {
        var settings = Settings() with { DbMigrateOnStart = false };
        var (code, output, _, _) = await Run(settings, "upgrade-db");
        Assert.Equal(0, code);
        Assert.Contains("database is up to date", output);
        await using var connection = new Microsoft.Data.Sqlite.SqliteConnection($"Data Source={settings.DbPath}");
        await connection.OpenAsync(TestContext.Current.CancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT COUNT(*) FROM schema_migrations";
        Assert.True((long)(await command.ExecuteScalarAsync(TestContext.Current.CancellationToken))! > 0);
    }

    [Fact]
    public async Task Exports_imports_and_snapshots()
    {
        var settings = Settings();
        // Nothing in the database yet: no admin to reset.
        var reset = await Run(settings, "admin", "reset-password");
        Assert.Equal(1, reset.Code);
        Assert.Contains("no user 'admin'", reset.Errors);
        await MakeAdminAsync(settings);

        var export = await Run(settings, "export");
        Assert.Equal(0, export.Code);
        Assert.Contains(BackupService.Format, export.Stdout);
        Assert.Contains("Exported 1 accounts and 0 entities", export.Errors);

        var file = Path.Combine(folder, "backup.json");
        Assert.Equal(0, (await Run(settings, "export", file)).Code);
        var import = await Run(Settings("other.db"), "import", file);
        Assert.Equal(0, import.Code);
        Assert.Contains("Imported 1 accounts", import.Output);
        var again = await Run(settings, "import", file);
        Assert.Equal(1, again.Code);
        Assert.Contains("--replace", again.Errors);
        Assert.Equal(0, (await Run(settings, "import", file, "--replace")).Code);

        for (var index = 0; index < 3; index++)
        {
            Assert.Equal(0, (await Run(settings, "snapshot")).Code);
            // Snapshot names carry the second they were taken.
            await Task.Delay(1100, TestContext.Current.CancellationToken);
        }
        // SNAPSHOT_KEEP=2.
        Assert.Equal(2, Directory.GetFiles(Path.Combine(folder, "snapshots"), "punchlist-*.json").Length);
    }

    private static async Task<Core.Accounts.AccountService> MakeAdminAsync(ServerSettings settings)
    {
        var database = new PeckList.Storage.Sqlite.SqliteDatabase(settings.DbPath);
        await database.MigrateAsync(TestContext.Current.CancellationToken);
        var accounts = new Core.Accounts.AccountService(new PeckList.Storage.Sql.SqlAccountStore(database), new AspNetPasswordHasher(), TimeProvider.System);
        await accounts.EnsureAdminAsync("correct horse battery", TestContext.Current.CancellationToken);
        return accounts;
    }

    [Fact]
    public async Task Resets_a_password_that_must_then_change()
    {
        var settings = Settings();
        var accounts = await MakeAdminAsync(settings);

        var (code, output, _, _) = await Run(settings, "admin", "reset-password");
        Assert.Equal(0, code);
        var password = output.Split('\n')[0].Split(": ")[1].Trim();
        var login = await accounts.LoginAsync("admin", password, TestContext.Current.CancellationToken);
        var success = Assert.IsType<Core.Accounts.LoginResult.Success>(login);
        Assert.True(success.Account.MustChangePassword);
    }

    [Fact]
    public async Task A_file_problem_is_one_line_not_a_crash()
    {
        var (code, _, errors, _) = await Run(Settings(), "export", Path.Combine(folder, "missing", "folder", "backup.json"));
        Assert.Equal(1, code);
        Assert.Contains("Could not find a part of the path", errors);
        Assert.DoesNotContain(" at ", errors);
    }

    [Fact]
    public async Task Adds_users_who_must_change_their_password()
    {
        var settings = Settings();
        var accounts = await MakeAdminAsync(settings);
        var (code, output, _, _) = await Run(settings, "admin", "add-user", "Sam");
        Assert.Equal(0, code);
        Assert.StartsWith("Added sam (user). Password: ", output);
        var password = output.Split('\n')[0].Split("Password: ")[1].Trim();
        var login = Assert.IsType<Core.Accounts.LoginResult.Success>(await accounts.LoginAsync("sam", password, TestContext.Current.CancellationToken));
        Assert.True(login.Account.MustChangePassword);

        var admin = await Run(settings, "admin", "add-user", "--admin", "jo");
        Assert.StartsWith("Added jo (admin)", admin.Output);
        var taken = await Run(settings, "admin", "add-user", "SAM");
        Assert.Equal(1, taken.Code);
        Assert.Contains("taken", taken.Errors);
        Assert.Contains("needs a username", (await Run(settings, "admin", "add-user")).Errors);
    }

    [Fact]
    public async Task Set_role_changes_a_role_but_never_the_last_super_admin()
    {
        var settings = Settings();
        await MakeAdminAsync(settings);
        await Run(settings, "admin", "add-user", "sam");
        var promoted = await Run(settings, "admin", "set-role", "Sam", "super-admin");
        Assert.Equal(0, promoted.Code);
        Assert.StartsWith("sam is now superadmin.", promoted.Output);

        Assert.Equal(0, (await Run(settings, "admin", "set-role", "admin", "user")).Code);
        var refused = await Run(settings, "admin", "set-role", "sam", "admin");
        Assert.Equal(1, refused.Code);
        Assert.Contains("at least one active super admin", refused.Errors);
        Assert.Contains("needs a user and a role", (await Run(settings, "admin", "set-role", "sam", "owner")).Errors);
        Assert.Contains("no user", (await Run(settings, "admin", "set-role", "nobody", "user")).Errors);
    }

    [Fact]
    public async Task Oidc_commands_unbind_open_windows_and_hand_out_links()
    {
        var token = TestContext.Current.CancellationToken;
        var settings = Settings() with { PublicUrl = new Uri("https://tasks.example.com") };
        await MakeAdminAsync(settings);
        var database = new PeckList.Storage.Sqlite.SqliteDatabase(settings.DbPath);
        var store = new PeckList.Storage.Sql.SqlAccountStore(database);
        var kim = await new Core.Accounts.AccountService(store, new AspNetPasswordHasher(), TimeProvider.System).CreateWithoutPasswordAsync("kim", token);
        var identities = new PeckList.Storage.Sql.SqlIdentityStore(database);
        await identities.LinkAsync(new Core.Accounts.LinkedIdentity
        {
            Provider = "pocket",
            Subject = "kim-sub",
            AccountId = kim.Id,
            LinkedAt = DateTimeOffset.UtcNow,
            LastUsedAt = DateTimeOffset.UtcNow,
        }, token);

        var unbound = await Run(settings, "oidc", "unbind-all", "pocket");
        Assert.Equal(0, unbound.Code);
        Assert.Contains("Detached 1 account(s) from pocket.", unbound.Output);
        Assert.Contains("No way to sign in now: kim.", unbound.Output);
        Assert.Empty(await identities.ListAsync(token));

        var window = await Run(settings, "oidc", "migration-window", "keycloak", "12");
        Assert.Equal(0, window.Code);
        Assert.Contains("joins the account with the same username", window.Output);
        Assert.Contains("closed", (await Run(settings, "oidc", "migration-window", "keycloak", "close")).Output);
        Assert.Contains("hours", (await Run(settings, "oidc", "migration-window", "keycloak", "soon")).Errors);

        var link = await Run(settings, "admin", "login-link", "kim");
        Assert.Equal(0, link.Code);
        Assert.StartsWith("https://tasks.example.com/auth/link/", link.Output);
        var redeemed = await new Core.Accounts.LoginLinks(new PeckList.Storage.Sql.SqlSecretStore(database), store, TimeProvider.System)
            .RedeemAsync(link.Output.Split(Environment.NewLine)[0].Trim().Split("/auth/link/")[1], token);
        Assert.Equal(kim.Id, redeemed?.Id);
        Assert.Contains("unknown oidc command", (await Run(settings, "oidc", "nope")).Errors);
    }

    [Fact]
    public async Task Config_makes_keys_encrypts_values_and_shows_where_settings_come_from()
    {
        async Task<(int Code, string Output, string Errors)> Config(Dictionary<string, string> env, params string[] args)
        {
            var output = new StringWriter();
            var errors = new StringWriter();
            var code = await Cli.RunAsync(args, output, errors, Stream.Null, null,
                new FileAwareSecretSource(name => env.GetValueOrDefault(name)), new StringReader("from stdin" + Environment.NewLine));
            return (code, output.ToString(), errors.ToString());
        }
        var (code, key, _) = await Config([], "config", "key");
        Assert.Equal(0, code);
        var cipher = ConfigCipher.FromText(key.Trim());

        var env = new Dictionary<string, string> { ["CONFIG_KEY"] = key.Trim(), ["DB_PATH"] = Path.Combine(folder, "show.db"), ["REGISTRATION"] = "open" };
        var sealedArg = (await Config(env, "config", "encrypt", "s3cret")).Output.Trim();
        Assert.Equal("s3cret", cipher.Decrypt(sealedArg, "x"));
        Assert.Equal("from stdin", cipher.Decrypt((await Config(env, "config", "encrypt")).Output.Trim(), "x"));
        Assert.Contains("needs CONFIG_KEY", (await Config([], "config", "encrypt", "x")).Errors);

        env["ADMIN_PASSWORD"] = cipher.Encrypt("an encrypted admin password");
        var shown = (await Config(env, "config", "show")).Output;
        Assert.Matches(@"REGISTRATION\s+open\s+\[environment\]", shown);
        Assert.Matches(@"ADMIN_PASSWORD\s+\*+\s+\[environment\]", shown);
        Assert.DoesNotContain("an encrypted admin password", shown);
        Assert.Matches(@"LOG_LEVEL\s+\(default: information\)", shown);
    }

    [Fact]
    public async Task Migrate_db_needs_a_target()
    {
        var (code, _, errors, _) = await Run(Settings(), "migrate-db", "--to", "sqlite");
        Assert.Equal(1, code);
        Assert.Contains("--path", errors);

        var copy = await Run(Settings(), "migrate-db", "--to", "sqlite", "--path", Path.Combine(folder, "copy.db"));
        Assert.Equal(0, copy.Code);
        Assert.Contains("Copied 0 accounts", copy.Output);
    }

    [Fact]
    public async Task Exports_and_restores_one_person()
    {
        var settings = Settings();
        await MakeAdminAsync(settings);
        Assert.Equal(0, (await Run(settings, "admin", "add-user", "sam")).Code);

        var file = Path.Combine(folder, "sam.json");
        var export = await Run(settings, "export", "--user", "sam", file);
        Assert.Equal(0, export.Code);
        Assert.Contains("Exported sam", export.Errors);
        Assert.Contains(UserBackups.Format, await File.ReadAllTextAsync(file, TestContext.Current.CancellationToken));
        Assert.Contains(UserBackups.Format, (await Run(settings, "export", "--user", "sam")).Stdout);

        var restore = await Run(settings, "import", "--user", file);
        Assert.Equal(0, restore.Code);
        Assert.Contains("sam restored", restore.Output);
        Assert.Contains("Restart the server", restore.Output);

        Assert.Contains("no user 'nobody'", (await Run(settings, "export", "--user", "nobody")).Errors);
        Assert.Equal(1, (await Run(settings, "import", "--user")).Code);
    }
}
