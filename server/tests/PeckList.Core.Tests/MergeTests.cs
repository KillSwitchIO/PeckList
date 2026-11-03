using System.Text.Json.Nodes;
using PeckList.Core.Sync;

namespace PeckList.Core.Tests;

public sealed class MergeTests
{
    public static TheoryData<string> Fixtures()
    {
        var data = new TheoryData<string>();
        foreach (var file in Directory.GetFiles(RepoFiles.Path("schema", "fixtures", "merge"), "*.json").Order(StringComparer.Ordinal))
        {
            data.Add(Path.GetFileName(file));
        }
        return data;
    }

    /// <summary>The fixtures the web app's merge passes too: both argument orders give the expected result.</summary>
    [Theory]
    [MemberData(nameof(Fixtures))]
    public void Matches_the_shared_fixture(string file)
    {
        var fixture = JsonNode.Parse(File.ReadAllText(RepoFiles.Path("schema", "fixtures", "merge", file)))!.AsObject();
        var sets = WorkspaceSchema.ElementSetFields((string)fixture["collection"]!);
        var a = fixture["a"]!.AsArray().Select(node => node!.AsObject()).ToList();
        var b = fixture["b"]!.AsArray().Select(node => node!.AsObject()).ToList();
        var expected = fixture["expected"]!;

        var forward = new JsonArray([.. Merge.Collection(Clone(a), Clone(b), sets)]);
        var backward = new JsonArray([.. Merge.Collection(Clone(b), Clone(a), sets)]);
        Assert.True(JsonNode.DeepEquals(expected, forward), $"{fixture["description"]}\n{forward.ToJsonString()}");
        Assert.True(JsonNode.DeepEquals(expected, backward), $"{fixture["description"]} (b, a)\n{backward.ToJsonString()}");
    }

    [Fact]
    public void There_are_fixtures() => Assert.True(Fixtures().Count >= 8);

    [Fact]
    public void Refuses_to_merge_different_ids()
    {
        var error = Assert.Throws<ArgumentException>(() =>
            Merge.Entity(new JsonObject { ["id"] = "A", ["_hlc"] = new JsonObject() }, new JsonObject { ["id"] = "B", ["_hlc"] = new JsonObject() }, []));
        Assert.Contains("different entities", error.Message);
    }

    [Fact]
    public void Converges_whatever_the_order()
    {
        // Random edits on three replicas: every merge order gives the same entity, and merging
        // again changes nothing (commutative, associative, idempotent).
        var random = new Random(20261021);
        for (var round = 0; round < 300; round++)
        {
            var replicas = Enumerable.Range(0, 3).Select(node => RandomTask(random, $"n{node}")).ToList();
            var (a, b, c) = (replicas[0], replicas[1], replicas[2]);
            string[] sets = ["tags"];
            var abc = Merge.Entity(Merge.Entity(a, b, sets), c, sets);
            var cba = Merge.Entity(Merge.Entity(c, b, sets), a, sets);
            var bca = Merge.Entity(b, Merge.Entity(c, a, sets), sets);
            Assert.True(JsonNode.DeepEquals(abc, cba), $"round {round}: {abc.ToJsonString()} vs {cba.ToJsonString()}");
            Assert.True(JsonNode.DeepEquals(abc, bca), $"round {round}");
            Assert.True(JsonNode.DeepEquals(abc, Merge.Entity(abc, a, sets)), $"round {round}: not idempotent");
        }
    }

    private static JsonObject RandomTask(Random random, string node)
    {
        string Clock() => $"2026-10-21T10:00:0{random.Next(3)}.000Z-000{random.Next(2)}-{(random.Next(4) == 0 ? "n0" : node)}";
        var task = new JsonObject { ["id"] = "T1" };
        var clocks = new JsonObject();
        foreach (var field in new[] { "title", "priority", "schedule" })
        {
            if (random.Next(3) == 0) continue;
            task[field] = field switch
            {
                "title" => $"title {random.Next(3)}",
                "priority" => random.Next(4),
                _ => new JsonObject { ["start"] = $"2026-11-0{random.Next(1, 4)}", ["allDay"] = random.Next(2) == 0 },
            };
            clocks[field] = Clock();
        }
        var tags = new JsonObject();
        foreach (var tag in new[] { "G1", "G2" })
        {
            if (random.Next(2) == 0) tags[tag] = new JsonObject { ["in"] = random.Next(2) == 0, ["hlc"] = Clock() };
        }
        task["tags"] = tags;
        task["_hlc"] = clocks;
        return task;
    }

    private static List<JsonObject> Clone(List<JsonObject> entities) => entities.Select(each => each.DeepClone().AsObject()).ToList();
}

public sealed class CanonicalJsonTests
{
    [Theory]
    // Expected strings are what JSON.stringify / canonicalJson print in JavaScript.
    [InlineData("""{"b":1,"a":{"d":[true,null],"c":"x"}}""", """{"a":{"c":"x","d":[true,null]},"b":1}""")]
    [InlineData("""["quote \" and \\ and \n and \t", "é ☕ <b>&"]""", """["quote \" and \\ and \n and \t","é ☕ <b>&"]""")]
    [InlineData("""{"x":"\u0001\u001f"}""", """{"x":"\u0001\u001f"}""")]
    [InlineData("[1.0, 0.5, -0, 1e21, 1.5e-7, 123456789012]", "[1,0.5,0,1e+21,1.5e-7,123456789012]")]
    [InlineData("""{"Z":1,"a":2,"_":3}""", """{"Z":1,"_":3,"a":2}""")]
    public void Writes_what_javascript_writes(string input, string expected)
    {
        Assert.Equal(expected, CanonicalJson.Write(JsonNode.Parse(input)));
    }

    [Fact]
    public void Escapes_lone_surrogates_like_javascript()
    {
        Assert.Equal("\"\\ud800x\"", CanonicalJson.Write(JsonValue.Create("\ud800x")));
        Assert.Equal("\"😀\"", CanonicalJson.Write(JsonValue.Create("😀")));
    }
}

public sealed class HlcTests
{
    [Fact]
    public void Orders_by_time_then_counter_then_node_and_missing_first()
    {
        Assert.True(Hlc.Compare("2026-10-20T16:00:00.000Z-0001-a", "2026-10-20T16:00:00.000Z-0000-z") > 0);
        Assert.True(Hlc.Compare("2026-10-20T16:00:00.000Z-0000-b", "2026-10-20T16:00:00.000Z-0000-a") > 0);
        Assert.True(Hlc.Compare(null, "2026-10-20T16:00:00.000Z-0000-a") < 0);
        Assert.Equal(0, Hlc.Compare(null, null));
    }

    [Theory]
    [InlineData("2026-10-20T16:15:02.113Z-0001-dev7", true)]
    [InlineData("2026-10-20T16:15:02Z-0001-dev7", false)]
    [InlineData("2026-10-20T16:15:02.113Z-1-dev7", false)]
    [InlineData("2026-10-20T16:15:02.113Z-0001-dev-7", false)]
    [InlineData("", false)]
    public void Validates_the_format(string value, bool valid) => Assert.Equal(valid, Hlc.IsValid(value));

    [Fact]
    public void Reads_the_wall_time()
    {
        Assert.Equal(new DateTimeOffset(2026, 10, 20, 16, 15, 2, 113, TimeSpan.Zero), Hlc.WallTime("2026-10-20T16:15:02.113Z-0001-dev7"));
    }
}
