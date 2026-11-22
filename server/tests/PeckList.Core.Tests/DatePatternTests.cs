using System.Text.Json.Nodes;
using PeckList.Core.Push;

namespace PeckList.Core.Tests;

/// <summary>
/// The server words dates in a person's pattern (Settings &gt; Dates) as the web app shows them: the
/// cases both sides test (schema/fixtures/date-patterns/cases.json).
/// </summary>
public sealed class DatePatternTests
{
    private static readonly JsonNode File = JsonNode.Parse(System.IO.File.ReadAllText(RepoFiles.Path("schema", "fixtures", "date-patterns", "cases.json")))!;

    public static TheoryData<string, string, string> Formats()
    {
        var data = new TheoryData<string, string, string>();
        foreach (var each in File["format"]!.AsArray()) data.Add((string)each!["date"]!, (string)each["pattern"]!, (string)each["text"]!);
        return data;
    }

    [Theory]
    [MemberData(nameof(Formats))]
    public void A_date_shows_in_the_pattern_as_the_app_shows_it(string date, string pattern, string text) =>
        Assert.Equal(text, DatePattern.Format(DateOnly.Parse(date, System.Globalization.CultureInfo.InvariantCulture), pattern));

    [Fact]
    public void The_same_patterns_can_be_used()
    {
        Assert.All(File["valid"]!.AsArray(), each => Assert.True(DatePattern.IsPattern((string)each!), (string)each!));
        Assert.All(File["invalid"]!.AsArray(), each => Assert.False(DatePattern.IsPattern((string)each!), (string)each!));
    }

    [Fact]
    public void The_automatic_style_or_an_unusable_pattern_is_no_pattern()
    {
        Assert.Null(DatePattern.Of(null));
        Assert.Null(DatePattern.Of("auto"));
        Assert.Null(DatePattern.Of("[just text]"));
        Assert.Equal("DD/MM/YYYY", DatePattern.Of("DD/MM/YYYY"));
    }

    [Theory]
    // French writes the first of a month "1er" beside the month's name, as the app does (PL-148):
    // the reminders' and invites' own patterns, and a typed one; not in numbers, not on other days.
    [InlineData("2026-12-01", "ddd D MMM", "fr", "mar. 1er déc.")]
    [InlineData("2026-12-01", "D MMMM YYYY", "fr", "1er décembre 2026")]
    [InlineData("2026-12-01", "D/M/YYYY", "fr", "1/12/2026")]
    [InlineData("2026-12-01", "DD MMM", "fr", "01 déc.")]
    [InlineData("2026-12-02", "D MMM", "fr", "2 déc.")]
    [InlineData("2026-12-01", "D MMM", "en", "1 Dec")]
    [InlineData("2026-12-01", "D. MMM", "de", "1. Dez.")]
    public void The_first_of_a_month_in_French_is_1er(string date, string pattern, string language, string text) =>
        Assert.Equal(text, DatePattern.Format(
            DateOnly.Parse(date, System.Globalization.CultureInfo.InvariantCulture), pattern,
            new PeckList.Core.Text.Words(PeckList.Core.Text.JsonTextCatalog.Embedded, language)));
}
