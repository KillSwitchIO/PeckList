using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using static PeckList.Server.Tests.TaskApiWorld;

namespace PeckList.Server.Tests;

/// <summary>The task API's reads (PL-137) on SQLite and PostgreSQL: what an account sees, filtered and paged.</summary>
public sealed class TaskApiReadTests(ServerFixture fixture) : IClassFixture<ServerFixture>
{
    private static CancellationToken Token => TestContext.Current.CancellationToken;

    private static async Task<JsonObject> Get(HttpClient client, string path, HttpStatusCode expected = HttpStatusCode.OK)
    {
        var response = await client.GetAsync(path, Token);
        var text = await response.Content.ReadAsStringAsync(Token);
        Assert.True(expected == response.StatusCode, $"{path}: {(int)response.StatusCode} {text}");
        return JsonNode.Parse(text)!.AsObject();
    }

    private static string[] Ids(JsonObject page) => [.. page["items"]!.AsArray().Select(item => (string)item!["id"]!)];

    private static async Task<(TaskApiWorld World, Person Ben)> Seeded(ServerFixture fixture, string kind)
    {
        var world = await StartAsync(fixture, kind);
        var ben = await world.PersonAsync("ben");
        await PushAsync(ben,
            List("L1", "Home"), List("L2", "Work"),
            Section("S1", "L1", "Outside"),
            Tag("G1", "home"), Tag("G2", "home/yard"), Tag("G3", "errands"),
            Task("T1", "L1", "Mow the lawn", section: "S1", tags: ["G2"], due: "2026-11-12", priority: 3),
            Task("T2", "L1", "Rake leaves", tags: ["G1"], start: "2026-11-10T09:00"),
            Task("T3", "L2", "Send report", tags: ["G3"]),
            Task("T4", "L1", "Bag them", parent: "T2"),
            Task("T5", "L1", "Old chore", status: "done"),
            Task("T6", "L2", "Skipped", status: "wontdo"));
        return (world, ben);
    }

    [Theory]
    [MemberData(nameof(Databases), MemberType = typeof(TaskApiWorld))]
    public async Task Tasks_come_in_the_v1_shape_with_tag_names_and_filters(string kind)
    {
        var (world, ben) = await Seeded(fixture, kind);
        using var _ = world;
        var api = ben.Session;

        var task = await Get(api, "/api/v1/tasks/T1");
        Assert.Equal("Mow the lawn", (string?)task["title"]);
        Assert.Equal("L1", (string?)task["listId"]);
        Assert.Equal("S1", (string?)task["sectionId"]);
        Assert.Equal(3, (int)task["priority"]!);
        Assert.Equal(["home/yard"], task["tags"]!.AsArray().Select(tag => (string)tag!));
        Assert.Equal("2026-11-12", (string?)task["due"]!["at"]);
        Assert.True((bool)task["due"]!["allDay"]!);
        Assert.Null(task["schedule"]);
        Assert.False((bool)task["pinned"]!);
        Assert.NotNull((string?)task["updatedAt"]);
        Assert.Null(task["_hlc"]);
        Assert.NotNull((string?)task["order"]);

        // Open is the default; all, done and wontdo pick.
        Assert.Equal(["T1", "T2", "T3", "T4"], Ids(await Get(api, "/api/v1/tasks")));
        Assert.Equal(["T1", "T2", "T3", "T4", "T5", "T6"], Ids(await Get(api, "/api/v1/tasks?status=all")));
        Assert.Equal(["T5"], Ids(await Get(api, "/api/v1/tasks?status=done")));
        Assert.Equal(["T6"], Ids(await Get(api, "/api/v1/tasks?status=wontdo")));
        Assert.Equal(["T1", "T2", "T4"], Ids(await Get(api, "/api/v1/tasks?listId=L1")));
        Assert.Equal(["T1"], Ids(await Get(api, "/api/v1/tasks?sectionId=S1")));
        Assert.Equal(["T4"], Ids(await Get(api, "/api/v1/tasks?parentId=T2")));
        Assert.Equal(["T1", "T2", "T3"], Ids(await Get(api, "/api/v1/tasks?parentId=none")));
        // A parent tag matches its children; names match whatever their case.
        Assert.Equal(["T1", "T2"], Ids(await Get(api, "/api/v1/tasks?tag=Home")));
        Assert.Equal(["T1"], Ids(await Get(api, "/api/v1/tasks?tag=home/yard")));
        Assert.Empty(Ids(await Get(api, "/api/v1/tasks?tag=nothing")));
        // Due dates count from due, else the start; inclusive on both ends.
        Assert.Equal(["T1", "T2"], Ids(await Get(api, "/api/v1/tasks?dueAfter=2026-11-10&dueBefore=2026-11-12")));
        Assert.Equal(["T2"], Ids(await Get(api, "/api/v1/tasks?dueBefore=2026-11-11")));
        Assert.Equal(["T1"], Ids(await Get(api, "/api/v1/tasks?dueAfter=2026-11-11&listId=L1")));
    }

