using System.Security.Cryptography;

namespace PeckList.Core;

/// <summary>ULIDs, as the web app makes them: 48-bit millisecond time then 80 random bits, Crockford base32.</summary>
public static class Ids
{
    private const string Alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

    public static string NewUlid(TimeProvider? time = null)
    {
        var milliseconds = (time ?? TimeProvider.System).GetUtcNow().ToUnixTimeMilliseconds();
        Span<byte> random = stackalloc byte[10];
        RandomNumberGenerator.Fill(random);
        Span<char> chars = stackalloc char[26];
        for (var index = 9; index >= 0; index--)
        {
            chars[index] = Alphabet[(int)(milliseconds % 32)];
            milliseconds /= 32;
        }
        // 80 random bits as 16 characters of 5 bits.
        UInt128 bits = 0;
        foreach (var b in random) bits = (bits << 8) | b;
        for (var index = 25; index >= 10; index--)
        {
            chars[index] = Alphabet[(int)(bits & 31)];
            bits >>= 5;
        }
        return new string(chars);
    }

    /// <summary>
    /// A new ULID that sorts after <paramref name="after"/>: the next one up when the clock has not
    /// moved past it (same millisecond, or a clock that stepped back).
    /// </summary>
    public static string NewUlidAfter(string? after, TimeProvider? time = null)
    {
        var id = NewUlid(time);
        if (after is null || string.CompareOrdinal(id, after) > 0) return id;
        var chars = after.ToCharArray();
        for (var index = chars.Length - 1; index >= 0; index--)
        {
            var digit = Alphabet.IndexOf(chars[index], StringComparison.Ordinal);
            if (digit < Alphabet.Length - 1)
            {
                chars[index] = Alphabet[digit + 1];
                return new string(chars);
            }
            chars[index] = Alphabet[0];
        }
        throw new OverflowException("no ULID sorts after the last one");
    }

    /// <summary>A random password of <paramref name="length"/> characters with no look-alikes (no 0/O, 1/I/L).</summary>
    /// <summary>
    /// A ULID made from another and a number: the same time part, and 80 bits of a hash of both. The
    /// same pair always gives the same id, so something made again from one id makes the same ids.
    /// </summary>
    public static string Derived(string from, int number)
    {
        var hash = System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes($"{from}:{number}"));
        var chars = new char[16];
        for (var at = 0; at < 16; at++)
        {
            var bit = at * 5;
            var value = ((hash[bit / 8] << 8) | hash[bit / 8 + 1]) >> (11 - bit % 8) & 31;
            chars[at] = Alphabet[value];
        }
        return from[..10] + new string(chars);
    }

    public static string NewPassword(int length = 20)
    {
        const string characters = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
        return RandomNumberGenerator.GetString(characters, length);
    }
}
