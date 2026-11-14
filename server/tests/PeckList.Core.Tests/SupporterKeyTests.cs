using System.Text;
using PeckList.Core.Supporters;

namespace PeckList.Core.Tests;

/// <summary>Reading and writing supporter keys (PL-112). Whether one is genuine is the server's check.</summary>
public sealed class SupporterKeyTests
{
    private static readonly byte[] Serial = [1, 2, 3, 4, 5, 6, 7, 8];
    private static readonly byte[] Signature = [.. Enumerable.Range(0, 64).Select(each => (byte)(255 - each))];

    private static SupporterKey Key(SupporterKind kind = SupporterKind.Person) =>
        new(new DateOnly(2026, 11, 11), kind, Serial, Signature);

    [Fact]
    public void A_key_reads_back_from_its_own_text()
    {
        foreach (var kind in new[] { SupporterKind.Person, SupporterKind.Server })
        {
            var key = Key(kind);
            var read = SupporterKey.Parse(key.Text);
            Assert.NotNull(read);
            Assert.Equal(key.Purchased, read.Purchased);
            Assert.Equal(kind, read.Kind);
            Assert.Equal(Serial, read.Serial);
            Assert.Equal(Signature, read.Signature);
        }
    }

    [Fact]
    public void The_text_starts_readable_and_groups_the_rest_in_fives()
    {
        Assert.StartsWith("PECKLIST-20261111-S-", Key().Text);
        Assert.StartsWith("PECKLIST-20261111-V-", Key(SupporterKind.Server).Text);
        var groups = Key().Text["PECKLIST-20261111-S-".Length..].Split('-');
        Assert.All(groups[..^1], group => Assert.Equal(5, group.Length));
        Assert.InRange(groups[^1].Length, 1, 5);
    }

    [Fact]
    public void Case_spaces_and_line_breaks_in_a_pasted_key_do_not_matter()
    {
        var text = Key().Text;
        var pasted = "  " + text[..30].ToLowerInvariant() + "\r\n  " + text[30..] + " \n";
        Assert.Equal(Serial, SupporterKey.Parse(pasted)?.Serial);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("not a key")]
    [InlineData("PECKLIST-20261111-S-")]
    [InlineData("PECKLIST-20261111-X-AAAAA")]
    [InlineData("OTHER-20261111-S-AAAAA")]
    public void Anything_that_is_not_a_key_reads_as_none(string? text) => Assert.Null(SupporterKey.Parse(text));

    [Fact]
    public void An_impossible_date_a_short_blob_or_another_version_reads_as_none()
    {
        var blob = Key().Text["PECKLIST-20261111-S-".Length..];
        Assert.Null(SupporterKey.Parse("PECKLIST-20261131-S-" + blob));
        Assert.Null(SupporterKey.Parse("PECKLIST-20261111-S-" + blob[..^6]));
        var otherVersion = Base32.Encode([2, .. Serial, .. Signature]);
        Assert.Null(SupporterKey.Parse("PECKLIST-20261111-S-" + otherVersion));
        Assert.Null(SupporterKey.Parse("PECKLIST-20261111-S-" + blob + new string('A', 400)));
    }

    [Fact]
    public void The_signature_covers_the_readable_start_so_editing_the_date_or_kind_changes_what_was_signed()
    {
        var key = Key();
        Assert.Equal([.. Encoding.ASCII.GetBytes("PECKLIST-20261111-S-"), 1, .. Serial], key.Signed);
        Assert.NotEqual(key.Signed, (key with { Purchased = new DateOnly(2026, 11, 12) }).Signed);
        Assert.NotEqual(key.Signed, (key with { Kind = SupporterKind.Server }).Signed);
    }

    [Fact]
    public void The_serial_reads_as_hex() => Assert.Equal("0102030405060708", Key().SerialText);

    [Theory]
    [InlineData("", "")]
    [InlineData("f", "MY")]
    [InlineData("fo", "MZXQ")]
    [InlineData("foo", "MZXW6")]
    [InlineData("foob", "MZXW6YQ")]
    [InlineData("fooba", "MZXW6YTB")]
    [InlineData("foobar", "MZXW6YTBOI")]
    public void Base32_matches_rfc_4648_without_padding(string plain, string encoded)
    {
        Assert.Equal(encoded, Base32.Encode(Encoding.ASCII.GetBytes(plain)));
        Assert.Equal(Encoding.ASCII.GetBytes(plain), Base32.Decode(encoded));
    }

    [Theory]
    [InlineData("MZXW6YTBO1")]
    [InlineData("MZ=")]
    [InlineData("MZ")]
    [InlineData("M")]
    public void Base32_refuses_a_letter_outside_its_alphabet_or_bits_left_over(string text)
    {
        // "MZ" decodes to "f" only as "MY": the last letter's spare bits must be zero.
        Assert.Null(Base32.Decode(text));
    }
}