    [Theory]
    [MemberData(nameof(Databases), MemberType = typeof(TaskApiWorld))]
    public async Task Pages_follow_the_cursor_to_the_end_and_the_trash_is_its_own_view(string kind)
    {
        var (world, ben) = await Seeded(fixture, kind);
        using var _ = world;
        var gone = Task("T7", "L1", "Thrown out");
        gone.Item2["deletedAt"] = "2026-10-21T12:00:00.000Z";
        await PushAsync(ben, gone);

        var first = await Get(ben.Session, "/api/v1/tasks?status=all&limit=4");
        Assert.Equal(["T1", "T2", "T3", "T4"], Ids(first));
        var next = (string?)first["next"];
        Assert.Equal("T4", next);
        var second = await Get(ben.Session, $"/api/v1/tasks?status=all&limit=4&cursor={next}");
        Assert.Equal(["T5", "T6"], Ids(second));
        Assert.Null(second["next"]);

        Assert.Equal(["T7"], Ids(await Get(ben.Session, "/api/v1/tasks?deleted=true&status=all")));
        Assert.Equal("2026-10-21T12:00:00.000Z", (string?)(await Get(ben.Session, "/api/v1/tasks/T7"))["deletedAt"]);
        Assert.DoesNotContain("T7", Ids(await Get(ben.Session, "/api/v1/tasks?status=all")));
    }

    [Theory]
    [MemberData(nameof(Databases), MemberType = typeof(TaskApiWorld))]
    public async Task Lists_sections_and_tasks_carry_the_apps_order_and_a_lists_icon(string kind)
    {
        using var world = await StartAsync(fixture, kind);
        var ben = await world.PersonAsync("ben");
        var api = ben.Session;
        async Task<JsonObject> Make(string path, object body)
        {
            var made = await api.PostAsJsonAsync(path, body, Token);
            Assert.Equal(HttpStatusCode.Created, made.StatusCode);
            return (await made.Content.ReadFromJsonAsync<JsonObject>(Token))!;
        }

        var list = await Make("/api/v1/lists", new { name = "Home" });
        var section = await Make("/api/v1/sections", new { name = "Outside", listId = (string)list["id"]! });
        var first = await Make("/api/v1/tasks", new { title = "First", listId = (string)list["id"]!, tags = new[] { "yard" } });
        var second = await Make("/api/v1/tasks", new { title = "Second", listId = (string)list["id"]! });

        // The key the apps sort by: later ones sort after earlier ones, compared byte by byte.
        Assert.False(string.IsNullOrEmpty((string?)list["order"]));
        Assert.False(string.IsNullOrEmpty((string?)section["order"]));
        Assert.True(string.CompareOrdinal((string?)first["order"], (string?)second["order"]) < 0);
        Assert.True(list.ContainsKey("icon"));

        // The same fields in every place the things come from.
        var read = await Get(api, $"/api/v1/tasks/{(string)first["id"]!}");
        Assert.Equal((string?)first["order"], (string?)read["order"]);
        var changes = await Get(api, "/api/v1/changes");
        Assert.All(changes["tasks"]!.AsArray(), task => Assert.False(string.IsNullOrEmpty((string?)task!["order"])));
        Assert.All(changes["lists"]!.AsArray(), each => Assert.True(each!.AsObject().ContainsKey("icon")));
        Assert.All((await Get(api, "/api/v1/tags"))["items"]!.AsArray(), tag => Assert.False(string.IsNullOrEmpty((string?)tag!["order"])));
    }

