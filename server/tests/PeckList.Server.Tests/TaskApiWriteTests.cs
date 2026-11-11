using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using PeckList.Server.Auth;
using static PeckList.Server.Tests.TaskApiWorld;

namespace PeckList.Server.Tests;

/// <summary>The task API's writes (PL-137) on SQLite and PostgreSQL: per-field changes through the sync rules.</summary>
public sealed class TaskApiWriteTests(ServerFixture fixture) : IClassFixture<ServerFixture>
{
    private static CancellationToken Token => TestContext.Current.CancellationToken;

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

    private static string[] Strings(JsonNode? array) => [.. array!.AsArray().Select(item => (string)item!)];

    private static async Task<(TaskApiWorld World, Person Ben)> Start(ServerFixture fixture, string kind)
    {
        var world = await StartAsync(fixture, kind);
        var ben = await world.PersonAsync("ben");
        await PushAsync(ben, List("IN", "Inbox", inbox: true), List("L1", "Home"), List("L2", "Work"), Section("S1", "L1", "Outside"), Tag("G1", "yard"));
        return (world, ben);
    }

    [Theory]
    [MemberData(nameof(Databases), MemberType = typeof(TaskApiWorld))]
    public async Task A_create_lands_in_the_inbox_makes_missing_tags_and_is_safe_to_repeat(string kind)
    {
        var (world, ben) = await Start(fixture, kind);
        using var _ = world;
        var api = ben.Session;

        var made = await Expect(api, HttpMethod.Post, "/api/v1/tasks", new { id = "01JD00000000000000000000A1", title = "  Mow the lawn ", tags = new[] { "Yard", "home/Garden Beds" }, priority = 3, due = new { at = "2026-11-12" } }, HttpStatusCode.Created);
        Assert.Equal("01JD00000000000000000000A1", (string?)made["id"]);
        Assert.Equal("Mow the lawn", (string?)made["title"]);
        Assert.Equal("IN", (string?)made["listId"]);
        Assert.Equal(["home/garden-beds", "yard"], Strings(made["tags"]));
        Assert.Equal(3, (int)made["priority"]!);
        Assert.Equal("open", (string?)made["status"]);
        Assert.True((bool)made["due"]!["allDay"]!);
        Assert.False(string.IsNullOrEmpty((string?)made["due"]!["timeZone"]));
        Assert.Equal(ben.Id, (string?)made["createdBy"]);
        // The parent tag came too, and the existing one was reused.
        var tags = (await api.GetFromJsonAsync<JsonObject>("/api/v1/tags", Token))!["items"]!.AsArray();
        Assert.Equal(["home", "home/garden-beds", "yard"], tags.Select(tag => (string)tag!["name"]!));
        Assert.Equal("G1", (string?)tags.Single(tag => (string)tag!["name"]! == "yard")!["id"]);

        // The same create again (a retry): the task as it is, no second one.
        var again = await Expect(api, HttpMethod.Post, "/api/v1/tasks", new { id = "01JD00000000000000000000A1", title = "Something else" }, HttpStatusCode.OK);
        Assert.Equal("Mow the lawn", (string?)again["title"]);
        var all = (await api.GetFromJsonAsync<JsonObject>("/api/v1/tasks", Token))!["items"]!.AsArray();
        Assert.Single(all);
        // An id something else holds is taken, whatever it is.
        await Expect(api, HttpMethod.Post, "/api/v1/lists", new { id = "01JD00000000000000000000T1", name = "Taken" }, HttpStatusCode.Created);
        Assert.Equal("id_taken", (string?)(await Expect(api, HttpMethod.Post, "/api/v1/tasks", new { id = "01JD00000000000000000000T1", title = "x" }, HttpStatusCode.Conflict))["code"]);
        // An id of your own is a ULID, as the apps make and the schema requires.
        var notUlid = await Expect(api, HttpMethod.Post, "/api/v1/tasks", new { id = "my-task-1", title = "x" }, HttpStatusCode.BadRequest);
        Assert.Contains("ULID", notUlid["errors"]!["id"]![0]!.GetValue<string>());

        // In a list and a section, as a subtask (which takes its parent's list and tags).
        await Expect(api, HttpMethod.Post, "/api/v1/tasks", new { id = "01JD00000000000000000000A2", title = "Edge", listId = "L1", sectionId = "S1", tags = new[] { "yard" } }, HttpStatusCode.Created);
        var child = await Expect(api, HttpMethod.Post, "/api/v1/tasks", new { id = "01JD00000000000000000000A3", title = "Buy string", parentId = "01JD00000000000000000000A2" }, HttpStatusCode.Created);
        Assert.Equal("L1", (string?)child["listId"]);
        Assert.Equal(["yard"], Strings(child["tags"]));

        var bad = await Expect(api, HttpMethod.Post, "/api/v1/tasks", new { notes = "no title", colour = "red", priority = 7 }, HttpStatusCode.BadRequest);
        Assert.Equal("invalid_request", (string?)bad["code"]);
        Assert.NotNull(bad["errors"]!["title"]);
        Assert.NotNull(bad["errors"]!["colour"]);
        Assert.NotNull(bad["errors"]!["priority"]);
        Assert.Equal("listId", ((JsonObject)(await Expect(api, HttpMethod.Post, "/api/v1/tasks", new { title = "x", listId = "NOPE" }, HttpStatusCode.BadRequest))["errors"]!).Single().Key);
        Assert.Equal("sectionId", ((JsonObject)(await Expect(api, HttpMethod.Post, "/api/v1/tasks", new { title = "x", listId = "L2", sectionId = "S1" }, HttpStatusCode.BadRequest))["errors"]!).Single().Key);
        Assert.Equal("conflict", (string?)(await Expect(api, HttpMethod.Post, "/api/v1/tasks", new { title = "x", listId = "L2", parentId = "01JD00000000000000000000A2" }, HttpStatusCode.Conflict))["code"]);
        var notJson = await api.PostAsync("/api/v1/tasks", new StringContent("{nope", System.Text.Encoding.UTF8, "application/json"), Token);
        Assert.Equal(HttpStatusCode.BadRequest, notJson.StatusCode);
    }

