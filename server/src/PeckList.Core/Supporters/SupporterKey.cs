using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace PeckList.Core.Supporters;

/// <summary>Who a supporter key covers: one person, or everyone on one server (PL-112).</summary>
public enum SupporterKind
{
    /// <summary><c>S</c>: one person, on any server they use.</summary>
    Person,
    /// <summary><c>V</c>: everyone on the server an admin enters it on.</summary>
    Server,
}

/// <summary>
/// A supporter key (PL-112): a thank-you for buying one, never a lock. It reads
/// <c>PECKLIST-20261111-S-XXXXX-XXXXX-...</c>: the product, the purchase date (UTC), the kind
/// (<c>S</c> one person, <c>V</c> a server), then a base32 blob holding the format version, the
/// key's serial and an Ed25519 signature over everything before it, the readable start included,
/// so editing the date or the kind breaks the key. The issuing service signs; PeckList checks
/// offline against the public keys it ships with (<see cref="ISupporterKeyCheck"/>). This type only
/// reads and writes the text; it does no cryptography.
/// </summary>
public sealed partial record SupporterKey(DateOnly Purchased, SupporterKind Kind, byte[] Serial, byte[] Signature)
{
    public const string Product = "PECKLIST";
    public const byte Version = 1;
    public const int SerialBytes = 8;
    public const int SignatureBytes = 64;
    private const int BlobBytes = 1 + SerialBytes + SignatureBytes;
    private const int GroupSize = 5;

    /// <summary>The key as people see and paste it.</summary>
    public string Text => $"{Prefix(Purchased, Kind)}{Group(Base32.Encode([Version, .. Serial, .. Signature]))}";

    /// <summary>The bytes the signature covers: the readable start, the version and the serial.</summary>
    public byte[] Signed => SignedBytes(Purchased, Kind, Serial);

    public static byte[] SignedBytes(DateOnly purchased, SupporterKind kind, byte[] serial) =>
        [.. Encoding.ASCII.GetBytes(Prefix(purchased, kind)), Version, .. serial];

    private static string Prefix(DateOnly purchased, SupporterKind kind) =>
        $"{Product}-{purchased.ToString("yyyyMMdd", CultureInfo.InvariantCulture)}-{(kind == SupporterKind.Person ? 'S' : 'V')}-";

    private static string Group(string text) =>
        string.Join('-', Enumerable.Range(0, (text.Length + GroupSize - 1) / GroupSize)
            .Select(index => text.Substring(index * GroupSize, Math.Min(GroupSize, text.Length - index * GroupSize))));

    [GeneratedRegex(@"^PECKLIST-(\d{8})-([SV])-([A-Z2-7-]+)$")]
    private static partial Regex Shape();

    /// <summary>
    /// Reads a pasted key: case, spaces and line breaks don't matter (an email may wrap it). Null
    /// when it isn't one: the wrong shape, an impossible date or a blob of the wrong size. Whether
    /// it is genuine is the check's business, not this.
    /// </summary>
    public static SupporterKey? Parse(string? text)
    {
        if (string.IsNullOrWhiteSpace(text) || text.Length > 400) return null;
        var compact = new string([.. text.Where(each => !char.IsWhiteSpace(each))]).ToUpperInvariant();
        if (Shape().Match(compact) is not { Success: true } match) return null;
        if (!DateOnly.TryParseExact(match.Groups[1].Value, "yyyyMMdd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var date)) return null;
        if (Base32.Decode(match.Groups[3].Value.Replace("-", "", StringComparison.Ordinal)) is not { Length: BlobBytes } blob) return null;
        if (blob[0] != Version) return null;
        return new SupporterKey(date, match.Groups[2].Value == "S" ? SupporterKind.Person : SupporterKind.Server,
            blob[1..(1 + SerialBytes)], blob[(1 + SerialBytes)..]);
    }

    /// <summary>The serial as text, for logs and the issuing service's records (it says nothing about the buyer).</summary>
    public string SerialText => Convert.ToHexStringLower(Serial);
}

/// <summary>RFC 4648 base32 without padding: letters and 2 to 7, nothing to confuse when typed from paper.</summary>
public static class Base32
{
    private const string Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

    public static string Encode(ReadOnlySpan<byte> bytes)
    {
        var text = new StringBuilder((bytes.Length * 8 + 4) / 5);
        int buffer = 0, bits = 0;
        foreach (var each in bytes)
        {
            buffer = (buffer << 8) | each;
            bits += 8;
            while (bits >= 5)
            {
                text.Append(Alphabet[(buffer >> (bits - 5)) & 31]);
                bits -= 5;
            }
        }
        if (bits > 0) text.Append(Alphabet[(buffer << (5 - bits)) & 31]);
        return text.ToString();
    }

    /// <summary>Null on a character outside the alphabet, or leftover bits that aren't zero.</summary>
    public static byte[]? Decode(string text)
    {
        var bytes = new List<byte>(text.Length * 5 / 8);
        int buffer = 0, bits = 0;
        foreach (var each in text)
        {
            var value = Alphabet.IndexOf(each);
            if (value < 0) return null;
            buffer = (buffer << 5) | value;
            bits += 5;
            if (bits >= 8)
            {
                bytes.Add((byte)((buffer >> (bits - 8)) & 0xFF));
                bits -= 8;
            }
            buffer &= (1 << bits) - 1;
        }
        return bits >= 5 || buffer != 0 ? null : [.. bytes];
    }
}

/// <summary>Whether a key was signed by PeckList's issuing service (the server checks offline, PL-112).</summary>
public interface ISupporterKeyCheck
{
    bool IsGenuine(SupporterKey key);
}