    [Theory]
    [MemberData(nameof(Databases), MemberType = typeof(TaskApiWorld))]
    public async Task The_event_stream_tells_of_a_notification_made_for_you(string kind)
    {
        var (world, ben) = await Seeded(fixture, kind);
        using var _ = world;
        var sam = await world.PersonAsync("sam");
        await world.BefriendAsync(ben, sam);
        await PushAsync(ben, List("L3", "Shared chores", visibility: "shared"), Member("M1", "L3", sam.Id, "editor"), Task("T8", "L3", "Dishes"));

        // Sam listens with a key that may read tasks.
        var key = await world.KeyAsync(sam, "tasks:read");
        using var events = await key.GetAsync("/api/events", HttpCompletionOption.ResponseHeadersRead, Token);
        using var reader = new StreamReader(await events.Content.ReadAsStreamAsync(Token));
        Assert.Equal(": connected", await reader.ReadLineAsync(Token));

        // Ben assigns the task to Sam.
        var patch = await ben.Session.PatchAsJsonAsync("/api/v1/tasks/T8", new { assignees = new[] { $"user:{sam.Id}" } }, Token);
        Assert.Equal(HttpStatusCode.OK, patch.StatusCode);

        using var patience = CancellationTokenSource.CreateLinkedTokenSource(Token);
        patience.CancelAfter(TimeSpan.FromSeconds(10));
        string? line;
        do line = await reader.ReadLineAsync(patience.Token); while (line is not null && line != "event: notification");
        Assert.Equal("event: notification", line);
        var data = await reader.ReadLineAsync(patience.Token);
        Assert.StartsWith("data: ", data);
        var notice = JsonNode.Parse(data![6..])!.AsObject();
        Assert.Equal("assigned", (string?)notice["kind"]);
        Assert.Equal("T8", (string?)notice["taskId"]);
        Assert.Equal("L3", (string?)notice["listId"]);
        Assert.Equal(ben.Id, (string?)notice["actorId"]);
        Assert.False(string.IsNullOrEmpty((string?)notice["id"]));
    }

    [Theory]
    [MemberData(nameof(Databases), MemberType = typeof(TaskApiWorld))]
    public async Task People_names_who_assignees_are_and_says_who_may_be_assigned(string kind)
    {
        var (world, ben) = await Seeded(fixture, kind);
        using var _ = world;
        var sam = await world.PersonAsync("sam");
        var lee = await world.PersonAsync("lee");
        await world.BefriendAsync(ben, sam);

        // Ben first, then the people he can see, by name. Lee is nobody to him.
        var people = (await Get(ben.Session, "/api/v1/people"))["items"]!.AsArray();
        Assert.Equal([$"user:{ben.Id}", $"user:{sam.Id}"], people.Select(person => (string)person!["id"]!));
        Assert.Equal([true, false], people.Select(person => (bool)person!["me"]!));
        Assert.All(people, person => Assert.Equal("user", (string?)person!["kind"]));
        Assert.All(people, person => Assert.True((bool)person!["assignable"]!));
        Assert.Equal(["ben", "sam"], people.Select(person => (string?)person!["name"]));
        Assert.Equal("sam", (string?)people[1]!["handle"]);

        // A key that may read tasks may read their people.
        var key = await world.KeyAsync(ben, "tasks:read");
        Assert.Equal(2, (await Get(key, "/api/v1/people"))["items"]!.AsArray().Count);

        // Lee shares with nobody: only Lee.
        var alone = (await Get(lee.Session, "/api/v1/people"))["items"]!.AsArray();
        Assert.Equal([$"user:{lee.Id}"], alone.Select(person => (string)person!["id"]!));
    }

