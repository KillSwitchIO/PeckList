using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using PeckList.Core.Accounts;
using static PeckList.Server.Tests.TaskApiWorld;

namespace PeckList.Server.Tests;

/// <summary>
/// Templates in the task API (PL-140): read them, and use one as the app's Use does, with the real
/// schema check on, so everything a use makes is what the apps would accept.
/// </summary>
public sealed class TaskApiTemplateTests(ServerFixture fixture) : IClassFixture<ServerFixture>
{
    private static CancellationToken Token => TestContext.Current.CancellationToken;

    private const string Camping = "01JD0000000000000000TEMP01";
    private const string Review = "01JD0000000000000000TEMP02";
    private const string Call = "01JD0000000000000000TEMP03";
    private const string Deep = "01JD0000000000000000TEMP04";
    private const string GoneTag = "01JD0000000000000000GONE01";

    private static async Task<(HttpStatusCode Status, JsonObject Body)> Send(HttpClient client, HttpMethod method, string path, object? body = null)
    {
        using var request = new HttpRequestMessage(method, path);
        if (body is not null) request.Content = JsonContent.Create(body);
        var response = await client.SendAsync(request, Token);
        var text = await response.Content.ReadAsStringAsync(Token);
        return (response.StatusCode, text.Length == 0 ? [] : JsonNode.Parse(text)!.AsObject());
    }

    private static async Task<JsonObject> Expect(HttpClient client, HttpMethod method, string path, object? body, HttpStatusCode expected)
    {
        var (status, json) = await Send(client, method, path, body);
        Assert.True(status == expected, $"{method} {path}: {(int)status} {json.ToJsonString()}");
        return json;
    }

    private static JsonObject Day(int inDays, string? time = null) => new() { ["inDays"] = inDays, ["time"] = time };

    private static JsonObject TaskBody(string title, JsonObject? start = null, JsonObject? due = null, string[]? tags = null,
        JsonArray? reminders = null, string? recurrence = null, params JsonObject[] subtasks) => new()
    {
        ["title"] = title, ["notes"] = "", ["priority"] = 2, ["tags"] = new JsonArray([.. (tags ?? []).Select(tag => (JsonNode)tag)]),
        ["start"] = start, ["end"] = null, ["due"] = due, ["reminders"] = reminders ?? [],
        ["recurrence"] = recurrence, ["constantReminder"] = false, ["subtasks"] = new JsonArray(subtasks),
    };

    private static (string, JsonObject) Template(string id, string owner, string name, string kind, string order, JsonObject body)
    {
        var entity = Entity(id, new JsonObject
        {
            ["createdBy"] = owner, ["origin"] = "local", ["name"] = name, ["kind"] = kind, ["order"] = order, ["body"] = body, ["uses"] = 0,
        });
        return ("templates", entity);
    }

