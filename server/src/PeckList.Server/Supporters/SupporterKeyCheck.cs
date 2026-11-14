using NSec.Cryptography;
using PeckList.Core.Supporters;

namespace PeckList.Server.Supporters;

/// <summary>
/// Checks a supporter key offline against the issuing service's public keys (PL-112): a server
/// never calls out about a key. More than one key is allowed so the signing key can be replaced
/// without turning old keys away.
/// </summary>
public sealed class SupporterKeyCheck(IReadOnlyList<PublicKey> publicKeys) : ISupporterKeyCheck
{
    /// <summary>
    /// The issuing service's public keys, raw Ed25519, base64. Empty until the production signing
    /// key exists (it is made on the service's host and never leaves it; only this half is
    /// copied here): until then no key checks out, and nothing else changes.
    /// </summary>
    public static readonly string[] BuiltIn = [];

    private static readonly SignatureAlgorithm Ed25519 = SignatureAlgorithm.Ed25519;

    public static SupporterKeyCheck FromBase64(IEnumerable<string> keys) =>
        new([.. keys.Select(each => PublicKey.Import(Ed25519, Convert.FromBase64String(each), KeyBlobFormat.RawPublicKey))]);

    public bool IsGenuine(SupporterKey key)
    {
        var signed = key.Signed;
        foreach (var publicKey in publicKeys)
        {
            if (Ed25519.Verify(publicKey, signed, key.Signature)) return true;
        }
        return false;
    }
}
