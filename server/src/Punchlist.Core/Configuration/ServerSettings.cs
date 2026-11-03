using Punchlist.Core.Mail;

namespace Punchlist.Core.Configuration;

public enum AuthMode
{
    /// <summary>One user, no login (home setups).</summary>
    None,

    /// <summary>Built-in accounts (the default).</summary>
    Local,
}

public enum DbProvider
{
    Sqlite,
    Postgres,
}

public enum Registration
{
    Open,
    Invite,
    Closed,
}

/// <summary>Log levels as <c>LOG_LEVEL</c> names them (the same as ASP.NET's).</summary>
public enum LogLevelSetting
{
    Trace,
    Debug,
    Information,
    Warning,
    Error,
    Critical,
}

public enum SnapshotSchedule
{
    Off,
    Hourly,
    Daily,
    Weekly,
}

/// <summary>
/// Every server setting, read once at startup from environment variables (each also as
/// <c>NAME_FILE</c>). Names and defaults: the configuration reference in the project spec.
/// </summary>
public sealed record ServerSettings
{
    public AuthMode AuthMode { get; init; } = AuthMode.Local;

    /// <summary>External URL for links and OIDC redirects. Without it, taken from each request.</summary>
    public Uri? PublicUrl { get; init; }

    /// <summary>The first admin's password; generated and logged once when not set.</summary>
    public string? AdminPassword { get; init; }

    public DbProvider DbProvider { get; init; } = DbProvider.Sqlite;
    public string DbPath { get; init; } = "/data/punchlist.db";
    public string? DbConnectionString { get; init; }
    public bool DbMigrateOnStart { get; init; } = true;
    public Registration Registration { get; init; } = Registration.Invite;
    public SnapshotSchedule SnapshotSchedule { get; init; } = SnapshotSchedule.Daily;

    /// <summary>Where snapshots go: <c>snapshots</c> next to the SQLite file, or <c>/data/snapshots</c>.</summary>
    public string SnapshotDir { get; init; } = "/data/snapshots";

    /// <summary>How many snapshots to keep.</summary>
    public int SnapshotKeep { get; init; } = 14;
    public string? TrustedProxies { get; init; }
    public string? WebRoot { get; init; }

    /// <summary>OIDC providers (<c>OIDC_PROVIDERS</c>); empty without OIDC.</summary>
    public IReadOnlyList<OidcProviderSettings> OidcProviders { get; init; } = [];

    /// <summary>The configured provider called <paramref name="name"/>, or null.</summary>
    public OidcProviderSettings? Provider(string? name) =>
        name is null ? null : OidcProviders.FirstOrDefault(each => each.Name == name);

    /// <summary>Days a deleted account can be restored before it is removed for good (<c>ACCOUNT_DELETE_GRACE_DAYS</c>).</summary>
    public int AccountDeleteGraceDays { get; init; } = 7;

    /// <summary>Days the event log keeps entries (<c>AUDIT_RETENTION_DAYS</c>).</summary>
    public int AuditRetentionDays { get; init; } = 90;

    /// <summary>Days the access log keeps entries (<c>ACCESS_LOG_RETENTION_DAYS</c>).</summary>
    public int AccessLogRetentionDays { get; init; } = 14;

    /// <summary>Write pruned entries to gzipped JSON lines first (<c>AUDIT_ARCHIVE</c>).</summary>
    public bool AuditArchive { get; init; }

    /// <summary>Where attachment files go (<c>ATTACHMENT_DIR</c>): <c>attachments</c> next to the SQLite file, <c>/files</c> in the image.</summary>
    public string AttachmentDir { get; init; } = "/data/attachments";

    /// <summary>The largest file people may attach, in megabytes (<c>ATTACHMENT_MAX_MB</c>).</summary>
    public int AttachmentMaxMb { get; init; } = 25;

    /// <summary>Look for newer Punchlist releases on GitLab twice a day (<c>UPDATE_CHECK</c>).</summary>
    public bool UpdateCheck { get; init; } = true;

    /// <summary>Serve the OpenAPI document and the Swagger UI page of the HTTP API (<c>API_DOCS</c>).</summary>
    public bool ApiDocs { get; init; } = true;

    /// <summary>Where the daily usage report goes unless <c>TELEMETRY_URL</c> says otherwise (moves to the app's domain at 1.0).</summary>
    public static readonly Uri DefaultTelemetryUrl = new("https://telemetry.killswitch10.com/api/public/v1/ping");

    /// <summary>
    /// Send the anonymous daily usage report (<c>TELEMETRY</c>, on by default; PL-116). The
    /// <c>DO_NOT_TRACK=1</c> convention turns it off too.
    /// </summary>
    public bool Telemetry { get; init; } = true;

