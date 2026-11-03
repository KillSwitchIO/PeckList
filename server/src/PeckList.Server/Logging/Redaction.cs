using System.Text.RegularExpressions;

namespace PeckList.Server.Logging;

/// <summary>
/// What never reaches a log (spec: Logging): passwords, cookies, tokens and secrets. Values named
/// like a secret are replaced, secret-looking pairs in text (query strings, headers, connection
/// strings, URL passwords) are masked, and the server's own configured secrets are scrubbed
/// wherever they turn up.
/// </summary>
public sealed partial class Redaction
{
    public const string Mask = "[redacted]";

    private string[] secrets = [];
    private readonly Lock gate = new();

    [GeneratedRegex(@"pass(word|wd|phrase)?$|pwd|secret|token|cookie|authori[sz]ation|api[-_]?key|credential|code[-_]?verifier|connection[-_]?string", RegexOptions.IgnoreCase)]
    private static partial Regex SecretName();

    // name=value pairs in query strings, forms and connection strings.
    [GeneratedRegex(@"(?<=\b(?:code|state|token|access_token|id_token|refresh_token|password|passwd|pwd|client_secret|code_verifier|api[_-]?key|session_state|secret)\s*=\s*)[^&\s;,""'<>]+", RegexOptions.IgnoreCase)]
    private static partial Regex SecretPair();

    // Authorization header values.
    [GeneratedRegex(@"(?<=\b(?:Bearer|Basic|ApiKey|Negotiate)\s+)[A-Za-z0-9._~+/=-]{6,}", RegexOptions.IgnoreCase)]
    private static partial Regex SecretScheme();

    // https://user:password@host
    [GeneratedRegex(@"(?<=://[^:/@\s]+:)[^@/\s]+(?=@)")]
    private static partial Regex UrlPassword();

    /// <summary>Scrub these exact values (the server's configured secrets) wherever they appear.</summary>
    public void AddSecrets(IEnumerable<string?> values)
    {
        lock (gate)
        {
            secrets = [.. secrets.Concat(values.OfType<string>().Where(value => value.Length >= 4)).Distinct().OrderByDescending(value => value.Length)];
        }
    }

    public static bool IsSecretName(string name) => SecretName().IsMatch(name);

    public string Text(string text)
    {
        if (text.Length == 0) return text;
        foreach (var secret in secrets)
        {
            if (text.Contains(secret, StringComparison.Ordinal)) text = text.Replace(secret, Mask, StringComparison.Ordinal);
        }
        text = SecretPair().Replace(text, Mask);
        text = SecretScheme().Replace(text, Mask);
        return UrlPassword().Replace(text, Mask);
    }

    /// <summary>A named value as it may be logged.</summary>
    public object? Value(string name, object? value) => value switch
    {
        _ when IsSecretName(name) => Mask,
        null or bool or int or long or double or float or decimal or short or byte or uint or ulong => value,
        _ => Text(LogTemplate.Format(value, null)),
    };
}
