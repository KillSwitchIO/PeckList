using System.Buffers.Text;
using System.Security.Cryptography;
using System.Text;

namespace Punchlist.Core;

/// <summary>
/// Tokens handed to people (sign-in links, invites, app sign-in codes, impersonation). A token is
/// random, shown once, and kept only as its hash, so the database never holds anything that works.
/// </summary>
public static class Tokens
{
    /// <summary>A new token of <paramref name="bytes"/> random bytes, as unpadded base64url.</summary>
    public static string New(int bytes = 32) => Base64Url.EncodeToString(RandomNumberGenerator.GetBytes(bytes));

    /// <summary>What is stored for a token: its SHA-256, as hex.</summary>
    public static string Hash(string token) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token)));
}
