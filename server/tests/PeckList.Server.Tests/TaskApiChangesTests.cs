using System.Net;
using System.Text.Json.Nodes;
using static PeckList.Server.Tests.TaskApiWorld;

namespace PeckList.Server.Tests;

/// <summary>The task API's changes feed (PL-137) on SQLite and PostgreSQL: changed, deleted and revoked, after a cursor.</summary>
public sealed class TaskApiChangesTests(ServerFixture fixture) : IClassFixture<ServerFixture>
{
    private static CancellationToken Token => TestContext.Current.CancellationToken;

    private static async Task<JsonObject> Changes(HttpClient client, string? cursor = null, int? limit = null)
    {
        var query = new List<string>();
        if (cursor is not null) query.Add($"cursor={cursor}");
        if (limit is not null) query.Add($"limit={limit}");
        var response = await client.GetAsync("/api/v1/changes" + (query.Count > 0 ? "?" + string.Join('&', query) : ""), Token);
        var text = await response.Content.ReadAsStringAsync(Token);
        Assert.True(response.StatusCode == HttpStatusCode.OK, text);
        return JsonNode.Parse(text)!.AsObject();
    }

    private static string[] Ids(JsonObject feed, string kind) => [.. feed[kind]!.AsArray().Select(item => (string)item!["id"]!)];

    /// <summary>Everything from the start, following <c>more</c>, as a client catches up.</summary>
    private static async Task<(string Cursor, List<JsonObject> Pages)> CatchUp(HttpClient client, string? cursor = null, int? limit = null)
    {
        var pages = new List<JsonObject>();
        while (true)
        {
            var page = await Changes(client, cursor, limit);
            pages.Add(page);
            cursor = (string)page["cursor"]!;
            if (!(bool)page["more"]!) return (cursor, pages);
        }
    }

    [Theory]
    [MemberData(nameof(Databases), MemberType = typeof(TaskApiWorld))]
    public async Task The_feed_starts_with_everything_then_brings_only_what_changed_and_tombstones(string kind)
    {
        using var world = await StartAsync(fixture, kind);
        var ben = await world.PersonAsync("ben");
        await PushAsync(ben, List("L1", "Home"), Section("S1", "L1", "Outside"), Tag("G1", "yard"),
            Task("T1", "L1", "Mow", tags: ["G1"]), Task("T2", "L1", "Rake"));
        var reader = await world.KeyAsync(ben, "tasks:read");

        var (cursor, pages) = await CatchUp(reader);
        var first = Assert.Single(pages);
        Assert.Equal(["T1", "T2"], Ids(first, "tasks").Order(StringComparer.Ordinal));
        Assert.Contains("L1", Ids(first, "lists"));
        Assert.Equal(["S1"], Ids(first, "sections"));
        Assert.Equal(["G1"], Ids(first, "tags"));
        Assert.Equal(["yard"], first["tasks"]!.AsArray().Single(task => (string)task!["id"]! == "T1")!["tags"]!.AsArray().Select(tag => (string)tag!));
        Assert.Empty(first["revoked"]!.AsArray());
        // Profiles, settings and the rest of the workspace are the apps' business.
        Assert.Null(first["users"]);

        // Nothing new: an empty page at the same cursor.
        var quiet = await Changes(reader, cursor);
        Assert.Equal(cursor, (string?)quiet["cursor"]);
        Assert.Empty(quiet["tasks"]!.AsArray());
        Assert.False((bool)quiet["more"]!);

        var gone = Task("T2", "L1", "Rake");
        gone.Item2["deletedAt"] = "2026-10-21T12:00:00.000Z";
        await PushAsync(ben, Task("T1", "L1", "Mow the lawn", tags: ["G1"]), gone);
        var after = await Changes(reader, cursor);
        Assert.Equal(["T1", "T2"], Ids(after, "tasks").Order(StringComparer.Ordinal));
        var tasks = after["tasks"]!.AsArray();
        Assert.Equal("Mow the lawn", (string?)tasks.Single(task => (string)task!["id"]! == "T1")!["title"]);
        Assert.Equal("2026-10-21T12:00:00.000Z", (string?)tasks.Single(task => (string)task!["id"]! == "T2")!["deletedAt"]);
        Assert.Empty(after["lists"]!.AsArray());
    }

    [Theory]
    [MemberData(nameof(Databases), MemberType = typeof(TaskApiWorld))]
    public async Task Pages_say_more_and_access_lost_comes_as_revoked(string kind)
    {
        using var world = await StartAsync(fixture, kind);
        var ben = await world.PersonAsync("ben");
        var sam = await world.PersonAsync("sam");
        await world.BefriendAsync(ben, sam);
        await PushAsync(ben, List("L3", "Chores", visibility: "shared"), Member("M1", "L3", sam.Id, "editor"),
            Task("T1", "L3", "Dishes"), Task("T2", "L3", "Laundry"), Task("T3", "L3", "Floors"));

        var (cursor, pages) = await CatchUp(sam.Session, limit: 2);
        Assert.True(pages.Count >= 2);
        Assert.True((bool)pages[0]["more"]!);
        Assert.Equal(["T1", "T2", "T3"], pages.SelectMany(page => Ids(page, "tasks")).Order(StringComparer.Ordinal));
        Assert.Contains("L3", pages.SelectMany(page => Ids(page, "lists")));

        // Taken off the list: its tasks go as revoked, not as deleted.
        var off = Member("M1", "L3", sam.Id, "editor");
        off.Item2["deletedAt"] = "2026-10-21T13:00:00.000Z";
        await PushAsync(ben, off);
        var (_, later) = await CatchUp(sam.Session, cursor);
        var revoked = later.SelectMany(page => page["revoked"]!.AsArray().Select(id => (string)id!)).ToList();
        Assert.Contains("T1", revoked);
        Assert.Contains("L3", revoked);
        Assert.DoesNotContain(later.SelectMany(page => Ids(page, "tasks")), id => id == "T1" );
    }

    [Theory]
    [MemberData(nameof(Databases), MemberType = typeof(TaskApiWorld))]
    public async Task A_bad_cursor_or_limit_is_a_problem(string kind)
    {
        using var world = await StartAsync(fixture, kind);
        var ben = await world.PersonAsync("ben");
        foreach (var path in new[] { "/api/v1/changes?cursor=abc", "/api/v1/changes?cursor=-1", "/api/v1/changes?limit=0", "/api/v1/changes?limit=501" })
        {
            var response = await ben.Session.GetAsync(path, Token);
            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
            Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        }
    }
}
