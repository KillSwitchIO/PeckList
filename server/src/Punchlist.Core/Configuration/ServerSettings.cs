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

public enum LocalLogin
{
    Shown,
    Hidden,
}

public enum SnapshotSchedule
{
    Off,
    Hourly,
    Daily,
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

    /// <summary>Levels, format, files and shipping targets (<c>LOG_*</c>).</summary>
    public LoggingSettings Logging { get; init; } = new();

    /// <summary><c>LOCAL_LOGIN=hidden</c> hides the password form once a provider works (<c>/login?local</c> still shows it).</summary>
    public bool LocalLoginHidden { get; init; }

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
            SnapshotSchedule = Choice("SNAPSHOT_SCHEDULE", SnapshotSchedule.Daily),
            SnapshotDir = Get("SNAPSHOT_DIR")
                ?? Path.Combine(Path.GetDirectoryName(dbPath) is { Length: > 0 } folder ? folder : ".", "snapshots"),
            SnapshotKeep = Count("SNAPSHOT_KEEP", 14, 1),
            TrustedProxies = Get("TRUSTED_PROXIES"),
            WebRoot = Get("WEB_ROOT"),
            OidcProviders = OidcProviderSettings.ReadAll(Get, errors),
            LocalLoginHidden = Choice("LOCAL_LOGIN", LocalLogin.Shown) == LocalLogin.Hidden,
            Logging = LoggingSettings.Read(Get, Path.Combine(Path.GetDirectoryName(dbPath) is { Length: > 0 } dir ? dir : ".", "logs"), errors),
        };
        if (settings.OidcProviders.Count > 0 && settings.AuthMode == AuthMode.None)
        {
            errors.Add("OIDC_PROVIDERS needs AUTH_MODE=local (AUTH_MODE=none has no sign-in)");
        }
        if (settings.LocalLoginHidden && settings.OidcProviders.Count == 0)
        {
            errors.Add("LOCAL_LOGIN=hidden needs an OIDC provider (OIDC_PROVIDERS), or nobody could sign in");
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
