using NSec.Cryptography;
using PeckList.Core.Supporters;
using PeckList.Server.Supporters;

namespace PeckList.Server.Tests;

/// <summary>The offline check of a supporter key's signature (PL-112), with throwaway signing keys.</summary>
public sealed class SupporterKeyCheckTests : IDisposable
{
    private static readonly SignatureAlgorithm Ed25519 = SignatureAlgorithm.Ed25519;
    private static readonly byte[] Serial = [9, 8, 7, 6, 5, 4, 3, 2];

    private readonly Key issuer = Key.Create(Ed25519, new KeyCreationParameters { ExportPolicy = KeyExportPolicies.AllowPlaintextExport });
    private readonly Key other = Key.Create(Ed25519);

    public void Dispose()
    {
        issuer.Dispose();
        other.Dispose();
    }

    private static SupporterKey Issue(Key by, SupporterKind kind = SupporterKind.Person)
    {
        var purchased = new DateOnly(2026, 11, 11);
        return new SupporterKey(purchased, kind, Serial, Ed25519.Sign(by, SupporterKey.SignedBytes(purchased, kind, Serial)));
    }

    private SupporterKeyCheck Check(params Key[] keys) => new([.. keys.Select(each => each.PublicKey)]);

    [Fact]
    public void A_key_the_issuer_signed_is_genuine_after_a_trip_through_its_text()
    {
        var text = Issue(issuer, SupporterKind.Server).Text;
        Assert.True(Check(issuer).IsGenuine(SupporterKey.Parse(text)!));
    }

    [Fact]
    public void Editing_the_date_the_kind_or_the_serial_breaks_it()
    {
        var key = Issue(issuer);
        var check = Check(issuer);
        Assert.False(check.IsGenuine(key with { Purchased = new DateOnly(2027, 1, 1) }));
        Assert.False(check.IsGenuine(key with { Kind = SupporterKind.Server }));
        Assert.False(check.IsGenuine(key with { Serial = [.. Serial[..^1], 0] }));
    }

    [Fact]
    public void A_key_signed_by_anyone_else_is_not_genuine() => Assert.False(Check(issuer).IsGenuine(Issue(other)));

    [Fact]
    public void Any_of_several_public_keys_will_do_so_the_signing_key_can_be_replaced()
    {
        Assert.True(Check(other, issuer).IsGenuine(Issue(issuer)));
        Assert.True(Check(other, issuer).IsGenuine(Issue(other)));
    }

    [Fact]
    public void Public_keys_read_from_base64()
    {
        var published = Convert.ToBase64String(issuer.PublicKey.Export(KeyBlobFormat.RawPublicKey));
        Assert.True(SupporterKeyCheck.FromBase64([published]).IsGenuine(Issue(issuer)));
    }

    [Fact]
    public void With_no_public_keys_nothing_is_genuine() =>
        Assert.False(SupporterKeyCheck.FromBase64(SupporterKeyCheck.BuiltIn).IsGenuine(Issue(issuer)));
}