    /// <summary>Ben with a list Home, a tag yard, and four templates.</summary>
    private static async Task<(TaskApiWorld World, Person Ben, string Home, string Yard)> Start(ServerFixture fixture, string kind)
    {
        var world = await StartWithSchemaAsync(fixture, kind);
        var ben = await world.PersonAsync("ben");
        var api = ben.Session;
        var home = (string)(await Expect(api, HttpMethod.Post, "/api/v1/lists", new { name = "Home" }, HttpStatusCode.Created))["id"]!;
        await Expect(api, HttpMethod.Post, "/api/v1/tasks", new { title = "Seed", listId = home, tags = new[] { "yard" } }, HttpStatusCode.Created);
        var yard = (string)(await api.GetFromJsonAsync<JsonObject>("/api/v1/tags", Token))!["items"]![0]!["id"]!;

        // Camping: Tent due the day after use at 9:00, tagged yard and a tag deleted since, reminders,
        // a repeat, and a Pegs subtask due on the day.
        var tent = TaskBody("Tent", due: Day(1, "09:00"), tags: [yard, GoneTag],
            reminders: [new JsonObject { ["before"] = 30 }, new JsonObject { ["at"] = Day(0, "20:00") }],
            recurrence: "FREQ=WEEKLY", subtasks: TaskBody("Pegs", due: Day(0)));
        // Deep: seven levels, two past what a task may nest.
        var deep = TaskBody("Level 7");
        for (var level = 6; level >= 1; level--) deep = TaskBody($"Level {level}", subtasks: deep);
        var inbox = Entity("01JD0000000000000000NBXA01", new JsonObject
        {
            ["createdBy"] = ben.Id, ["origin"] = "local", ["name"] = "Inbox", ["color"] = "#3A7D44", ["icon"] = null, ["folderId"] = null,
            ["visibility"] = "private", ["archived"] = false, ["order"] = "a05", ["isInbox"] = true,
        });
        await PushAsync(ben,
            ("lists", inbox),
            Template(Camping, ben.Id, "Camping", "list", "a2", new JsonObject { ["name"] = "Camping", ["color"] = "#2e7d32", ["icon"] = "tent", ["tasks"] = new JsonArray(tent) }),
            Template(Review, ben.Id, "Weekly review", "task", "a1", TaskBody("Weekly review", start: Day(2), subtasks: TaskBody("Clear the inbox"))),
            Template(Call, ben.Id, "Call mum", "task", "a3", TaskBody("Call mum")),
            Template(Deep, ben.Id, "Deep", "task", "a4", deep));
        return (world, ben, home, yard);
    }

    [Theory]
    [MemberData(nameof(Databases), MemberType = typeof(TaskApiWorld))]
    public async Task Templates_are_read_in_the_pages_order_with_their_bodies(string kind)
    {
        var (world, ben, _, _) = await Start(fixture, kind);
        using var _ = world;
        var api = ben.Session;

        var all = (await api.GetFromJsonAsync<JsonObject>("/api/v1/templates", Token))!["items"]!.AsArray();
        Assert.Equal(["Weekly review", "Camping", "Call mum", "Deep"], all.Select(each => (string)each!["name"]!));
        // A list is a summary: what a template holds is the app's to change, so only one template shows it.
        var camping = all[1]!.AsObject();
        Assert.Equal(["id", "name", "kind", "uses", "taskCount", "createdAt", "updatedAt", "order"], camping.Select(each => each.Key));
        Assert.Equal(("list", 2, 0), ((string?)camping["kind"], (int)camping["taskCount"]!, (int)camping["uses"]!));

        var tasks = (await api.GetFromJsonAsync<JsonObject>("/api/v1/templates?kind=task", Token))!["items"]!.AsArray();
        Assert.Equal(["Weekly review", "Call mum", "Deep"], tasks.Select(each => (string)each!["name"]!));
        await Expect(api, HttpMethod.Get, "/api/v1/templates?kind=folder", null, HttpStatusCode.BadRequest);

        var one = await Expect(api, HttpMethod.Get, $"/api/v1/templates/{Camping}", null, HttpStatusCode.OK);
        Assert.Null(one["task"]);
        Assert.Equal(("Camping", "tent"), ((string?)one["name"], (string?)one["list"]!["icon"]));
        var tent = one["list"]!["tasks"]![0]!;
        Assert.Equal("""{"inDays":1,"time":"09:00"}""", tent["due"]!.ToJsonString());
        Assert.Equal("""[{"before":30},{"at":{"inDays":0,"time":"20:00"}}]""", tent["reminders"]!.ToJsonString());
        // Tags by name, as tasks show them; the one deleted since it was saved is left out.
        Assert.Equal(["yard"], tent["tags"]!.AsArray().Select(tag => (string)tag!));
        Assert.Equal("Pegs", (string?)tent["subtasks"]![0]!["title"]);
        var review = await Expect(api, HttpMethod.Get, $"/api/v1/templates/{Review}", null, HttpStatusCode.OK);
        Assert.Equal(("Weekly review", "Clear the inbox"), ((string?)review["task"]!["title"], (string?)review["task"]!["subtasks"]![0]!["title"]));
        Assert.Null(review["list"]);
        // Someone else's template is not there for them.
        var sam = await world.PersonAsync("sam");
        Assert.Empty((await sam.Session.GetFromJsonAsync<JsonObject>("/api/v1/templates", Token))!["items"]!.AsArray());
        await Expect(sam.Session, HttpMethod.Get, $"/api/v1/templates/{Camping}", null, HttpStatusCode.NotFound);
        await Expect(sam.Session, HttpMethod.Post, $"/api/v1/templates/{Camping}/use", new { }, HttpStatusCode.NotFound);
    }

