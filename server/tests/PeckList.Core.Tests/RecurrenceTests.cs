using System.Globalization;
using System.Text.Json.Nodes;
using PeckList.Core.Tasks;

namespace PeckList.Core.Tests;

/// <summary>Repeating tasks worked out as the web app does: the fixtures web/src/core/recurrence.test.ts passes too.</summary>
public sealed class RecurrenceTests
{
    private static JsonObject Shared() =>
        JsonNode.Parse(File.ReadAllText(RepoFiles.Path("schema", "fixtures", "recurrence", "recurrence.json")))!.AsObject();

    public static TheoryData<int> AdvanceCases() => [.. Enumerable.Range(0, Shared()["advance"]!.AsArray().Count)];

    public static TheoryData<int> ParseCases() => [.. Enumerable.Range(0, Shared()["parse"]!.AsArray().Count)];

    [Theory]
    [MemberData(nameof(AdvanceCases))]
    public void Advances_as_the_app_does(int index)
    {
        var fixture = Shared()["advance"]![index]!;
        var rule = Recurrence.Parse((string)fixture["rule"]!)!;
        var step = rule.Advance(Date(fixture["current"]), Date(fixture["doneOn"]));
        var expected = fixture["expected"];
        var description = (string)fixture["description"]!;
        if (expected is null)
        {
            Assert.True(step is null, description);
            return;
        }
        Assert.True(step is not null, description);
        Assert.Equal(((string)expected["date"]!, (string)expected["rule"]!),
            (step.Value.Date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), step.Value.Rule.Format()));
    }

    [Theory]
    [MemberData(nameof(ParseCases))]
    public void Reads_rules_as_the_app_does(int index)
    {
        var fixture = Shared()["parse"]![index]!;
        Assert.Equal((string?)fixture["expected"], Recurrence.Parse((string)fixture["text"]!)?.Format());
    }

    [Fact]
    public void There_are_fixtures() => Assert.True(AdvanceCases().Count >= 20);

    private static DateOnly Date(JsonNode? value) => DateOnly.ParseExact((string)value!, "yyyy-MM-dd", CultureInfo.InvariantCulture);
}
