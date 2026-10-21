using System.Security.Cryptography;

namespace Punchlist.Core;

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

    /// <summary>A random password of <paramref name="length"/> characters with no look-alikes (no 0/O, 1/I/L).</summary>
    public static string NewPassword(int length = 20)
    {
        const string characters = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
        return RandomNumberGenerator.GetString(characters, length);
    }
}
