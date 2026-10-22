using System.Security.Cryptography;
using System.Text;

namespace Punchlist.Core.Configuration;

/// <summary>
/// Encrypted setting values (spec: Server settings): <c>enc:v1:&lt;base64&gt;</c>, AES-256-GCM with a
/// 32-byte key (<c>CONFIG_KEY</c>, base64). Lets a compose file or env file hold secrets that are
/// useless without the key, which can live in a Docker secret.
/// </summary>
public sealed class ConfigCipher
{
    public const string Prefix = "enc:v1:";
    private const int NonceSize = 12;
    private const int TagSize = 16;
    private readonly byte[] key;

    public ConfigCipher(byte[] key)
    {
        if (key.Length != 32) throw new ArgumentException("the key must be 32 bytes");
        this.key = key;
    }

    /// <summary>A key as written in <c>CONFIG_KEY</c>.</summary>
    /// <exception cref="SettingsException">Not base64 for 32 bytes.</exception>
    public static ConfigCipher FromText(string text, string name = "CONFIG_KEY")
    {
        try
        {
            var bytes = Convert.FromBase64String(text.Trim());
            if (bytes.Length == 32) return new ConfigCipher(bytes);
        }
        catch (FormatException)
        {
            // Reported below.
        }
        throw new SettingsException($"{name} is not a key (punchlist config key makes one)");
    }

    public static string NewKeyText() => Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));

    public static bool IsEncrypted(string? value) => value?.StartsWith(Prefix, StringComparison.Ordinal) == true;

    public string Encrypt(string plain)
    {
        var data = Encoding.UTF8.GetBytes(plain);
        var nonce = RandomNumberGenerator.GetBytes(NonceSize);
        var sealedData = new byte[data.Length];
        var tag = new byte[TagSize];
        using (var aes = new AesGcm(key, TagSize)) aes.Encrypt(nonce, data, sealedData, tag);
        return Prefix + Convert.ToBase64String([.. nonce, .. sealedData, .. tag]);
    }

    /// <exception cref="SettingsException">Not made with this key, or damaged.</exception>
    public string Decrypt(string value, string name)
    {
        try
        {
            var bytes = Convert.FromBase64String(value[Prefix.Length..]);
            if (bytes.Length < NonceSize + TagSize) throw new FormatException("too short");
            var nonce = bytes[..NonceSize];
            var tag = bytes[^TagSize..];
            var sealedData = bytes[NonceSize..^TagSize];
            var plain = new byte[sealedData.Length];
            using (var aes = new AesGcm(key, TagSize)) aes.Decrypt(nonce, sealedData, tag, plain);
            return Encoding.UTF8.GetString(plain);
        }
        catch (Exception error) when (error is FormatException or CryptographicException)
        {
            throw new SettingsException($"{name}: the encrypted value does not open with this CONFIG_KEY");
        }
    }
}
