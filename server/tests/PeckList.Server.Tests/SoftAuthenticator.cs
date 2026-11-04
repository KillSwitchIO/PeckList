using System.Buffers.Binary;
using System.Buffers.Text;
using System.Formats.Cbor;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;

namespace PeckList.Server.Tests;

/// <summary>
/// A passkey in software for tests (PL-123): one ES256 credential that answers WebAuthn creation
/// and request options as a browser and authenticator would, with "none" attestation. It signs for
/// <paramref name="origin"/>, so a test can play a site that is not the server.
/// </summary>
public sealed class SoftAuthenticator(string origin) : IDisposable
{
    private readonly ECDsa key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
    private uint counter;

    public byte[] CredentialId { get; } = RandomNumberGenerator.GetBytes(16);

    /// <summary>The user handle the credential was made for (the account id).</summary>
    public byte[]? UserHandle { get; private set; }

    private string RpId => new Uri(origin).Host;

    private static string B64(byte[] bytes) => Base64Url.EncodeToString(bytes);

    /// <summary><c>navigator.credentials.create()</c>'s answer, as JSON.</summary>
    public JsonObject Create(JsonObject options)
    {
        UserHandle = Base64Url.DecodeFromChars((string)options["user"]!["id"]!);
        var clientData = ClientData("webauthn.create", (string)options["challenge"]!);
        var attestation = new CborWriter();
        attestation.WriteStartMap(3);
        attestation.WriteTextString("fmt");
        attestation.WriteTextString("none");
        attestation.WriteTextString("attStmt");
        attestation.WriteStartMap(0);
        attestation.WriteEndMap();
        attestation.WriteTextString("authData");
        attestation.WriteByteString(AuthenticatorData(attested: true));
        attestation.WriteEndMap();
        return new JsonObject
        {
            ["id"] = B64(CredentialId),
            ["rawId"] = B64(CredentialId),
            ["type"] = "public-key",
            ["response"] = new JsonObject
            {
                ["attestationObject"] = B64(attestation.Encode()),
                ["clientDataJSON"] = B64(clientData),
                ["transports"] = new JsonArray("internal", "hybrid"),
            },
            ["clientExtensionResults"] = new JsonObject(),
        };
    }

    /// <summary><c>navigator.credentials.get()</c>'s answer, as JSON (a discoverable credential: it names its user).</summary>
    public JsonObject Get(JsonObject options)
    {
        var clientData = ClientData("webauthn.get", (string)options["challenge"]!);
        var authenticatorData = AuthenticatorData(attested: false);
        var signature = key.SignData([.. authenticatorData, .. SHA256.HashData(clientData)], HashAlgorithmName.SHA256,
            DSASignatureFormat.Rfc3279DerSequence);
        return new JsonObject
        {
            ["id"] = B64(CredentialId),
            ["rawId"] = B64(CredentialId),
            ["type"] = "public-key",
            ["response"] = new JsonObject
            {
                ["authenticatorData"] = B64(authenticatorData),
                ["clientDataJSON"] = B64(clientData),
                ["signature"] = B64(signature),
                ["userHandle"] = B64(UserHandle ?? []),
            },
            ["clientExtensionResults"] = new JsonObject(),
        };
    }

    private byte[] ClientData(string type, string challenge) => Encoding.UTF8.GetBytes(new JsonObject
    {
        ["type"] = type,
        ["challenge"] = challenge,
        ["origin"] = origin,
        ["crossOrigin"] = false,
    }.ToJsonString());

    /// <summary>The RP id's hash, the flags (user present and verified, and an attested credential when made), the counter.</summary>
    private byte[] AuthenticatorData(bool attested)
    {
        var data = new List<byte>(SHA256.HashData(Encoding.UTF8.GetBytes(RpId)));
        data.Add((byte)(0x01 | 0x04 | (attested ? 0x40 : 0)));
        var count = new byte[4];
        BinaryPrimitives.WriteUInt32BigEndian(count, ++counter);
        data.AddRange(count);
        if (attested)
        {
            data.AddRange(new byte[16]);
            var length = new byte[2];
            BinaryPrimitives.WriteUInt16BigEndian(length, (ushort)CredentialId.Length);
            data.AddRange(length);
            data.AddRange(CredentialId);
            data.AddRange(CoseKey());
        }
        return [.. data];
    }

    /// <summary>The public key as COSE: EC2, ES256, P-256, x and y.</summary>
    private byte[] CoseKey()
    {
        var point = key.ExportParameters(false).Q;
        var cose = new CborWriter();
        cose.WriteStartMap(5);
        cose.WriteInt32(1);
        cose.WriteInt32(2);
        cose.WriteInt32(3);
        cose.WriteInt32(-7);
        cose.WriteInt32(-1);
        cose.WriteInt32(1);
        cose.WriteInt32(-2);
        cose.WriteByteString(point.X!);
        cose.WriteInt32(-3);
        cose.WriteByteString(point.Y!);
        cose.WriteEndMap();
        return cose.Encode();
    }

    public void Dispose() => key.Dispose();
}
