using System.Text;
using Punchlist.Core.Backup;
using Punchlist.Core.Configuration;

namespace Punchlist.Server.Tests;

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
        var database = new Punchlist.Storage.Sqlite.SqliteDatabase(settings.DbPath);
        await database.MigrateAsync(TestContext.Current.CancellationToken);
        var accounts = new Core.Accounts.AccountService(new Punchlist.Storage.Sql.SqlAccountStore(database), new AspNetPasswordHasher(), TimeProvider.System);
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
    public async Task Migrate_db_needs_a_target()
    {
        var (code, _, errors, _) = await Run(Settings(), "migrate-db", "--to", "sqlite");
        Assert.Equal(1, code);
        Assert.Contains("--path", errors);

        var copy = await Run(Settings(), "migrate-db", "--to", "sqlite", "--path", Path.Combine(folder, "copy.db"));
        Assert.Equal(0, copy.Code);
        Assert.Contains("Copied 0 accounts", copy.Output);
    }
}