    [Theory]
    [MemberData(nameof(Databases), MemberType = typeof(TaskApiWorld))]
    public async Task A_patch_changes_only_the_fields_it_sends_and_an_edit_elsewhere_survives(string kind)
    {
        var (world, ben) = await Start(fixture, kind);
        using var _ = world;
        var api = ben.Session;
        await PushAsync(ben, Task("T1", "L1", "Mow", tags: ["G1"]), Task("T2", "L1", "Rake"), Task("T3", "L1", "Bag", parent: "T2"));
        var read = await api.GetFromJsonAsync<JsonObject>("/api/v1/tasks/T1", Token);

        // The phone renames it after the script read it; the script then sets a due date.
        var phone = Task("T1", "L1", "Mow the lawn", tags: ["G1"]);
        await PushAsync(ben, phone);
        var patched = await Expect(api, HttpMethod.Patch, "/api/v1/tasks/T1", new { due = new { at = "2026-11-12", timeZone = "Europe/Amsterdam" }, notes = "front first" }, HttpStatusCode.OK);
        Assert.Equal("Mow the lawn", (string?)patched["title"]);
        Assert.Equal("2026-11-12", (string?)patched["due"]!["at"]);
        Assert.Equal("Europe/Amsterdam", (string?)patched["due"]!["timeZone"]);
        Assert.Equal("front first", (string?)patched["notes"]);
        Assert.NotEqual((string?)read!["updatedAt"], (string?)patched["updatedAt"]);
        Assert.Equal("Mow the lawn", (string?)(await Expect(api, HttpMethod.Patch, "/api/v1/tasks/T1", new { due = (object?)null }, HttpStatusCode.OK))["title"]);

        // Tags: add and remove one at a time, or replace the set.
        Assert.Equal(["chores", "yard"], Strings((await Expect(api, HttpMethod.Patch, "/api/v1/tasks/T1", new { addTags = new[] { "chores" } }, HttpStatusCode.OK))["tags"]));
        Assert.Equal(["chores"], Strings((await Expect(api, HttpMethod.Patch, "/api/v1/tasks/T1", new { removeTags = new[] { "yard" } }, HttpStatusCode.OK))["tags"]));
        Assert.Equal(["weekly"], Strings((await Expect(api, HttpMethod.Patch, "/api/v1/tasks/T1", new { tags = new[] { "weekly" } }, HttpStatusCode.OK))["tags"]));
        await Expect(api, HttpMethod.Patch, "/api/v1/tasks/T1", new { tags = new[] { "a" }, addTags = new[] { "b" } }, HttpStatusCode.BadRequest);

        // A task sent back as it was read changes nothing it shouldn't; a new status is refused.
        var whole = (await api.GetFromJsonAsync<JsonObject>("/api/v1/tasks/T1", Token))!;
        whole.Remove("tags");
        whole.Remove("assignees");
        whole["priority"] = 2;
        Assert.Equal(2, (int)(await Expect(api, HttpMethod.Patch, "/api/v1/tasks/T1", whole, HttpStatusCode.OK))["priority"]!);
        Assert.Equal("invalid_request", (string?)(await Expect(api, HttpMethod.Patch, "/api/v1/tasks/T1", new { status = "done" }, HttpStatusCode.BadRequest))["code"]);

        // Moving takes the subtasks along; nesting under its own subtask is refused.
        Assert.Equal("conflict", (string?)(await Expect(api, HttpMethod.Patch, "/api/v1/tasks/T2", new { parentId = "T3" }, HttpStatusCode.Conflict))["code"]);
        var moved = await Expect(api, HttpMethod.Patch, "/api/v1/tasks/T2", new { listId = "L2" }, HttpStatusCode.OK);
        Assert.Equal("L2", (string?)moved["listId"]);
        Assert.Equal("L2", (string?)(await api.GetFromJsonAsync<JsonObject>("/api/v1/tasks/T3", Token))!["listId"]);
        var nested = await Expect(api, HttpMethod.Patch, "/api/v1/tasks/T1", new { listId = "L2", parentId = "T2", pinned = true }, HttpStatusCode.OK);
        Assert.Equal("T2", (string?)nested["parentId"]);
        Assert.True((bool)nested["pinned"]!);
        await Expect(api, HttpMethod.Patch, "/api/v1/tasks/NOPE", new { title = "x" }, HttpStatusCode.NotFound);
    }