    [Theory]
    [MemberData(nameof(Databases), MemberType = typeof(TaskApiWorld))]
    public async Task A_list_template_makes_a_new_list_with_dates_counted_from_the_day_given(string kind)
    {
        var (world, ben, _, _) = await Start(fixture, kind);
        using var _ = world;
        var api = ben.Session;

        var used = await Expect(api, HttpMethod.Post, $"/api/v1/templates/{Camping}/use", new { name = "Camping in May", day = "2027-05-01" }, HttpStatusCode.Created);
        Assert.Equal("list", (string?)used["kind"]);
        Assert.Null(used["task"]);
        var list = used["list"]!;
        Assert.Equal(("Camping in May", "#2e7d32", "tent", false), ((string?)list["name"], (string?)list["color"], (string?)list["icon"], (bool)list["shared"]!));

        var made = (await api.GetFromJsonAsync<JsonObject>($"/api/v1/tasks?listId={(string)list["id"]!}", Token))!["items"]!.AsArray();
        var tent = made.Single(each => (string)each!["title"]! == "Tent")!;
        Assert.Equal("2027-05-02T09:00", (string?)tent["due"]!["at"]);
        Assert.False((bool)tent["due"]!["allDay"]!);
        // The tag deleted since it was saved is skipped.
        Assert.Equal(["yard"], tent["tags"]!.AsArray().Select(tag => (string)tag!));
        Assert.Equal("FREQ=WEEKLY", (string?)tent["recurrence"]);
        Assert.Equal(2, (int)tent["priority"]!);
        Assert.Equal("""[{"before":30},{"at":"2027-05-01T20:00"}]""", tent["reminders"]!.ToJsonString());
        var pegs = made.Single(each => (string)each!["title"]! == "Pegs")!;
        Assert.Equal((string?)tent["id"], (string?)pegs["parentId"]);
        Assert.Equal(("2027-05-01", true), ((string?)pegs["due"]!["at"], (bool)pegs["due"]!["allDay"]!));

        Assert.Equal(1, (int)(await Expect(api, HttpMethod.Get, $"/api/v1/templates/{Camping}", null, HttpStatusCode.OK))["uses"]!);
        const string Again = "01JD0000000000000000XSTA01";
        Assert.Equal(Again, (string?)(await Expect(api, HttpMethod.Post, $"/api/v1/templates/{Camping}/use", new { id = Again }, HttpStatusCode.Created))["list"]!["id"]);
        Assert.Equal(Again, (string?)(await Expect(api, HttpMethod.Post, $"/api/v1/templates/{Camping}/use", new { id = Again }, HttpStatusCode.OK))["list"]!["id"]);
        // A list template takes a name, not a task's place or title.
        var wrong = await Expect(api, HttpMethod.Post, $"/api/v1/templates/{Camping}/use", new { title = "Tent" }, HttpStatusCode.BadRequest);
        Assert.Contains("title", wrong["errors"]!.AsObject().Select(each => each.Key));
    }

