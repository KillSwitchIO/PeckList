using PeckList.Core.Text;

namespace PeckList.Core.Tests;

public class LanguageTagsTests
{
    [Theory]
    [InlineData("de")]
    [InlineData("pt-BR")]
    [InlineData("zh-Hans-TW")]
    [InlineData("sr-Latn-RS")]
    [InlineData("es-419")]
    [InlineData("de-CH-1901")]
    [InlineData("en-US-u-hc-h23")]
    [InlineData("haw")]
    [InlineData("sl-rozaj-biske-1994")]
    [InlineData("en-a-bb-b-bb")]
    public void Takes_a_well_formed_tag(string tag) => Assert.True(LanguageTags.IsWellFormed(tag));

    [Theory]
    // A region is two letters or three digits: the schema's pattern lets these through, Intl does not.
    [InlineData("en-12")]
    [InlineData("de-1234567890")]
    [InlineData("en_US")]
    [InlineData("e")]
    [InlineData("en--us")]
    [InlineData("en-")]
    [InlineData("")]
    [InlineData("de\n")]
    // A variant or singleton twice (Dev 2).
    [InlineData("de-1996-1996")]
    [InlineData("en-a-bb-A-cc")]
    [InlineData("x-whatever")]
    public void Refuses_a_malformed_one(string tag) => Assert.False(LanguageTags.IsWellFormed(tag));
}
