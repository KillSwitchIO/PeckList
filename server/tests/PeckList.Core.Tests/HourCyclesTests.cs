using System.Text.Json.Nodes;
using PeckList.Core.Text;

namespace PeckList.Core.Tests;

/// <summary>
/// An automatic clock (schema 22) reads as the app's Intl does, so a push and the app show the same
/// clock: the cases both sides test (schema/fixtures/clock/automatic.json). The web app's tests also
/// check the table itself against ICU.
/// </summary>
public sealed class HourCyclesTests
{
    private static readonly JsonNode File = JsonNode.Parse(System.IO.File.ReadAllText(RepoFiles.Path("schema", "fixtures", "clock", "automatic.json")))!;

    public static TheoryData<string, bool> Cases()
    {
        var data = new TheoryData<string, bool>();
        foreach (var (tag, twentyFour) in File["cases"]!.AsObject()) data.Add(tag, (bool)twentyFour!);
        return data;
    }

    [Theory]
    [MemberData(nameof(Cases))]
    public void A_tag_reads_the_clock_the_app_reads(string tag, bool twentyFour) => Assert.Equal(twentyFour, HourCycles.TwentyFour(tag));

    [Theory]
    // Tags as browsers and phones send them: lower-case regions, underscores, no tag at all.
    [InlineData("en-gb", true)]
    [InlineData("en_GB", true)]
    [InlineData("pt_br", true)]
    [InlineData(null, false)]
    [InlineData("", false)]
    public void A_tag_in_any_spelling(string? tag, bool twentyFour) => Assert.Equal(twentyFour, HourCycles.TwentyFour(tag));

    [Fact]
    public void Words_read_their_locale_before_their_language()
    {
        // English words for an en-GB browser, and an en-GB browser reads 24-hour (Dev 1, S1).
        var words = TextLanguage.For(JsonTextCatalog.Embedded, null, ["en-GB", "en"]);
        Assert.Equal("en", words.Language);
        Assert.True(words.TwentyFourHour);
        // A picked language with no catalog still decides: pt-BR in English words.
        var picked = TextLanguage.For(JsonTextCatalog.Embedded, new JsonObject { ["language"] = "pt-BR" }, ["en-US"]);
        Assert.Equal("en", picked.Language);
        Assert.True(picked.TwentyFourHour);
        // No locale at all: the words' own language.
        Assert.False(Words.English.TwentyFourHour);
    }
}