    [Theory]
    [MemberData(nameof(Databases), MemberType = typeof(TaskApiWorld))]
    public async Task A_task_template_makes_its_task_where_asked_and_a_dateless_one_goes_on_the_day(string kind)
    {
        var (world, ben, home, _) = await Start(fixture, kind);
        using var _ = world;
        var api = ben.Session;

        var used = await Expect(api, HttpMethod.Post, $"/api/v1/templates/{Review}/use", new { listId = home, title = "Review week 48", day = "2026-11-23" }, HttpStatusCode.Created);
        var task = used["task"]!;
        Assert.Equal(("task", "Review week 48", home), ((string?)used["kind"], (string?)task["title"], (string?)task["listId"]));
        Assert.Equal(("2026-11-25", true), ((string?)task["schedule"]!["start"], (bool)task["schedule"]!["allDay"]!));
        var child = (await api.GetFromJsonAsync<JsonObject>($"/api/v1/tasks?listId={home}", Token))!["items"]!.AsArray()
            .Single(each => (string?)each!["parentId"] == (string?)task["id"])!;
        Assert.Equal("Clear the inbox", (string?)child["title"]);

        // No dates of its own: on the day given, all day; with no day, no date at all.
        var onDay = (await Expect(api, HttpMethod.Post, $"/api/v1/templates/{Call}/use", new { day = "2026-12-24" }, HttpStatusCode.Created))["task"]!;
        Assert.Equal(("2026-12-24", true), ((string?)onDay["schedule"]!["start"], (bool)onDay["schedule"]!["allDay"]!));
        var undated = (await Expect(api, HttpMethod.Post, $"/api/v1/templates/{Call}/use", null, HttpStatusCode.Created))["task"]!;
        Assert.Null(undated["schedule"]);
        Assert.Equal(2, (int)(await Expect(api, HttpMethod.Get, $"/api/v1/templates/{Call}", null, HttpStatusCode.OK))["uses"]!);

        // As a subtask of an existing task: in its list, with its tags, as any new subtask.
        var tagged = (await Expect(api, HttpMethod.Post, "/api/v1/tasks", new { title = "Garden", listId = home, tags = new[] { "yard" } }, HttpStatusCode.Created))["id"]!.GetValue<string>();
        var under = (await Expect(api, HttpMethod.Post, $"/api/v1/templates/{Call}/use", new { parentId = tagged }, HttpStatusCode.Created))["task"]!;
        Assert.Equal((tagged, home), ((string?)under["parentId"], (string?)under["listId"]));
        Assert.Equal(["yard"], under["tags"]!.AsArray().Select(tag => (string)tag!));
        var elsewhere = await Expect(api, HttpMethod.Post, $"/api/v1/templates/{Call}/use", new { parentId = tagged, listId = "01JD0000000000000000NBXA01" }, HttpStatusCode.BadRequest);
        Assert.Contains("listId", elsewhere["errors"]!.AsObject().Select(each => each.Key));
        await Expect(api, HttpMethod.Post, $"/api/v1/templates/{Call}/use", new { parentId = "01JD0000000000000000NTHERE" }, HttpStatusCode.NotFound);
        await Expect(api, HttpMethod.Delete, $"/api/v1/tasks/{tagged}", null, HttpStatusCode.NoContent);
        await Expect(api, HttpMethod.Post, $"/api/v1/templates/{Call}/use", new { parentId = tagged }, HttpStatusCode.NotFound);

        // Your own id makes a retry safe: the same id again is what the first use made.
        const string Mine = "01JD0000000000000000MNE001";
        var first = await Expect(api, HttpMethod.Post, $"/api/v1/templates/{Review}/use", new { id = Mine, listId = home }, HttpStatusCode.Created);
        var again = await Expect(api, HttpMethod.Post, $"/api/v1/templates/{Review}/use", new { id = Mine, listId = home }, HttpStatusCode.OK);
        Assert.Equal(Mine, (string?)first["task"]!["id"]);
        Assert.Equal(Mine, (string?)again["task"]!["id"]);
        Assert.Equal(2, (int)(await Expect(api, HttpMethod.Get, $"/api/v1/templates/{Review}", null, HttpStatusCode.OK))["uses"]!);
        Assert.Equal("id_taken", (string?)(await Expect(api, HttpMethod.Post, $"/api/v1/templates/{Review}/use", new { id = home }, HttpStatusCode.Conflict))["code"]);
        await Expect(api, HttpMethod.Post, $"/api/v1/templates/{Review}/use", new { id = "my-own" }, HttpStatusCode.BadRequest);

        // Seven levels make six: subtasks nest five deep at most.
        var top = (await Expect(api, HttpMethod.Post, $"/api/v1/templates/{Deep}/use", new { listId = home }, HttpStatusCode.Created))["task"]!;
        var titles = (await api.GetFromJsonAsync<JsonObject>($"/api/v1/tasks?listId={home}", Token))!["items"]!.AsArray()
            .Select(each => (string)each!["title"]!).Where(title => title.StartsWith("Level", StringComparison.Ordinal)).Order().ToList();
        Assert.Equal(["Level 1", "Level 2", "Level 3", "Level 4", "Level 5", "Level 6"], titles);
        Assert.Equal("Level 1", (string?)top["title"]);

        // What a use takes, checked.
        var badDay = await Expect(api, HttpMethod.Post, $"/api/v1/templates/{Call}/use", new { day = "24 Dec" }, HttpStatusCode.BadRequest);
        Assert.Contains("day", badDay["errors"]!.AsObject().Select(each => each.Key));
        var name = await Expect(api, HttpMethod.Post, $"/api/v1/templates/{Call}/use", new { name = "Calls" }, HttpStatusCode.BadRequest);
        Assert.Contains("name", name["errors"]!.AsObject().Select(each => each.Key));
        await Expect(api, HttpMethod.Post, $"/api/v1/templates/{Call}/use", new { colour = "red" }, HttpStatusCode.BadRequest);
        await Expect(api, HttpMethod.Post, $"/api/v1/templates/{Call}/use", new { listId = "01JD000000000000000NOLIST1" }, HttpStatusCode.BadRequest);
    }

