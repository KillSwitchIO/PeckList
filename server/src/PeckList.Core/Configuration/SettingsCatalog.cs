namespace PeckList.Core.Configuration;

public enum SettingKind
{
    Text,
    Url,
    Choice,
    Number,
    Flag,
    List,
    Secret,
}

/// <summary>
/// One setting as the admin settings page shows it. <see cref="EnvironmentOnly"/> settings are
/// needed before the database opens (or guard it), so they are shown but never saved from the page.
/// </summary>
public sealed record SettingDefinition(
    string Key,
    string Group,
    SettingKind Kind,
    string? Default = null,
    IReadOnlyList<string>? Choices = null,
    bool EnvironmentOnly = false,
    bool Live = false);

/// <summary>Every setting the server reads (spec: Accounts &amp; Admin, Configuration reference).</summary>
public static class SettingsCatalog
{
    public static readonly IReadOnlyList<SettingDefinition> Fixed =
    [
        new("PUBLIC_URL", "general", SettingKind.Url),
        new("REGISTRATION", "general", SettingKind.Choice, "invite", ["open", "invite", "closed"], Live: true),
        new("ACCOUNT_DELETE_GRACE_DAYS", "general", SettingKind.Number, "7", Live: true),
        new("ATTACHMENT_MAX_MB", "general", SettingKind.Number, "25", Live: true),
        new("UPDATE_CHECK", "general", SettingKind.Flag, "true", Live: true),
        new("API_DOCS", "general", SettingKind.Flag, "true", Live: true),
        new("TELEMETRY", "telemetry", SettingKind.Flag, "true", Live: true),
        new("TELEMETRY_URL", "telemetry", SettingKind.Url, "https://telemetry.pecklist.com/api/public/v1/ping", Live: true),
        new("SIGNUP_RATE_LIMIT", "sign-in", SettingKind.Number, "5", Live: true),
        new("SMTP_HOST", "email", SettingKind.Text, Live: true),
        new("SMTP_PORT", "email", SettingKind.Number, "587", Live: true),
        new("SMTP_TLS", "email", SettingKind.Choice, "starttls", ["starttls", "tls", "none"], Live: true),
        new("SMTP_USER", "email", SettingKind.Text, Live: true),
        new("SMTP_PASSWORD", "email", SettingKind.Secret, Live: true),
        new("SMTP_FROM", "email", SettingKind.Text, Live: true),
        new("LOCAL_LOGIN", "sign-in", SettingKind.Choice, "enabled", ["enabled", "disabled"], Live: true),
        new("OIDC_PROVIDERS", "sign-in", SettingKind.List),
        new("BACKUP_SCHEDULE", "backups", SettingKind.Choice, "daily", ["off", "hourly", "daily", "weekly"], Live: true),
        new("SNAPSHOT_KEEP", "backups", SettingKind.Number, "14", Live: true),
        new("TRUSTED_PROXIES", "network", SettingKind.List, "loopback and private ranges"),
        new("LOG_LEVEL", "logging", SettingKind.Choice, "information", ["trace", "debug", "information", "warning", "error", "critical"], Live: true),
        new("LOG_LEVEL_OVERRIDES", "logging", SettingKind.List, "Microsoft.AspNetCore=Warning", Live: true),
        new("LOG_FORMAT", "logging", SettingKind.Choice, "text", ["text", "json"], Live: true),
        new("LOG_FILES", "logging", SettingKind.Flag, "true", Live: true),
        new("LOG_FILE_MAX_MB", "logging", SettingKind.Number, "50", Live: true),
        new("LOG_FILE_KEEP_DAYS", "logging", SettingKind.Number, "14", Live: true),
        new("AUDIT_RETENTION_DAYS", "audit", SettingKind.Number, "90", Live: true),
        new("ACCESS_LOG_RETENTION_DAYS", "audit", SettingKind.Number, "14", Live: true),
        new("AUDIT_ARCHIVE", "audit", SettingKind.Flag, "false", Live: true),
        new("LOG_OTLP_ENDPOINT", "log-shipping", SettingKind.Url, Live: true),
        new("LOG_OTLP_HEADERS", "log-shipping", SettingKind.Secret, Live: true),
        new("LOG_LOKI_URL", "log-shipping", SettingKind.Url, Live: true),
        new("LOG_LOKI_USERNAME", "log-shipping", SettingKind.Text, Live: true),
        new("LOG_LOKI_PASSWORD", "log-shipping", SettingKind.Secret, Live: true),
        new("LOG_LOKI_TENANT", "log-shipping", SettingKind.Text, Live: true),
        new("LOG_GELF_ADDRESS", "log-shipping", SettingKind.Text, Live: true),
        new("LOG_ELASTIC_URL", "log-shipping", SettingKind.Url, Live: true),
        new("LOG_ELASTIC_INDEX", "log-shipping", SettingKind.Text, "logs-pecklist-default", Live: true),
        new("LOG_ELASTIC_USERNAME", "log-shipping", SettingKind.Text, Live: true),
        new("LOG_ELASTIC_PASSWORD", "log-shipping", SettingKind.Secret, Live: true),
        new("LOG_ELASTIC_API_KEY", "log-shipping", SettingKind.Secret, Live: true),
        new("LOG_SYSLOG_ADDRESS", "log-shipping", SettingKind.Text, Live: true),
        new("DEMO_MODE", "environment", SettingKind.Flag, "false", EnvironmentOnly: true),
        new("DEMO_ACCOUNTS", "environment", SettingKind.Secret, EnvironmentOnly: true),
        new("DEMO_RESET_TIME", "environment", SettingKind.Text, "04:00", EnvironmentOnly: true),
        new("DEMO_RESET_EVERY", "environment", SettingKind.Number, "1440", EnvironmentOnly: true),
        new("UMAMI_URL", "environment", SettingKind.Url, EnvironmentOnly: true),
        new("UMAMI_WEBSITE_ID", "environment", SettingKind.Text, EnvironmentOnly: true),
        new("UMAMI_RECORDER", "environment", SettingKind.Flag, "false", EnvironmentOnly: true),
        new("DO_NOT_TRACK", "environment", SettingKind.Flag, "false", EnvironmentOnly: true),
        new("AUTH_MODE", "environment", SettingKind.Choice, "local", ["none", "local"], EnvironmentOnly: true),
        new("ADMIN_PASSWORD", "environment", SettingKind.Secret, EnvironmentOnly: true),
        new("DB_PROVIDER", "environment", SettingKind.Choice, "sqlite", ["sqlite", "postgres"], EnvironmentOnly: true),
        new("DB_PATH", "environment", SettingKind.Text, "/data/pecklist.db", EnvironmentOnly: true),
        new("DB_CONNECTION_STRING", "environment", SettingKind.Secret, EnvironmentOnly: true),
        new("DB_MIGRATE_ON_START", "environment", SettingKind.Flag, "true", EnvironmentOnly: true),
        new("SNAPSHOT_DIR", "environment", SettingKind.Text, "snapshots next to the database", EnvironmentOnly: true),
        new("ATTACHMENT_DIR", "environment", SettingKind.Text, "attachments next to the database (/files in the image)", EnvironmentOnly: true),
        new("AUDIT_ARCHIVE_DIR", "environment", SettingKind.Text, "audit next to the database", EnvironmentOnly: true),
        new("LOG_DIR", "environment", SettingKind.Text, "logs next to the database", EnvironmentOnly: true),
        new("WEB_ROOT", "environment", SettingKind.Text, EnvironmentOnly: true),
        new("CONFIG_FILE", "environment", SettingKind.Text, EnvironmentOnly: true),
        new("CONFIG_KEY", "environment", SettingKind.Secret, EnvironmentOnly: true),
    ];

