namespace Punchlist.Core.Configuration;

/// <summary>Where a setting's value came from, strongest first.</summary>
public enum SettingSource
{
    Environment,
    File,
    Page,
    Default,
}

/// <summary>
/// Settings from three places (spec: Server settings): environment variables (or <c>NAME_FILE</c>),
/// then an optional <c>CONFIG_FILE</c>, then values saved on the admin settings page. The first
/// that has a value wins. <c>enc:v1:</c> values are decrypted with <c>CONFIG_KEY</c>.
/// </summary>
public sealed class LayeredSettings(
    ISecretSource environment,
    IReadOnlyDictionary<string, string> file,
    IReadOnlyDictionary<string, string> page,
    ConfigCipher? cipher) : ISecretSource
{
    public IReadOnlyDictionary<string, string> Page => page;

    /// <summary>Settings that were renamed: the old name still works, in each layer, after the new one.</summary>
    public static readonly IReadOnlyDictionary<string, string> OldNames = new Dictionary<string, string>
    {
        ["BACKUP_SCHEDULE"] = "SNAPSHOT_SCHEDULE",
    };

    public string? Get(string name) => Explain(name).Value;

    /// <summary>The value (decrypted) and which layer gave it.</summary>
    /// <exception cref="SettingsException">An encrypted value without the key that opens it.</exception>
    public (string? Value, SettingSource Source) Explain(string name)
    {
        string[] names = OldNames.TryGetValue(name, out var old) ? [name, old] : [name];
        foreach (var each in names)
        {
            if (environment.Get(each) is { } fromEnvironment) return (Open(fromEnvironment, each), SettingSource.Environment);
        }
        foreach (var each in names)
        {
            if (file.TryGetValue(each, out var fromFile) && fromFile.Length > 0) return (Open(fromFile, each), SettingSource.File);
        }
        foreach (var each in names)
        {
            if (page.TryGetValue(each, out var fromPage) && fromPage.Length > 0) return (Open(fromPage, each), SettingSource.Page);
        }
        return (null, SettingSource.Default);
    }

    /// <summary>The same layers with the page's values replaced (trying a change before saving it).</summary>
    public LayeredSettings WithPage(IReadOnlyDictionary<string, string> newPage) => new(environment, file, newPage, cipher);

    private string Open(string value, string name)
    {
        if (!ConfigCipher.IsEncrypted(value)) return value;
        if (cipher is null) throw new SettingsException($"{name} is encrypted but CONFIG_KEY is not set");
        return cipher.Decrypt(value, name);
    }

    /// <summary>
    /// The layers as the environment describes them: <c>CONFIG_KEY</c> (or <c>_FILE</c>) and
    /// <c>CONFIG_FILE</c>, a file of <c>NAME=value</c> lines. Both live in the environment only.
    /// </summary>
    /// <exception cref="SettingsException">The key or the file cannot be used.</exception>
    public static LayeredSettings FromEnvironment(
        ISecretSource environment, IReadOnlyDictionary<string, string>? page = null, Func<string, string>? readFile = null)
    {
        var cipher = environment.Get("CONFIG_KEY") is { } keyText ? ConfigCipher.FromText(keyText) : null;
        var file = new Dictionary<string, string>(StringComparer.Ordinal);
        if (environment.Get("CONFIG_FILE") is { } path)
        {
            string text;
            try
            {
                text = (readFile ?? File.ReadAllText)(path);
            }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException)
            {
                throw new SettingsException($"CONFIG_FILE: cannot read {path}: {error.Message}");
            }
            file = EnvFile.Parse(text, "CONFIG_FILE");
        }
        return new LayeredSettings(environment, file, page ?? new Dictionary<string, string>(), cipher);
    }
}

/// <summary><c>NAME=value</c> lines, the format of Docker env files; blank lines and <c># comments</c> are skipped.</summary>
public static class EnvFile
{
    public static Dictionary<string, string> Parse(string text, string name)
    {
        var values = new Dictionary<string, string>(StringComparer.Ordinal);
        var number = 0;
        foreach (var raw in text.Split('\n'))
        {
            number++;
            var line = raw.TrimEnd('\r').Trim();
            if (line.Length == 0 || line.StartsWith('#')) continue;
            if (line.StartsWith("export ", StringComparison.Ordinal)) line = line[7..].TrimStart();
            var at = line.IndexOf('=');
            if (at <= 0) throw new SettingsException($"{name}: line {number} is not NAME=value");
            var key = line[..at].Trim();
            var value = line[(at + 1)..].Trim();
            if (value.Length >= 2 && (value[0] == '"' || value[0] == '\'') && value[^1] == value[0]) value = value[1..^1];
            values[key] = value;
        }
        return values;
    }
}