    [Theory]
    [MemberData(nameof(Databases), MemberType = typeof(TaskApiWorld))]
    public async Task Lists_sections_and_tags_come_with_the_readers_role_and_others_see_nothing(string kind)
    {
        var (world, ben) = await Seeded(fixture, kind);
        using var _ = world;
        var sam = await world.PersonAsync("sam");
        var lee = await world.PersonAsync("lee");
        await world.BefriendAsync(ben, sam);
        await PushAsync(ben, List("L3", "Shared chores", visibility: "shared"), Member("M1", "L3", sam.Id, "viewer"), Task("T8", "L3", "Dishes"));

        var lists = await Get(ben.Session, "/api/v1/lists");
        Assert.Equal(["L1", "L2", "L3"], Ids(lists));
        Assert.All(lists["items"]!.AsArray(), list => Assert.Equal("owner", (string?)list!["role"]));
        Assert.Equal(["S1"], Ids(await Get(ben.Session, "/api/v1/sections?listId=L1")));
        Assert.Empty(Ids(await Get(ben.Session, "/api/v1/sections?listId=L2")));
        var tags = await Get(ben.Session, "/api/v1/tags");
        Assert.Equal(["errands", "home", "home/yard"], tags["items"]!.AsArray().Select(tag => (string)tag!["name"]!));

        // Sam sees the shared list as a viewer, and its task; nothing of Ben's own lists.
        var samLists = await Get(sam.Session, "/api/v1/lists");
        Assert.Equal(["L3"], Ids(samLists));
        Assert.Equal("viewer", (string?)samLists["items"]![0]!["role"]);
        Assert.True((bool)samLists["items"]![0]!["shared"]!);
        Assert.Equal(["T8"], Ids(await Get(sam.Session, "/api/v1/tasks")));
        Assert.Equal("viewer", (string?)(await Get(sam.Session, "/api/v1/lists/L3"))["role"]);

        // Lee sees none of it: what isn't theirs is not found, never forbidden.
        Assert.Empty(Ids(await Get(lee.Session, "/api/v1/tasks?status=all")));
        var missing = await lee.Session.GetAsync("/api/v1/tasks/T1", Token);
        Assert.Equal(HttpStatusCode.NotFound, missing.StatusCode);
        Assert.Equal("application/problem+json", missing.Content.Headers.ContentType?.MediaType);
        var problem = (await missing.Content.ReadFromJsonAsync<JsonObject>(Token))!;
        Assert.Equal("not_found", (string?)problem["code"]);
        Assert.Equal(404, (int)problem["status"]!);
        await Get(lee.Session, "/api/v1/lists/L1", HttpStatusCode.NotFound);
        // A list id asked for as a task is not a task.
        await Get(ben.Session, "/api/v1/tasks/L1", HttpStatusCode.NotFound);
    }

    [Theory]
    [MemberData(nameof(Databases), MemberType = typeof(TaskApiWorld))]
    public async Task Keys_read_with_tasks_read_and_every_refusal_is_a_problem(string kind)
    {
        var (world, ben) = await Seeded(fixture, kind);
        using var _ = world;

        var reader = await world.KeyAsync(ben, "tasks:read");
        Assert.Equal(["T1", "T2", "T3", "T4"], Ids(await Get(reader, "/api/v1/tasks")));
        var me = await Get(reader, "/api/v1/me");
        Assert.Equal(ben.Id, (string?)me["id"]);
        Assert.Equal("ben", (string?)me["username"]);
        Assert.Equal("Test key", (string?)me["key"]!["name"]);
        Assert.Equal(["tasks:read"], me["key"]!["scopes"]!.AsArray().Select(scope => (string)scope!));
        Assert.Null((await Get(ben.Session, "/api/v1/me"))["key"]);

        // A key without tasks:read may still ask who it is, nothing more.
        var other = await world.KeyAsync(ben, "notifications");
        Assert.Equal(ben.Id, (string?)(await Get(other, "/api/v1/me"))["id"]);
        Assert.Equal("scope", (string?)(await Get(other, "/api/v1/tasks", HttpStatusCode.Forbidden))["code"]);

        var nobody = world.Server.CreateClient();
        var unauthorized = await Get(nobody, "/api/v1/tasks", HttpStatusCode.Unauthorized);
        Assert.Equal("unauthorized", (string?)unauthorized["code"]);
        nobody.DefaultRequestHeaders.Authorization = new("Bearer", "pl_nope_nothing");
        Assert.Equal("unauthorized", (string?)(await Get(nobody, "/api/v1/me", HttpStatusCode.Unauthorized))["code"]);

        Assert.Equal("invalid_request", (string?)(await Get(ben.Session, "/api/v1/tasks?stauts=open", HttpStatusCode.BadRequest))["code"]);
        Assert.Equal("invalid_request", (string?)(await Get(ben.Session, "/api/v1/tasks?status=later", HttpStatusCode.BadRequest))["code"]);
        Assert.Equal("invalid_request", (string?)(await Get(ben.Session, "/api/v1/tasks?limit=501", HttpStatusCode.BadRequest))["code"]);
        Assert.Equal("invalid_request", (string?)(await Get(ben.Session, "/api/v1/tasks?dueBefore=friday", HttpStatusCode.BadRequest))["code"]);
        Assert.Equal("invalid_cursor", (string?)(await Get(ben.Session, "/api/v1/tasks?cursor=no%20such", HttpStatusCode.BadRequest))["code"]);
    }
}