    /// <summary>Where the daily usage report goes (<c>TELEMETRY_URL</c>).</summary>
    public Uri TelemetryUrl { get; init; } = DefaultTelemetryUrl;

    /// <summary>Email (<c>SMTP_*</c>, PL-122); null without <c>SMTP_HOST</c>, and always on a demo server.</summary>
    public MailSettings? Mail { get; init; }

    /// <summary>Where archives go: <c>audit</c> next to the SQLite file.</summary>
    public string AuditArchiveDir { get; init; } = "/data/audit";

    /// <summary>Levels, format, files and shipping targets (<c>LOG_*</c>).</summary>
    public LoggingSettings Logging { get; init; } = new();

    /// <summary>
    /// A public trial server (<c>DEMO_MODE</c>, PL-117): anyone signs up, deleted accounts go at
    /// once, files stay small and nothing leaves the server. <see cref="Read"/> forces the settings
    /// that follow from it, whatever the other layers say.
    /// </summary>
    public bool DemoMode { get; init; }

    /// <summary>Pre-made accounts a demo shows with their passwords (<c>DEMO_ACCOUNTS</c>, <c>name:password,...</c>).</summary>
    public IReadOnlyList<DemoAccount> DemoAccounts { get; init; } = [];

    /// <summary>When the demo's nightly reset runs, as the banner says it (<c>DEMO_RESET_TIME</c>, server time).</summary>
    public string DemoResetTime { get; init; } = "04:00";

    /// <summary>
    /// How often the demo resets, in minutes (<c>DEMO_RESET_EVERY</c>): 1440 is the nightly reset
    /// at <see cref="DemoResetTime"/>; less makes the banner say "every hour" and so on.
    /// </summary>
    public int DemoResetEvery { get; init; } = 1440;

    /// <summary>The largest attachment on a demo server, in megabytes: lower settings stay, higher ones come down to it.</summary>
    public const int DemoAttachmentMaxMb = 2;

    /// <summary>Accounts one address may make by sign-up in an hour (<c>SIGNUP_RATE_LIMIT</c>; 0 turns the limit off).</summary>
    public int SignUpRateLimit { get; init; } = 5;

    /// <summary>
    /// <c>LOCAL_LOGIN=disabled</c>: nobody signs in with a username and password, by the form or the
    /// API, and password sign-up and password sessions end. Identity providers and one-time sign-in
    /// links still work. The old values <c>shown</c> and <c>hidden</c> read as enabled and disabled.
    /// </summary>
    public bool LocalLoginDisabled { get; init; }

