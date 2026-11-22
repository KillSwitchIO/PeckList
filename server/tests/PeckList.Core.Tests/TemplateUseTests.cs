using System.Text.Json.Nodes;
using PeckList.Core.Api;

namespace PeckList.Core.Tests;

/// <summary>
/// Using a template on the server (PL-140) makes what the app's Use makes: the cases both sides run
/// (schema/fixtures/templates/use.json; the web app's core/templates.test.ts runs them too).
/// </summary>
public sealed class TemplateUseTests
{
    private static readonly JsonNode Fixture = JsonNode.Parse(File.ReadAllText(RepoFiles.Path("schema", "fixtures", "templates", "use.json")))!;
    private static readonly JsonArray Cases = Fixture["cases"]!.AsArray();
    private static readonly JsonArray ListCases = Fixture["listCases"]!.AsArray();

    public static TheoryData<string> Names() => [.. Cases.Select(each => (string)each!["name"]!)];

    public static TheoryData<string> ListNames() => [.. ListCases.Select(each => (string)each!["name"]!)];

    private static JsonObject Shown(PlannedTask task)
    {
        var shown = (JsonObject)task.Fields.DeepClone();
        shown["depth"] = task.Depth;
        shown["tags"] = SortedTags(new JsonArray([.. task.Tags.Select(tag => (JsonNode)tag)]));
        return shown;
    }

    private static JsonArray SortedTags(JsonNode? tags) =>
        new([.. (tags?.AsArray() ?? []).Select(tag => (string)tag!).Order(StringComparer.Ordinal).Select(tag => (JsonNode)tag)]);

    [Theory]
    [MemberData(nameof(Names))]
    public void A_use_makes_what_the_app_makes(string name)
    {
        var use = Cases.Single(each => (string)each!["name"]! == name)!;
        var template = new JsonObject { ["kind"] = "task", ["name"] = name, ["body"] = use["body"]!.DeepClone() };
        var body = TemplateBodies.Task(template);
        Assert.NotNull(body);
        var live = use["liveTags"]!.AsArray().Select(tag => (string)tag!).ToHashSet(StringComparer.Ordinal);
        var made = TemplateUse.Tasks(body, DateOnly.Parse((string)use["day"]!, System.Globalization.CultureInfo.InvariantCulture),
            (string)use["timeZone"]!, live, (bool)use["onDay"]!);

        var actual = new JsonArray([.. made.Select(task => (JsonNode)Shown(task))]);
        var expected = new JsonArray([.. use["tasks"]!.AsArray().Select(task =>
        {
            var shown = (JsonObject)task!.DeepClone();
            shown["tags"] = SortedTags(task["tags"]);
            return (JsonNode)shown;
        })]);
        Assert.True(JsonNode.DeepEquals(expected, actual), $"expected {expected.ToJsonString()}\nactual   {actual.ToJsonString()}");
    }

    [Theory]
    [MemberData(nameof(ListNames))]
    public void A_list_use_makes_the_list_the_app_makes(string name)
    {
        var use = ListCases.Single(each => (string)each!["name"]! == name)!;
        var template = new JsonObject { ["kind"] = "list", ["name"] = use["templateName"]!.DeepClone(), ["body"] = use["body"]!.DeepClone() };
        var list = TemplateBodies.List(template);
        Assert.NotNull(list);
        Assert.True(JsonNode.DeepEquals(use["list"], new JsonObject { ["name"] = list.Name, ["color"] = list.Color, ["icon"] = list.Icon }),
            $"list: {list.Name[..Math.Min(20, list.Name.Length)]} {list.Color} {list.Icon}");
        var day = DateOnly.Parse((string)use["day"]!, System.Globalization.CultureInfo.InvariantCulture);
        var made = list.Tasks.SelectMany(task => TemplateUse.Tasks(task, day, (string)use["timeZone"]!, new HashSet<string>(), onDay: false)).ToList();
        if (use["tasks"] is JsonArray expected)
        {
            var actual = new JsonArray([.. made.Select(task => (JsonNode)Shown(task))]);
            Assert.True(JsonNode.DeepEquals(expected, actual), $"expected {expected.ToJsonString()}\nactual   {actual.ToJsonString()}");
        }
        if (use["count"] is JsonValue count)
        {
            Assert.Equal((int)count, made.Count);
            Assert.Equal((string?)use["lastTitle"], (string?)made[^1].Fields["title"]);
        }
    }

    [Fact]
    public void Ids_made_from_an_id_are_ulids_the_same_each_time_and_differ_by_number()
    {
        const string From = "01JD0000000000000000MNE001";
        var first = Ids.Derived(From, 1);
        Assert.Matches("^[0-9A-HJKMNP-TV-Z]{26}$", first);
        Assert.StartsWith(From[..10], first);
        Assert.Equal(first, Ids.Derived(From, 1));
        Assert.NotEqual(first, Ids.Derived(From, 2));
        Assert.Equal(200, Enumerable.Range(1, 200).Select(number => Ids.Derived(From, number)).Distinct().Count());
    }

    [Fact]
    public void A_subtask_starts_with_its_parents_tags_and_the_top_task_with_the_one_it_goes_under()
    {
        var template = JsonNode.Parse("""
            {"kind":"task","body":{"title":"Top","tags":["A"],"subtasks":[{"title":"Child","tags":["B"]}]}}
            """)!.AsObject();
        var made = TemplateUse.Tasks(TemplateBodies.Task(template)!, new DateOnly(2026, 11, 23), "UTC",
            new HashSet<string>(StringComparer.Ordinal) { "A", "B" }, onDay: false, depth: 1, parentTags: ["P"]);
        Assert.Equal(["A", "P"], made[0].Tags.Order(StringComparer.Ordinal));
        Assert.Equal(["A", "B", "P"], made[1].Tags.Order(StringComparer.Ordinal));
    }

    [Fact]
    public void Under_a_task_the_depth_left_counts_from_its_parent()
    {
        // Under a task four deep, the top task sits at five: its subtasks would be six, so they're left out.
        var template = JsonNode.Parse("""{"kind":"task","body":{"title":"Top","subtasks":[{"title":"Child"}]}}""")!.AsObject();
        var made = TemplateUse.Tasks(TemplateBodies.Task(template)!, new DateOnly(2026, 11, 23), "UTC", new HashSet<string>(), onDay: false, depth: 5);
        Assert.Equal(["Top"], made.Select(task => (string)task.Fields["title"]!));
    }
}
