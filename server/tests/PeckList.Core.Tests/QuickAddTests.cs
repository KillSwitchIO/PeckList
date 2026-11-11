using System.Globalization;
using System.Text.Json.Nodes;
using PeckList.Core.Api;

namespace PeckList.Core.Tests;

/// <summary>
/// Quick add on the server reads a line exactly as the app does (PL-137): the shared cases in
/// <c>schema/fixtures/quick-add/cases.json</c>, which the web suite runs through chrono.
/// </summary>
public sealed class QuickAddTests
{
    private static readonly JsonObject Fixture = JsonNode.Parse(File.ReadAllText(RepoFiles.Path("schema", "fixtures", "quick-add", "cases.json")))!.AsObject();

    public static TheoryData<string> Cases()
    {
        var data = new TheoryData<string>();
        foreach (var each in Fixture["cases"]!.AsArray()) data.Add((string)each!["text"]!);
        return data;
    }

    private static QuickAddContext Context()
    {
        var reference = DateTime.ParseExact((string)Fixture["reference"]!, "yyyy-MM-dd'T'HH:mm", CultureInfo.InvariantCulture);
        return new QuickAddContext(
            [.. Fixture["lists"]!.AsArray().Select(list => new QuickList((string)list!["id"]!, (string)list["name"]!))],
            [.. Fixture["tags"]!.AsArray().Select(tag => ((string)tag!["id"]!, (string)tag["name"]!))],
            [.. Fixture["people"]!.AsArray().Select(person => new QuickPerson((string)person!["principal"]!, (string)person["name"]!, (string?)person["handle"]))],
            reference);
    }

    private static JsonNode? Moment(QuickMoment? moment) =>
        moment is null ? null : new JsonObject { ["date"] = moment.Date, ["time"] = moment.Time };

    [Fact]
    public void Has_the_shared_cases() => Assert.True(Fixture["cases"]!.AsArray().Count > 80);

    [Theory]
    [MemberData(nameof(Cases))]
    public void Reads_the_line_as_the_app_does(string text)
    {
        var expected = (JsonObject)Fixture["cases"]!.AsArray().First(each => (string)each!["text"]! == text)!.DeepClone();
        expected.Remove("text");
        var parsed = QuickAdd.Parse(text, Context());
        var actual = new JsonObject
        {
            ["title"] = parsed.Title,
            ["tokens"] = new JsonArray([.. parsed.Tokens.Select(token => (JsonNode)new JsonObject
            {
                ["kind"] = token.Kind, ["start"] = token.Start, ["end"] = token.End, ["text"] = token.Text,
            })]),
            ["schedule"] = parsed.Schedule is null ? null : new JsonObject { ["start"] = Moment(parsed.Schedule.Start), ["end"] = Moment(parsed.Schedule.End) },
            ["due"] = Moment(parsed.Due),
            ["priority"] = parsed.Priority,
            ["listId"] = parsed.ListId,
            ["tags"] = new JsonArray([.. parsed.Tags.Select(tag => (JsonNode)new JsonObject { ["id"] = tag.Id, ["name"] = tag.Name })]),
            ["assignees"] = new JsonArray([.. parsed.Assignees.Select(principal => (JsonNode)JsonValue.Create(principal))]),
            ["recurrence"] = parsed.Recurrence,
        };
        Assert.True(JsonNode.DeepEquals(expected, actual), $"\nwant {expected.ToJsonString()}\ngot  {actual.ToJsonString()}");
    }

    [Fact]
    public void A_long_line_of_dates_and_dashes_reads_quickly()
    {
        var text = string.Concat(Enumerable.Repeat("12 - 12/12 - 9-9 at 9 ", 40));
        var watch = System.Diagnostics.Stopwatch.StartNew();
        QuickAdd.Parse(text[..Math.Min(text.Length, QuickAdd.MaxText)], Context());
        Assert.True(watch.Elapsed < TimeSpan.FromSeconds(2), watch.Elapsed.ToString());
    }
}