    /// <summary>The settings of one identity provider named in <c>OIDC_PROVIDERS</c>.</summary>
    public static IReadOnlyList<SettingDefinition> ForProvider(string name)
    {
        var prefix = $"OIDC_{name.ToUpperInvariant().Replace('-', '_')}_";
        var group = $"provider:{name}";
        return
        [
            new(prefix + "PRESET", group, SettingKind.Text, "google for a provider named google"),
            new(prefix + "AUTHORITY", group, SettingKind.Url),
            new(prefix + "CLIENT_ID", group, SettingKind.Text),
            new(prefix + "CLIENT_SECRET", group, SettingKind.Secret),
            new(prefix + "DISPLAY_NAME", group, SettingKind.Text),
            new(prefix + "SCOPES", group, SettingKind.List, "openid profile email (+ groups)"),
            new(prefix + "GROUPS_CLAIM", group, SettingKind.Text, "groups"),
            new(prefix + "USERNAME_CLAIM", group, SettingKind.Text, "preferred_username"),
            new(prefix + "REQUIRED_GROUPS", group, SettingKind.List),
            new(prefix + "AUTO_CREATE", group, SettingKind.Flag, "false"),
            new(prefix + "LINK_BY_EMAIL", group, SettingKind.Flag, "false"),
            new(prefix + "LINK_BY_USERNAME", group, SettingKind.Choice, "false", ["false", "true", "all"]),
            new(prefix + "USER_MAP", group, SettingKind.List),
            new(prefix + "ICON", group, SettingKind.Text, "the provider favicon"),
            new(prefix + "ROLE_MAP", group, SettingKind.List),
            new(prefix + "GROUP_MAP", group, SettingKind.List),
            new(prefix + "SESSION_HOURS", group, SettingKind.Number, "12"),
            new(prefix + "SIGN_OUT", group, SettingKind.Flag, "false"),
        ];
    }

    /// <summary>The fixed settings plus those of each provider the layers name.</summary>
    public static IReadOnlyList<SettingDefinition> For(ISecretSource source)
    {
        var providers = (source.Get("OIDC_PROVIDERS") ?? "")
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(name => name.ToLowerInvariant())
            .Distinct();
        return [.. Fixed, .. providers.SelectMany(ForProvider)];
    }

    public static SettingDefinition? Find(ISecretSource source, string key) => For(source).FirstOrDefault(each => each.Key == key);

    private static readonly HashSet<string> SignInKeys = new(StringComparer.Ordinal)
    {
        "PUBLIC_URL", "REGISTRATION", "LOCAL_LOGIN", "TRUSTED_PROXIES",
    };

    /// <summary>
    /// Settings that decide who signs in and as what: identity providers and their role and user
    /// maps, password sign-in, registration, the proxies trusted for the client address and the
    /// address links point to. An admin who could change these could make themselves a super admin,
    /// so only super admins save them (<see cref="Accounts.Permission.ManageSecurity"/>).
    /// </summary>
    public static bool SuperAdminOnly(string key) =>
        SignInKeys.Contains(key) || key.StartsWith("OIDC_", StringComparison.Ordinal);
}