    [Theory]
    [MemberData(nameof(Databases), MemberType = typeof(TaskApiWorld))]
    public async Task Complete_reopen_delete_and_restore_carry_subtasks_comments_and_files(string kind)
    {
        var (world, ben) = await Start(fixture, kind);
        using var _ = world;
        var api = ben.Session;
        await PushAsync(ben, Task("T1", "L1", "Paint"), Task("T2", "L1", "Sand", parent: "T1"), Task("T3", "L1", "Prime", parent: "T1", status: "done"),
            ("comments", Entity("C1", new JsonObject { ["taskId"] = "T2", ["body"] = "Use 120 grit", ["editedAt"] = null })));

        var done = await Expect(api, HttpMethod.Post, "/api/v1/tasks/T1/complete", null, HttpStatusCode.OK);
        Assert.Equal("done", (string?)done["completed"]!["status"]);
        Assert.Equal(ben.Id, (string?)done["completed"]!["completedBy"]);
        Assert.Null(done["next"]);
        Assert.Equal("done", (string?)(await api.GetFromJsonAsync<JsonObject>("/api/v1/tasks/T2", Token))!["status"]);
        // Again: nothing more happens.
        Assert.Equal(done["completed"]!["completedAt"]!.ToJsonString(), (await Expect(api, HttpMethod.Post, "/api/v1/tasks/T1/complete", new { status = "wontdo" }, HttpStatusCode.OK))["completed"]!["completedAt"]!.ToJsonString());
        var reopened = await Expect(api, HttpMethod.Post, "/api/v1/tasks/T1/reopen", null, HttpStatusCode.OK);
        Assert.Equal("open", (string?)reopened["status"]);
        Assert.Null(reopened["completedAt"]);
        Assert.Equal("wontdo", (string?)(await Expect(api, HttpMethod.Post, "/api/v1/tasks/T1/complete", new { status = "wontdo" }, HttpStatusCode.OK))["completed"]!["status"]);
        await Expect(api, HttpMethod.Post, "/api/v1/tasks/T1/complete", new { status = "later" }, HttpStatusCode.BadRequest);
        await Expect(api, HttpMethod.Post, "/api/v1/tasks/T1/reopen", null, HttpStatusCode.OK);

        Assert.Equal(HttpStatusCode.NoContent, (await api.DeleteAsync("/api/v1/tasks/T1", Token)).StatusCode);
        var trash = (await api.GetFromJsonAsync<JsonObject>("/api/v1/tasks?deleted=true&status=all", Token))!["items"]!.AsArray();
        Assert.Equal(["T1", "T2", "T3"], trash.Select(task => (string)task!["id"]!));
        var comment = await world.Server.Services.GetRequiredService<Core.Storage.IEntityStore>().GetAsync("C1", Token);
        Assert.Equal((string?)trash[0]!["deletedAt"], (string?)comment!.Doc["deletedAt"]);

        var back = await Expect(api, HttpMethod.Post, "/api/v1/tasks/T1/restore", null, HttpStatusCode.OK);
        Assert.Null(back["deletedAt"]);
        Assert.Equal(["T1", "T2", "T3"], (await api.GetFromJsonAsync<JsonObject>("/api/v1/tasks?status=all", Token))!["items"]!.AsArray().Select(task => (string)task!["id"]!));
        comment = await world.Server.Services.GetRequiredService<Core.Storage.IEntityStore>().GetAsync("C1", Token);
        Assert.Null(comment!.Doc["deletedAt"]);
    }

