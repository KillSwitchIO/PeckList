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
}
