using System.Data.Common;
using PeckList.Core.Accounts;
using PeckList.Core.Configuration;
using PeckList.Storage.Postgres;
using PeckList.Storage.Sql;
using PeckList.Storage.Sqlite;

namespace PeckList.Server;

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
        Dictionary<string, string> page;
        try
        {
            page = ReadPage(bootstrap, layers.Cipher);
        }
        catch (SettingsException error)
        {
            // The settings key needs CONFIG_KEY (or another one): start without the page values.
            return new LoadedSettings(bootstrap, layers, inContainer, new Dictionary<string, string>(), error.Message);
        }
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
    public static Dictionary<string, string> ReadPage(ServerSettings settings, ConfigCipher? configKey = null)
    {
        // Never create a SQLite file just to look: a first start makes it with its migrations.
        if (settings.DbProvider == DbProvider.Sqlite && !File.Exists(settings.DbPath)) return [];
        SqlDatabase database = settings.DbProvider == DbProvider.Postgres
            ? new PostgresDatabase(settings.DbConnectionString!)
            : new SqliteDatabase(settings.DbPath);
        try
        {
            return ReadPageAsync(new SqlSecretStore(database), configKey).GetAwaiter().GetResult();
        }
        catch (Exception error) when (error is DbException or InvalidOperationException or IOException)
        {
            return [];
        }
    }

    public static async Task<Dictionary<string, string>> ReadPageAsync(
        ISecretStore secrets, ConfigCipher? configKey, CancellationToken cancellation = default)
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
                cipher ??= await PageCipherAsync(secrets, configKey, cancellation);
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
        ISecretStore secrets, IReadOnlyDictionary<string, string?> changes, Func<string, bool> isSecret, ConfigCipher? configKey,
        CancellationToken cancellation = default)
    {
        ConfigCipher? cipher = null;
        foreach (var (key, value) in changes)
        {
            var stored = value ?? "";
            if (stored.Length > 0 && isSecret(key) && !ConfigCipher.IsEncrypted(stored))
            {
                cipher ??= await PageCipherAsync(secrets, configKey, cancellation);
                stored = PageSecret + cipher.Encrypt(stored);
            }
            await secrets.PutAsync(PageKind, key, stored, cancellation);
        }
    }

    /// <summary>
    /// The key page secrets are encrypted with. It sits in the same table (and the same backup) as
    /// they do, so with <c>CONFIG_KEY</c> set it is kept wrapped with that (audit S8): a copy of the
    /// database alone then opens nothing. A key stored plain is wrapped once <c>CONFIG_KEY</c> is set.
    /// </summary>
    /// <exception cref="SettingsException">The key is wrapped and <c>CONFIG_KEY</c> is not set, or is another.</exception>
    private static async Task<ConfigCipher> PageCipherAsync(ISecretStore secrets, ConfigCipher? configKey, CancellationToken cancellation)
    {
        const string Name = "the settings key";
        var existing = (await secrets.ListAsync(KeyKind, cancellation)).FirstOrDefault().Value;
        if (existing is not null)
        {
            if (ConfigCipher.IsEncrypted(existing))
            {
                if (configKey is null)
                {
                    throw new SettingsException("the settings page's secrets are locked with CONFIG_KEY, which is not set");
                }
                return ConfigCipher.FromText(configKey.Decrypt(existing, Name), Name);
            }
            if (configKey is not null) await secrets.PutAsync(KeyKind, "v1", configKey.Encrypt(existing), cancellation);
            return ConfigCipher.FromText(existing, Name);
        }
        var key = ConfigCipher.NewKeyText();
        await secrets.PutAsync(KeyKind, "v1", configKey is null ? key : configKey.Encrypt(key), cancellation);
        return ConfigCipher.FromText(key, Name);
    }
}