    [Theory]
    [MemberData(nameof(Databases), MemberType = typeof(TaskApiWorld))]
    public async Task Lists_are_renamed_by_their_owner_and_sections_and_tasks_by_editors_too(string kind)
    {
        var (world, ben) = await Start(fixture, kind);
        using var _ = world;
        var sam = await world.PersonAsync("sam");
        var lee = await world.PersonAsync("lee");
        await world.BefriendAsync(ben, sam);
        await world.BefriendAsync(ben, lee);
        await PushAsync(ben, List("SH", "Chores", visibility: "shared"), Member("M1", "SH", sam.Id, "editor"), Member("M2", "SH", lee.Id, "viewer"), Task("T1", "SH", "Dishes"));

        var list = await Expect(ben.Session, HttpMethod.Post, "/api/v1/lists", new { id = "01JD00000000000000000000N1", name = "Garden", color = "#3a7d44" }, HttpStatusCode.Created);
        Assert.Equal(("Garden", "#3A7D44", "owner", false), ((string?)list["name"], (string?)list["color"], (string?)list["role"], (bool)list["shared"]!));
        Assert.Equal("Garden", (string?)(await Expect(ben.Session, HttpMethod.Post, "/api/v1/lists", new { id = "01JD00000000000000000000N1", name = "Other" }, HttpStatusCode.OK))["name"]);
        Assert.Equal("Veg garden", (string?)(await Expect(ben.Session, HttpMethod.Patch, "/api/v1/lists/01JD00000000000000000000N1", new { name = "Veg garden" }, HttpStatusCode.OK))["name"]);

        var section = await Expect(sam.Session, HttpMethod.Post, "/api/v1/sections", new { listId = "SH", name = "Kitchen" }, HttpStatusCode.Created);
        Assert.Equal("SH", (string?)section["listId"]);
        Assert.Equal("Galley", (string?)(await Expect(sam.Session, HttpMethod.Patch, $"/api/v1/sections/{section["id"]}", new { name = "Galley" }, HttpStatusCode.OK))["name"]);
        // The list itself is its owner's to rename, as in the app.
        Assert.Equal("forbidden", (string?)(await Expect(sam.Session, HttpMethod.Patch, "/api/v1/lists/SH", new { name = "Mine now" }, HttpStatusCode.Forbidden))["code"]);
        Assert.Equal("Shared chores", (string?)(await Expect(ben.Session, HttpMethod.Patch, "/api/v1/lists/SH", new { name = "Shared chores" }, HttpStatusCode.OK))["name"]);
        Assert.Equal("Wash up", (string?)(await Expect(sam.Session, HttpMethod.Patch, "/api/v1/tasks/T1", new { title = "Wash up" }, HttpStatusCode.OK))["title"]);

        // A viewer sees but may not change; someone else sees nothing.
        Assert.Equal("forbidden", (string?)(await Expect(lee.Session, HttpMethod.Patch, "/api/v1/tasks/T1", new { title = "x" }, HttpStatusCode.Forbidden))["code"]);
        Assert.Equal("forbidden", (string?)(await Expect(lee.Session, HttpMethod.Patch, "/api/v1/lists/SH", new { name = "x" }, HttpStatusCode.Forbidden))["code"]);
        Assert.Equal("forbidden", (string?)(await Expect(lee.Session, HttpMethod.Post, "/api/v1/tasks", new { title = "x", listId = "SH" }, HttpStatusCode.Forbidden))["code"]);
        Assert.Equal("forbidden", (string?)(await Expect(lee.Session, HttpMethod.Post, "/api/v1/tasks/T1/complete", null, HttpStatusCode.Forbidden))["code"]);
        Assert.Equal("Wash up", (string?)(await ben.Session.GetFromJsonAsync<JsonObject>("/api/v1/tasks/T1", Token))!["title"]);
        var outsider = await world.PersonAsync("max");
        await Expect(outsider.Session, HttpMethod.Patch, "/api/v1/lists/01JD00000000000000000000N1", new { name = "x" }, HttpStatusCode.NotFound);
        await Expect(outsider.Session, HttpMethod.Delete, "/api/v1/tasks/T1", null, HttpStatusCode.NotFound);
        // People one may not assign are refused the same way whether they exist or not.
        var stranger = await Expect(ben.Session, HttpMethod.Patch, "/api/v1/tasks/T1", new { assignees = new[] { $"user:{outsider.Id}" } }, HttpStatusCode.BadRequest);
        var nobody = await Expect(ben.Session, HttpMethod.Patch, "/api/v1/tasks/T1", new { assignees = new[] { "user:01ARZ3NDEKTSV4RRFFQ69G5FAV" } }, HttpStatusCode.BadRequest);
        Assert.Equal(stranger["errors"]!.ToJsonString(), nobody["errors"]!.ToJsonString());
        Assert.Equal([$"user:{sam.Id}"], Strings((await Expect(ben.Session, HttpMethod.Patch, "/api/v1/tasks/T1", new { assignees = new[] { $"user:{sam.Id}" } }, HttpStatusCode.OK))["assignees"]));
    }

