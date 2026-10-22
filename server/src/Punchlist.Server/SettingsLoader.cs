using System.Data.Common;
using Punchlist.Core.Accounts;
using Punchlist.Core.Configuration;
using Punchlist.Storage.Postgres;
using Punchlist.Storage.Sql;
using Punchlist.Storage.Sqlite;

namespace Punchlist.Server;

/// <summary>
/// The settings the server started with: the layers they came from, the page values saved at that
/// moment (to tell when a restart is due), and why saved page values were set aside, if they were.
/// </summary>
public sealed record LoadedSettings(
    ServerSettings Settings,
    LayeredSettings Layers,
    bool InContainer,
    IReadOnlyDictionary<string, string> PageAtStart,
    string? PageProblem);

/// <summary>
/// Reads settings in two steps (spec: Server settings): environment and <c>CONFIG_FILE</c> first,
/// which say where the database is, then the values saved on the settings page. A saved value that
/// does not work never stops the server: it starts without the page values and says why.
/// </summary>
public static class SettingsLoader
{
    /// <summary>Page values in <c>server_secrets</c>: one row per setting.</summary>
    public const string PageKind = "setting";

    /// <summary>The key page secrets are encrypted with, made on first use.</summary>
    private const string KeyKind = "settings-key";

    /// <summary>Page secrets at rest: this prefix, then the cipher's own text.</summary>
    private const string PageSecret = "page:";

    public static LoadedSettings Load(ISecretSource environment, bool inContainer)
    {
        var layers = LayeredSettings.FromEnvironment(environment);
        var bootstrap = ServerSettings.Read(layers, inContainer);
        var page = ReadPage(bootstrap);
        if (page.Count == 0) return new LoadedSettings(bootstrap, layers, inContainer, page, null);
        var withPage = layers.WithPage(page);
        try
        {
            return new LoadedSettings(ServerSettings.Read(withPage, inContainer), withPage, inContainer, page, null);
        }
        catch (SettingsException error)
        {
            return new LoadedSettings(bootstrap, layers, inContainer, page, error.Message);
        }
    }

    /// <summary>The page's saved values (secrets opened), or none when the database is not there yet.</summary>
    public static Dictionary<string, string> ReadPage(ServerSettings settings)
    {
        // Never create a SQLite file just to look: a first start makes it with its migrations.
        if (settings.DbProvider == DbProvider.Sqlite && !File.Exists(settings.DbPath)) return [];
        SqlDatabase database = settings.DbProvider == DbProvider.Postgres
            ? new PostgresDatabase(settings.DbConnectionString!)
            : new SqliteDatabase(settings.DbPath);
        try
        {
            return ReadPageAsync(new SqlSecretStore(database)).GetAwaiter().GetResult();
        }
        catch (Exception error) when (error is DbException or InvalidOperationException or IOException)
        {
            return [];
        }
    }

    public static async Task<Dictionary<string, string>> ReadPageAsync(ISecretStore secrets, CancellationToken cancellation = default)
    {
        var rows = await secrets.ListAsync(PageKind, cancellation);
        if (rows.Count == 0) return [];
        ConfigCipher? cipher = null;
        var page = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var (name, value) in rows)
        {
            if (value.Length == 0) continue;
            if (value.StartsWith(PageSecret, StringComparison.Ordinal))
            {
                cipher ??= await PageCipherAsync(secrets, cancellation);
                page[name] = cipher.Decrypt(value[PageSecret.Length..], name);
            }
            else
            {
                page[name] = value;
            }
        }
        return page;
    }

    /// <summary>Save page values: a value per key, empty to clear it; secrets are encrypted.</summary>
    public static async Task SavePageAsync(
        ISecretStore secrets, IReadOnlyDictionary<string, string?> changes, Func<string, bool> isSecret, CancellationToken cancellation = default)
    {
        ConfigCipher? cipher = null;
        foreach (var (key, value) in changes)
        {
            var stored = value ?? "";
            if (stored.Length > 0 && isSecret(key) && !ConfigCipher.IsEncrypted(stored))
            {
                cipher ??= await PageCipherAsync(secrets, cancellation);
                stored = PageSecret + cipher.Encrypt(stored);
            }
            await secrets.PutAsync(PageKind, key, stored, cancellation);
        }
    }

    private static async Task<ConfigCipher> PageCipherAsync(ISecretStore secrets, CancellationToken cancellation)
    {
        var existing = (await secrets.ListAsync(KeyKind, cancellation)).FirstOrDefault().Value;
        if (existing is not null) return ConfigCipher.FromText(existing, "the settings key");
        var key = ConfigCipher.NewKeyText();
        await secrets.PutAsync(KeyKind, "v1", key, cancellation);
        return ConfigCipher.FromText(key, "the settings key");
    }
}