    /// <summary>
    /// Read and check every setting. All problems are reported at once, so a broken config is
    /// fixed in one pass. <paramref name="inContainer"/> picks the default database path:
    /// <c>/data</c> in the image, <c>./data</c> next to a developer's checkout.
    /// </summary>
    public static ServerSettings Read(ISecretSource source, bool inContainer)
    {
        var errors = new List<string>();
        string? Get(string name)
        {
            try
            {
                return source.Get(name);
            }
            catch (SettingsException error)
            {
                errors.Add(error.Message);
                return null;
            }
        }
        T Choice<T>(string name, T fallback) where T : struct, Enum
        {
            var raw = Get(name);
            if (raw is null) return fallback;
            if (Enum.TryParse<T>(raw, ignoreCase: true, out var value) && !int.TryParse(raw, out _)) return value;
            var allowed = string.Join(", ", Enum.GetNames<T>().Select(each => each.ToLowerInvariant()));
            errors.Add($"{name}: '{raw}' is not one of {allowed}");
            return fallback;
        }
        // enabled or disabled; shown and hidden are the names before 0.2.1.
        bool LocalLoginOff()
        {
            var raw = Get("LOCAL_LOGIN");
            switch (raw?.Trim().ToLowerInvariant())
            {
                case null or "enabled" or "shown":
                    return false;
                case "disabled" or "hidden":
                    return true;
                default:
                    errors.Add($"LOCAL_LOGIN: '{raw}' is not enabled or disabled");
                    return false;
            }
        }
        bool Flag(string name, bool fallback)
        {
            var raw = Get(name);
            if (raw is null) return fallback;
            switch (raw.Trim().ToLowerInvariant())
            {
                case "true" or "1" or "yes" or "on":
                    return true;
                case "false" or "0" or "no" or "off":
                    return false;
                default:
                    errors.Add($"{name}: '{raw}' is not true or false");
                    return fallback;
            }
        }

        Uri? publicUrl = null;
        if (Get("PUBLIC_URL") is { } url)
        {
            if (Uri.TryCreate(url.TrimEnd('/'), UriKind.Absolute, out var parsed)
                && (parsed.Scheme == Uri.UriSchemeHttp || parsed.Scheme == Uri.UriSchemeHttps))
            {
                publicUrl = parsed;
            }
            else
            {
                errors.Add($"PUBLIC_URL: '{url}' is not an http or https address");
            }
        }

        int Count(string name, int fallback, int min)
        {
            var raw = Get(name);
            if (raw is null) return fallback;
            if (int.TryParse(raw, System.Globalization.NumberStyles.None, System.Globalization.CultureInfo.InvariantCulture, out var value) && value >= min) return value;
            errors.Add($"{name}: '{raw}' is not a whole number of at least {min}");
            return fallback;
        }

        MailSettings? mail = null;
        if (Get("SMTP_HOST")?.Trim() is { Length: > 0 } smtpHost)
        {
            var tls = Get("SMTP_TLS")?.Trim().ToLowerInvariant() switch
            {
                null or "" or "starttls" => MailTls.StartTls,
                "tls" or "ssl" => MailTls.Tls,
                "none" => MailTls.None,
                var other => Bad($"SMTP_TLS: '{other}' is not one of starttls, tls, none"),
            };
            MailTls Bad(string message)
            {
                errors.Add(message);
                return MailTls.StartTls;
            }
            var port = Count("SMTP_PORT", tls == MailTls.Tls ? 465 : 587, 1);
            if (port > 65535) errors.Add($"SMTP_PORT: '{port}' is not a port");
            var from = Get("SMTP_FROM")?.Trim();
            if (string.IsNullOrEmpty(from)) errors.Add("SMTP_FROM is required with SMTP_HOST (the address email comes from)");
            else if (!from.Contains('@')) errors.Add($"SMTP_FROM: '{from}' is not an email address");
            mail = new MailSettings(smtpHost, port, Get("SMTP_USER")?.Trim() is { Length: > 0 } user ? user : null,
                Get("SMTP_PASSWORD"), from ?? "", tls);
        }

        var telemetryUrl = DefaultTelemetryUrl;
        if (Get("TELEMETRY_URL") is { } telemetry)
        {
            if (Uri.TryCreate(telemetry, UriKind.Absolute, out var parsed)
                && (parsed.Scheme == Uri.UriSchemeHttp || parsed.Scheme == Uri.UriSchemeHttps))
            {
                telemetryUrl = parsed;
            }
            else
            {
                errors.Add($"TELEMETRY_URL: '{telemetry}' is not an http or https address");
            }
        }

        var demoMode = Flag("DEMO_MODE", false);
        var demoAccounts = DemoAccount.ReadAll(Get("DEMO_ACCOUNTS"), errors);
        var demoResetTime = Get("DEMO_RESET_TIME")?.Trim() ?? "04:00";
        if (!TimeOnly.TryParseExact(demoResetTime, "HH:mm", System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.None, out _))
        {
            errors.Add($"DEMO_RESET_TIME: '{demoResetTime}' is not a time like 04:00");
        }
        if (demoAccounts.Count > 0 && !demoMode)
        {
            errors.Add("DEMO_ACCOUNTS needs DEMO_MODE=true");
        }

        var dbPath = Get("DB_PATH") ?? (inContainer ? "/data/punchlist.db" : Path.Combine("data", "punchlist.db"));
        var settings = new ServerSettings
        {
            AuthMode = Choice("AUTH_MODE", AuthMode.Local),
            PublicUrl = publicUrl,
            AdminPassword = Get("ADMIN_PASSWORD"),
            DbProvider = Choice("DB_PROVIDER", DbProvider.Sqlite),
            DbPath = dbPath,
            DbConnectionString = Get("DB_CONNECTION_STRING"),
            DbMigrateOnStart = Flag("DB_MIGRATE_ON_START", true),
            Registration = Choice("REGISTRATION", Registration.Invite),
            // BACKUP_SCHEDULE; the old SNAPSHOT_SCHEDULE still works (and LayeredSettings.OldNames for the page).
            SnapshotSchedule = Choice(Get("BACKUP_SCHEDULE") is not null ? "BACKUP_SCHEDULE" : "SNAPSHOT_SCHEDULE", SnapshotSchedule.Daily),
            SnapshotDir = Get("SNAPSHOT_DIR")
                ?? Path.Combine(Path.GetDirectoryName(dbPath) is { Length: > 0 } folder ? folder : ".", "snapshots"),
            SnapshotKeep = Count("SNAPSHOT_KEEP", 14, 1),
            TrustedProxies = Get("TRUSTED_PROXIES"),
            WebRoot = Get("WEB_ROOT"),
            OidcProviders = OidcProviderSettings.ReadAll(Get, errors),
            LocalLoginDisabled = LocalLoginOff(),
            AccountDeleteGraceDays = Count("ACCOUNT_DELETE_GRACE_DAYS", 7, 0),
            AuditRetentionDays = Count("AUDIT_RETENTION_DAYS", 90, 1),
            AccessLogRetentionDays = Count("ACCESS_LOG_RETENTION_DAYS", 14, 1),
            AuditArchive = Flag("AUDIT_ARCHIVE", false),
            AttachmentDir = Get("ATTACHMENT_DIR")
                ?? Path.Combine(Path.GetDirectoryName(dbPath) is { Length: > 0 } attachmentDir ? attachmentDir : ".", "attachments"),
            AttachmentMaxMb = Count("ATTACHMENT_MAX_MB", 25, 1),
            UpdateCheck = Flag("UPDATE_CHECK", true),
            ApiDocs = Flag("API_DOCS", true),
            Telemetry = Flag("TELEMETRY", true) && !Flag("DO_NOT_TRACK", false),
            TelemetryUrl = telemetryUrl,
            Mail = mail,
            AuditArchiveDir = Get("AUDIT_ARCHIVE_DIR")
                ?? Path.Combine(Path.GetDirectoryName(dbPath) is { Length: > 0 } auditDir ? auditDir : ".", "audit"),
            DemoMode = demoMode,
            DemoAccounts = demoAccounts,
            DemoResetTime = demoResetTime,
            DemoResetEvery = Count("DEMO_RESET_EVERY", 1440, 5),
            SignUpRateLimit = Count("SIGNUP_RATE_LIMIT", 5, 0),
            Logging = LoggingSettings.Read(Get, Path.Combine(Path.GetDirectoryName(dbPath) is { Length: > 0 } dir ? dir : ".", "logs"), errors),
        };
        if (settings.DemoMode)
        {
            if (settings.AuthMode == AuthMode.None) errors.Add("DEMO_MODE needs AUTH_MODE=local (people sign up and sign in)");
            // What a demo is: open to anyone, gone at once when deleted, small files, nothing sent
            // anywhere (no reports, no release check) and no setting on any layer changes that.
            settings = settings with
            {
                Registration = Registration.Open,
                AccountDeleteGraceDays = 0,
                AttachmentMaxMb = Math.Min(settings.AttachmentMaxMb, DemoAttachmentMaxMb),
                UpdateCheck = false,
                Telemetry = false,
                Mail = null,
            };
        }
        if (settings.OidcProviders.Count > 0 && settings.AuthMode == AuthMode.None)
        {
            errors.Add("OIDC_PROVIDERS needs AUTH_MODE=local (AUTH_MODE=none has no sign-in)");
        }
        if (settings.LocalLoginDisabled && settings.OidcProviders.Count == 0)
        {
            errors.Add("LOCAL_LOGIN=disabled needs an OIDC provider (OIDC_PROVIDERS), or nobody could sign in");
        }
        if (settings.DbProvider == DbProvider.Postgres && settings.DbConnectionString is null)
        {
            errors.Add("DB_CONNECTION_STRING is required when DB_PROVIDER is postgres");
        }
        if (settings.AdminPassword is { Length: < 12 })
        {
            errors.Add("ADMIN_PASSWORD must be at least 12 characters");
        }
        if (errors.Count > 0)
        {
            throw new SettingsException("Invalid settings:\n  " + string.Join("\n  ", errors));
        }
        return settings;
    }
}