    [Theory]
    [MemberData(nameof(Databases), MemberType = typeof(TaskApiWorld))]
    public async Task Every_v1_route_asks_a_key_for_the_right_scope_and_view_as_only_reads(string kind)
    {
        var (world, ben) = await Start(fixture, kind);
        using var _ = world;
        var reader = await world.KeyAsync(ben, "tasks:read");
        var other = await world.KeyAsync(ben, "notifications");
        var routes = world.Server.Services.GetRequiredService<EndpointDataSource>().Endpoints.OfType<RouteEndpoint>()
            .Where(endpoint => endpoint.RoutePattern.RawText?.StartsWith("/api/v1/", StringComparison.Ordinal) == true)
            .SelectMany(endpoint => (endpoint.Metadata.GetMetadata<HttpMethodMetadata>()?.HttpMethods ?? []).Select(method => (method, endpoint.RoutePattern.RawText!)))
            .ToList();
        Assert.True(routes.Count >= 18, $"{routes.Count} routes");
        foreach (var (method, pattern) in routes)
        {
            var path = pattern.Replace("{id}", "NOPE", StringComparison.Ordinal);
            var isRead = method == "GET";
            foreach (var (key, may) in new[] { (reader, isRead), (other, path == "/api/v1/me") })
            {
                var (status, body) = await Send(key, new HttpMethod(method), path, isRead ? null : new { });
                var refused = status == HttpStatusCode.Forbidden && (string?)body["code"] == "scope";
                Assert.True(refused != may, $"{method} {path}: {(int)status} {body.ToJsonString()}");
            }
        }

        // Viewing as someone reads their tasks through v1 and writes nothing.
        var sam = await world.PersonAsync("sam");
        await PushAsync(sam, List("SL", "Sam's"), Task("ST", "SL", "Sam's task"));
        var root = world.Server.CreateClient();
        (await root.PostAsJsonAsync("/auth/login", new { username = "admin", password = AdminPassword }, Token)).EnsureSuccessStatusCode();
        var started = await root.PostAsJsonAsync($"/api/admin/users/{sam.Id}/impersonate", new { reason = "help" }, Token);
        var view = (await started.Content.ReadFromJsonAsync<JsonObject>(Token))!["token"]!.GetValue<string>();
        root.DefaultRequestHeaders.Add(ImpersonationSetup.Header, view);
        Assert.Equal("Sam's task", (string?)(await root.GetFromJsonAsync<JsonObject>("/api/v1/tasks/ST", Token))!["title"]);
        Assert.Equal("not_while_impersonating", (string?)(await Expect(root, HttpMethod.Patch, "/api/v1/tasks/ST", new { title = "x" }, HttpStatusCode.Forbidden))["code"]);
    }