    [Theory]
    [MemberData(nameof(Databases), MemberType = typeof(TaskApiWorld))]
    public async Task A_list_shared_to_view_takes_no_template_as_it_takes_no_task(string kind)
    {
        using var world = await StartAsync(fixture, kind);
        var ben = await world.PersonAsync("ben");
        var sam = await world.PersonAsync("sam");
        await world.BefriendAsync(ben, sam);
        await PushAsync(sam, List("SL", "Sam's", visibility: "shared"), Member("SM", "SL", ben.Id, "viewer"), Task("ST", "SL", "Sam's task"));
        await PushAsync(ben, List("IN", "Inbox", inbox: true),
            ("templates", Entity("TP", new JsonObject { ["name"] = "Call", ["kind"] = "task", ["order"] = "a1", ["body"] = TaskBody("Call"), ["uses"] = 0 })));

        var plain = await Send(ben.Session, HttpMethod.Post, "/api/v1/tasks", new { title = "x", listId = "SL" });
        Assert.Equal(HttpStatusCode.Forbidden, plain.Status);
        Assert.Equal(HttpStatusCode.Forbidden, (await Send(ben.Session, HttpMethod.Post, "/api/v1/templates/TP/use", new { listId = "SL" })).Status);
        Assert.Equal(HttpStatusCode.Forbidden, (await Send(ben.Session, HttpMethod.Post, "/api/v1/templates/TP/use", new { parentId = "ST" })).Status);
        // Nothing was made, and the template wasn't counted.
        Assert.Equal(0, (int)(await Expect(ben.Session, HttpMethod.Get, "/api/v1/templates/TP", null, HttpStatusCode.OK))["uses"]!);
    }

    [Theory]
    [MemberData(nameof(Databases), MemberType = typeof(TaskApiWorld))]
    public async Task A_key_reads_templates_with_tasks_read_and_uses_them_with_tasks_write(string kind)
    {
        var (world, ben, _, _) = await Start(fixture, kind);
        using var _ = world;

        var reader = await world.KeyAsync(ben, ApiScopes.TasksRead);
        Assert.Equal(4, (await reader.GetFromJsonAsync<JsonObject>("/api/v1/templates", Token))!["items"]!.AsArray().Count);
        await Expect(reader, HttpMethod.Post, $"/api/v1/templates/{Call}/use", new { }, HttpStatusCode.Forbidden);

        var writer = await world.KeyAsync(ben, ApiScopes.TasksRead, ApiScopes.TasksWrite);
        Assert.Equal("Call mum", (string?)(await Expect(writer, HttpMethod.Post, $"/api/v1/templates/{Call}/use", new { }, HttpStatusCode.Created))["task"]!["title"]);
    }
}
