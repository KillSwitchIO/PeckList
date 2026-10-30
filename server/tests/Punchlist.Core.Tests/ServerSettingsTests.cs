using Punchlist.Core.Accounts;
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
    public void The_update_check_is_on_unless_turned_off()
    {
        Assert.True(Read([]).UpdateCheck);
        Assert.False(Read(new() { ["UPDATE_CHECK"] = "off" }).UpdateCheck);
        Assert.Throws<SettingsException>(() => Read(new() { ["UPDATE_CHECK"] = "sometimes" }));
    }

    [Fact]
    public void Usage_reports_go_unless_turned_off_or_do_not_track_is_set()
    {
        var settings = Read([]);
        Assert.True(settings.Telemetry);
        Assert.Equal(ServerSettings.DefaultTelemetryUrl, settings.TelemetryUrl);
        Assert.False(Read(new() { ["TELEMETRY"] = "off" }).Telemetry);
        Assert.False(Read(new() { ["DO_NOT_TRACK"] = "1" }).Telemetry);
        Assert.Equal("https://stats.example.test/v1/ping", Read(new() { ["TELEMETRY_URL"] = "https://stats.example.test/v1/ping" }).TelemetryUrl.ToString());
        Assert.Throws<SettingsException>(() => Read(new() { ["TELEMETRY_URL"] = "collector:9000" }));
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

    [Fact]
    public void Reads_oidc_providers_from_their_blocks()
    {
        var settings = Read(new()
        {
            ["OIDC_PROVIDERS"] = "pocket, Home-SSO",
            ["OIDC_POCKET_AUTHORITY"] = "https://id.example.com/",
            ["OIDC_POCKET_CLIENT_ID"] = "punchlist",
            ["OIDC_POCKET_CLIENT_SECRET"] = "s3cret",
            ["OIDC_POCKET_REQUIRED_GROUPS"] = "punchlist, family",
            ["OIDC_POCKET_AUTO_CREATE"] = "yes",
            ["OIDC_POCKET_ROLE_MAP"] = "punchlist-admins=admin, owners=super-admin",
            ["OIDC_POCKET_GROUP_MAP"] = "family=Family",
            ["OIDC_POCKET_SESSION_HOURS"] = "0",
            ["OIDC_HOME_SSO_AUTHORITY"] = "http://keycloak:8080/realms/home",
            ["OIDC_HOME_SSO_CLIENT_ID"] = "pl",
            ["OIDC_HOME_SSO_DISPLAY_NAME"] = "Home login",
            ["OIDC_HOME_SSO_GROUP_MAP"] = "*",
            ["OIDC_HOME_SSO_SCOPES"] = "profile email",
            ["LOCAL_LOGIN"] = "disabled",
        });
        Assert.True(settings.LocalLoginDisabled);
        var pocket = settings.OidcProviders[0];
        Assert.Equal(("pocket", "Pocket", "https://id.example.com/"), (pocket.Name, pocket.DisplayName, pocket.Authority.ToString()));
        Assert.Equal("s3cret", pocket.ClientSecret);
        Assert.Equal(["punchlist", "family"], pocket.RequiredGroups);
        Assert.True(pocket.AutoCreate);
        Assert.Equal(Role.Admin, pocket.RoleMap["PUNCHLIST-ADMINS"]);
        Assert.Equal(Role.SuperAdmin, pocket.RoleMap["owners"]);
        Assert.Equal("Family", pocket.GroupMap["family"]);
        Assert.Equal(["openid", "profile", "email", "groups"], pocket.Scopes);
        Assert.Null(pocket.SessionLength);

        var home = settings.OidcProviders[1];
        Assert.Equal(("home-sso", "Home login"), (home.Name, home.DisplayName));
        Assert.True(home.MirrorGroups);
        Assert.False(home.AutoCreate);
        Assert.Null(home.ClientSecret);
        Assert.Equal(["openid", "profile", "email"], home.Scopes);
        Assert.Equal(TimeSpan.FromHours(12), home.SessionLength);
    }

    [Fact]
    public void Oidc_problems_are_reported_together()
    {
        var error = Assert.Throws<SettingsException>(() => Read(new()
        {
            ["OIDC_PROVIDERS"] = "pocket,bad_name,pocket",
            ["OIDC_POCKET_AUTHORITY"] = "id.example.com",
            ["OIDC_POCKET_ROLE_MAP"] = "admins=owner,broken",
            ["OIDC_POCKET_AUTO_CREATE"] = "sometimes",
            ["OIDC_POCKET_SESSION_HOURS"] = "-1",
        }));
        Assert.Contains("OIDC_POCKET_SESSION_HOURS: '-1' is not a number of hours from 0 to 720", error.Message);
        Assert.Contains("'bad_name' is not a provider name", error.Message);
        Assert.Contains("'pocket' is listed twice", error.Message);
        Assert.Contains("OIDC_POCKET_AUTHORITY: 'id.example.com' is not an http or https address", error.Message);
        Assert.Contains("OIDC_POCKET_CLIENT_ID is required", error.Message);
        Assert.Contains("'owner' is not one of user, admin, superadmin", error.Message);
        Assert.Contains("'broken' is not group=value", error.Message);
        Assert.Contains("OIDC_POCKET_AUTO_CREATE: 'sometimes' is not true or false", error.Message);
    }

    [Fact]
    public void Oidc_needs_logins_and_hiding_the_password_form_needs_a_provider()
    {
        var error = Assert.Throws<SettingsException>(() => Read(new()
        {
            ["AUTH_MODE"] = "none",
            ["OIDC_PROVIDERS"] = "pocket",
            ["OIDC_POCKET_AUTHORITY"] = "https://id.example.com",
            ["OIDC_POCKET_CLIENT_ID"] = "punchlist",
        }));
        Assert.Contains("OIDC_PROVIDERS needs AUTH_MODE=local", error.Message);
        Assert.Contains("LOCAL_LOGIN=disabled needs an OIDC provider",
            Assert.Throws<SettingsException>(() => Read(new() { ["LOCAL_LOGIN"] = "disabled" })).Message);
    }

    [Theory]
    [InlineData(null, false)]
    [InlineData("enabled", false)]
    [InlineData("Disabled", true)]
    // The names before 0.2.1 still work; hidden now turns password sign-in off everywhere.
    [InlineData("shown", false)]
    [InlineData("hidden", true)]
    public void Local_login_is_enabled_or_disabled(string? value, bool disabled)
    {
        var env = new Dictionary<string, string>
        {
            ["OIDC_PROVIDERS"] = "pocket",
            ["OIDC_POCKET_AUTHORITY"] = "https://id.example.com",
            ["OIDC_POCKET_CLIENT_ID"] = "punchlist",
        };
        if (value is not null) env["LOCAL_LOGIN"] = value;
        var settings = Read(env);
        Assert.Equal(disabled, settings.LocalLoginDisabled);
        Assert.Contains("LOCAL_LOGIN: 'maybe' is not enabled or disabled",
            Assert.Throws<SettingsException>(() => Read(new() { ["LOCAL_LOGIN"] = "maybe" })).Message);
    }

    [Fact]
    public void Reads_logging_levels_files_and_shipping_targets()
    {
        var defaults = Read([]).Logging;
        Assert.Equal((LogLevelSetting.Information, LogFormat.Text, true, "/data/logs", 50, 14), (defaults.Level, defaults.Format, defaults.Files, defaults.Dir, defaults.FileMaxMegabytes, defaults.FileKeepDays));
        Assert.Null(defaults.LokiUrl);

        var logging = Read(new()
        {
            ["LOG_LEVEL"] = "Debug",
            ["LOG_LEVEL_OVERRIDES"] = "Microsoft.AspNetCore=Warning, Punchlist.Sync=trace",
            ["LOG_FORMAT"] = "JSON",
            ["LOG_FILES"] = "off",
            ["LOG_OTLP_ENDPOINT"] = "http://alloy:4318",
            ["LOG_OTLP_HEADERS"] = "Authorization=Basic%20YWJj,X-Org=home",
            ["LOG_LOKI_URL"] = "https://loki.home",
            ["LOG_GELF_ADDRESS"] = "udp://graylog",
            ["LOG_SYSLOG_ADDRESS"] = "tcp://rsyslog:6514",
            ["LOG_ELASTIC_URL"] = "https://es:9200",
        }).Logging;
        Assert.Equal(LogLevelSetting.Debug, logging.Level);
        Assert.Equal(LogLevelSetting.Trace, logging.Overrides["Punchlist.Sync"]);
        Assert.Equal((LogFormat.Json, false), (logging.Format, logging.Files));
        Assert.Equal("Basic YWJj", logging.OtlpHeaders["Authorization"]);
        Assert.Equal(new LogAddress("udp", "graylog", 12201), logging.Gelf);
        Assert.Equal(new LogAddress("tcp", "rsyslog", 6514), logging.Syslog);
        Assert.Equal("logs-punchlist-default", logging.ElasticIndex);
    }

    [Fact]
    public void Logging_problems_are_reported_together()
    {
        var error = Assert.Throws<SettingsException>(() => Read(new()
        {
            ["LOG_LEVEL_OVERRIDES"] = "Punchlist.Sync",
            ["LOG_FORMAT"] = "xml",
            ["LOG_LOKI_URL"] = "loki:3100",
            ["LOG_GELF_ADDRESS"] = "graylog",
            ["LOG_SYSLOG_ADDRESS"] = "http://rsyslog",
            ["LOG_ELASTIC_INDEX"] = "Logs Punchlist",
            ["LOG_FILE_KEEP_DAYS"] = "0",
        }));
        foreach (var name in new[] { "LOG_LEVEL_OVERRIDES", "LOG_FORMAT", "LOG_LOKI_URL", "LOG_GELF_ADDRESS", "LOG_SYSLOG_ADDRESS", "LOG_ELASTIC_INDEX", "LOG_FILE_KEEP_DAYS" })
        {
            Assert.Contains(name + ":", error.Message);
        }
    }

    [Fact]
    public void Backup_schedule_takes_weekly_and_the_old_snapshot_name_still_works()
    {
        Assert.Equal(SnapshotSchedule.Weekly, Read(new() { ["BACKUP_SCHEDULE"] = "weekly" }).SnapshotSchedule);
        Assert.Equal(SnapshotSchedule.Hourly, Read(new() { ["SNAPSHOT_SCHEDULE"] = "hourly" }).SnapshotSchedule);
        Assert.Equal(SnapshotSchedule.Off, Read(new() { ["BACKUP_SCHEDULE"] = "off", ["SNAPSHOT_SCHEDULE"] = "hourly" }).SnapshotSchedule);
        var layers = new LayeredSettings(Source(new() { ["SNAPSHOT_SCHEDULE"] = "hourly" }), new Dictionary<string, string>(), new Dictionary<string, string>(), null);
        Assert.Equal(("hourly", SettingSource.Environment), layers.Explain("BACKUP_SCHEDULE"));
    }
}