    [Theory]
    [MemberData(nameof(Databases), MemberType = typeof(TaskApiWorld))]
    public async Task Completing_a_repeating_task_keeps_a_closed_copy_and_moves_the_task_to_its_next_date(string kind)
    {
        var (world, ben) = await Start(fixture, kind);
        using var _ = world;
        var api = ben.Session;
        await PushAsync(ben,
            Task("R1", "L1", "Water plants", start: "2020-01-06", recurrence: "FREQ=WEEKLY", tags: ["G1"]),
            Task("R2", "L1", "Fill can", parent: "R1", status: "done"),
            Task("R3", "L1", "Last time", due: "2020-01-06", recurrence: "FREQ=DAILY;COUNT=1"));

        var result = await Expect(api, HttpMethod.Post, "/api/v1/tasks/R1/complete", null, HttpStatusCode.OK);
        var closed = result["completed"]!;
        var next = result["next"]!;
        Assert.NotEqual("R1", (string?)closed["id"]);
        Assert.Equal(("done", "Water plants", "2020-01-06"), ((string?)closed["status"], (string?)closed["title"], (string?)closed["schedule"]!["start"]));
        Assert.Null(closed["recurrence"]);
        Assert.Equal(["yard"], Strings(closed["tags"]));
        Assert.Equal("R1", (string?)next["id"]);
        Assert.Equal("open", (string?)next["status"]);
        Assert.Equal("FREQ=WEEKLY", (string?)next["recurrence"]);
        // One step on from its own date, as the app moves it (X-PL-FROM=COMPLETION would count from today).
        Assert.Equal("2020-01-13", (string?)next["schedule"]!["start"]);
        // Its subtasks are open again for the next time.
        Assert.Equal("open", (string?)(await api.GetFromJsonAsync<JsonObject>("/api/v1/tasks/R2", Token))!["status"]);
        // The history copy is a done task of its own.
        Assert.Equal("done", (string?)(await api.GetFromJsonAsync<JsonObject>($"/api/v1/tasks/{closed["id"]}", Token))!["status"]);

        // Its last time, it closes like any task.
        var last = await Expect(api, HttpMethod.Post, "/api/v1/tasks/R3/complete", new { status = "wontdo" }, HttpStatusCode.OK);
        Assert.Equal(("R3", "wontdo"), ((string?)last["completed"]!["id"], (string?)last["completed"]!["status"]));
        Assert.Null(last["next"]);
    }

    [Theory]
    [MemberData(nameof(Databases), MemberType = typeof(TaskApiWorld))]
    public async Task A_refused_write_leaves_nothing_half_made_and_one_request_makes_only_so_many_tags(string kind)
    {
        var (world, ben) = await Start(fixture, kind);
        using var _ = world;
        var lee = await world.PersonAsync("lee");
        await world.BefriendAsync(ben, lee);
        await PushAsync(ben, List("SH", "Chores", visibility: "shared"), Member("M2", "SH", lee.Id, "viewer"));
        async Task<string[]> TagsOf(Person person) =>
            [.. (await person.Session.GetFromJsonAsync<JsonObject>("/api/v1/tags", Token))!["items"]!.AsArray().Select(tag => (string)tag!["name"]!)];

        // A viewer's task is refused, and the new tag it named is not made either.
        Assert.Equal("forbidden", (string?)(await Expect(lee.Session, HttpMethod.Post, "/api/v1/tasks", new { title = "x", listId = "SH", tags = new[] { "brand-new" } }, HttpStatusCode.Forbidden))["code"]);
        Assert.DoesNotContain("brand-new", await TagsOf(lee));

        // Parents count: three paths 40 deep are 120 new tags.
        var deep = string.Join('/', Enumerable.Repeat("x", 39));
        var many = await Expect(ben.Session, HttpMethod.Post, "/api/v1/tasks", new { title = "Deep", tags = new[] { $"a/{deep}", $"b/{deep}", $"c/{deep}" } }, HttpStatusCode.BadRequest);
        Assert.True(many["errors"]!.AsObject().ContainsKey("tags"), many.ToJsonString());
        Assert.Equal(["yard"], await TagsOf(ben));
        await Expect(ben.Session, HttpMethod.Post, "/api/v1/tasks", new { title = "Deep", tags = new[] { $"a/{deep}", $"b/{deep}" } }, HttpStatusCode.Created);

        // A repeat too far apart to work out is refused up front.
        var far = await Expect(ben.Session, HttpMethod.Post, "/api/v1/tasks", new { title = "Rare", recurrence = "FREQ=DAILY;INTERVAL=1000" }, HttpStatusCode.BadRequest);
        Assert.True(far["errors"]!.AsObject().ContainsKey("recurrence"), far.ToJsonString());
    }
}
