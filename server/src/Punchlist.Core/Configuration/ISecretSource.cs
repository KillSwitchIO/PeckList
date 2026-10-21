namespace Punchlist.Core.Configuration;

/// <summary>
/// Where settings come from. Every setting <c>NAME</c> may instead be given as <c>NAME_FILE</c>, a
/// path whose contents are the value (Docker secrets). Setting both is an error.
/// </summary>
public interface ISecretSource
{
    /// <summary>The setting's value, or null when it is not set.</summary>
    string? Get(string name);
}

/// <summary>A setting was given in a way that cannot work; the message names the variable.</summary>
public sealed class SettingsException(string message) : Exception(message);

/// <summary>
/// Reads <c>NAME</c> and <c>NAME_FILE</c> from a flat lookup (environment variables in production).
/// A file's value loses one trailing newline, as editors and <c>echo</c> add one.
/// </summary>
public sealed class FileAwareSecretSource(Func<string, string?> lookup, Func<string, string>? readFile = null)
    : ISecretSource
{
    private readonly Func<string, string> readFile = readFile ?? File.ReadAllText;

    public static FileAwareSecretSource FromEnvironment() => new(Environment.GetEnvironmentVariable);

    public string? Get(string name)
    {
        var value = Blank(lookup(name));
        var path = Blank(lookup(name + "_FILE"));
        if (value is not null && path is not null)
        {
            throw new SettingsException($"{name} and {name}_FILE are both set; use one of them");
        }
        if (path is null) return value;
        string contents;
        try
        {
            contents = readFile(path);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            throw new SettingsException($"{name}_FILE: cannot read {path}: {error.Message}");
        }
        if (contents.EndsWith("\r\n", StringComparison.Ordinal)) return contents[..^2];
        return contents.EndsWith('\n') ? contents[..^1] : contents;
    }

    private static string? Blank(string? value) => string.IsNullOrEmpty(value) ? null : value;
}
