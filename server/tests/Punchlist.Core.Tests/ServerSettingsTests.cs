using Punchlist.Core.Configuration;

namespace Punchlist.Core.Tests;

public sealed class ServerSettingsTests
{
    private static ServerSettings Read(Dictionary<string, string> env, Dictionary<string, string>? files = null, bool inContainer = true) =>
        ServerSettings.Read(Source(env, files), inContainer);

    private static FileAwareSecretSource Source(Dictionary<string, string> env, Dictionary<string, string>? files = null) =>
        new(name => env.GetValueOrDefault(name), path =>
            files is not null && files.TryGetValue(path, out var contents) ? contents : throw new FileNotFoundException("no such file", path));

    [Fact]
    public void Defaults_match_the_spec()
    {
        var settings = Read([]);
        Assert.Equal(AuthMode.Local, settings.AuthMode);
        Assert.Equal(DbProvider.Sqlite, settings.DbProvider);
        Assert.Equal("/data/punchlist.db", settings.DbPath);
        Assert.True(settings.DbMigrateOnStart);
        Assert.Equal(Registration.Invite, settings.Registration);
        Assert.Equal(SnapshotSchedule.Daily, settings.SnapshotSchedule);
        Assert.Null(settings.PublicUrl);
    }

    [Fact]
    public void Outside_a_container_the_database_sits_in_a_local_data_folder()
    {
        Assert.Equal(Path.Combine("data", "punchlist.db"), Read([], inContainer: false).DbPath);
    }

    [Fact]
    public void Reads_values_case_insensitively()
    {
        var settings = Read(new()
        {
            ["AUTH_MODE"] = "none",
            ["DB_PROVIDER"] = "Postgres",
            ["DB_CONNECTION_STRING"] = "Host=db;Username=pl",
            ["DB_MIGRATE_ON_START"] = "false",
            ["REGISTRATION"] = "OPEN",
            ["PUBLIC_URL"] = "https://tasks.example.com/",
        });
        Assert.Equal(AuthMode.None, settings.AuthMode);
        Assert.Equal(DbProvider.Postgres, settings.DbProvider);
        Assert.False(settings.DbMigrateOnStart);
        Assert.Equal(Registration.Open, settings.Registration);
        Assert.Equal("https://tasks.example.com/", settings.PublicUrl?.ToString());
    }

    [Fact]
    public void A_file_setting_reads_the_file_without_its_trailing_newline()
    {
        var settings = Read(
            new() { ["ADMIN_PASSWORD_FILE"] = "/run/secrets/admin" },
            new() { ["/run/secrets/admin"] = "correct horse battery\n" });
        Assert.Equal("correct horse battery", settings.AdminPassword);
    }

    [Fact]
    public void Only_one_newline_is_dropped()
    {
        var source = Source(new() { ["X_FILE"] = "/x" }, new() { ["/x"] = "value\n\n" });
        Assert.Equal("value\n", source.Get("X"));
        var windows = Source(new() { ["X_FILE"] = "/x" }, new() { ["/x"] = "value\r\n" });
        Assert.Equal("value", windows.Get("X"));
    }

    [Fact]
    public void Both_a_value_and_a_file_is_an_error()
    {
        var error = Assert.Throws<SettingsException>(() => Read(new()
        {
            ["ADMIN_PASSWORD"] = "a long enough password",
            ["ADMIN_PASSWORD_FILE"] = "/run/secrets/admin",
        }));
        Assert.Contains("ADMIN_PASSWORD and ADMIN_PASSWORD_FILE are both set", error.Message);
    }

    [Fact]
    public void Reports_every_problem_at_once()
    {
        var error = Assert.Throws<SettingsException>(() => Read(new()
        {
            ["AUTH_MODE"] = "oidc",
            ["DB_PROVIDER"] = "postgres",
            ["DB_MIGRATE_ON_START"] = "maybe",
            ["PUBLIC_URL"] = "tasks.example.com",
            ["SNAPSHOT_SCHEDULE"] = "2",
            ["DB_PATH_FILE"] = "/missing",
            ["ADMIN_PASSWORD"] = "short",
        }));
        Assert.Contains("AUTH_MODE: 'oidc' is not one of none, local", error.Message);
        Assert.Contains("DB_CONNECTION_STRING is required when DB_PROVIDER is postgres", error.Message);
        Assert.Contains("DB_MIGRATE_ON_START: 'maybe' is not true or false", error.Message);
        Assert.Contains("PUBLIC_URL: 'tasks.example.com' is not an http or https address", error.Message);
        Assert.Contains("SNAPSHOT_SCHEDULE: '2' is not one of off, hourly, daily", error.Message);
        Assert.Contains("DB_PATH_FILE: cannot read /missing", error.Message);
        Assert.Contains("ADMIN_PASSWORD must be at least 12 characters", error.Message);
    }
}