/// <summary>A pre-made demo account: its name and the password the banner shows for it.</summary>
public sealed record DemoAccount(string Username, string Password)
{
    /// <summary><c>name:password</c> pairs, comma separated; each name a valid username, each password long enough.</summary>
    public static IReadOnlyList<DemoAccount> ReadAll(string? raw, List<string> errors)
    {
        var accounts = new List<DemoAccount>();
        foreach (var entry in (raw ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            var at = entry.IndexOf(':');
            var username = at > 0 ? entry[..at].Trim().ToLowerInvariant() : "";
            var password = at > 0 ? entry[(at + 1)..].Trim() : "";
            if (!Accounts.AccountService.IsValidUsername(username) || password.Length < Accounts.AccountService.MinPasswordLength)
            {
                errors.Add($"DEMO_ACCOUNTS: '{(at > 0 ? username + ":..." : entry)}' is not name:password with a password of at least {Accounts.AccountService.MinPasswordLength} characters");
                continue;
            }
            if (username == Accounts.AccountService.AdminUsername)
            {
                errors.Add($"DEMO_ACCOUNTS: {username} is the server's admin; pick other names");
                continue;
            }
            if (accounts.Any(each => each.Username == username))
            {
                errors.Add($"DEMO_ACCOUNTS: {username} is listed twice");
                continue;
            }
            accounts.Add(new DemoAccount(username, password));
        }
        return accounts;
    }

    /// <summary>Hidden in logs and dumps; the banner shows it on purpose, nothing else does.</summary>
    public override string ToString() => $"{Username}:***";
}
