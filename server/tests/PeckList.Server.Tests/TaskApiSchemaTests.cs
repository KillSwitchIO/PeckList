using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.DependencyInjection;
using PeckList.Core.Storage;
using PeckList.Core.Sync;
using static PeckList.Server.Tests.TaskApiWorld;

namespace PeckList.Server.Tests;

/// <summary>
/// Every write the task API makes, against the real workspace schema check (the other API tests use
/// the test host's accept-anything one, so their short seed data can stay short). The API builds
/// entities in code; whatever it builds must be what the apps would accept.
/// </summary>
public sealed class TaskApiSchemaTests(ServerFixture fixture) : IClassFixture<ServerFixture>
{
    private static CancellationToken Token => TestContext.Current.CancellationToken;

    private static async Task<JsonObject> Expect(HttpClient client, HttpMethod method, string path, object? body, HttpStatusCode expected)
    {
        using var request = new HttpRequestMessage(method, path) { Content = body is null ? null : JsonContent.Create(body) };
        var response = await client.SendAsync(request, Token);
        var text = await response.Content.ReadAsStringAsync(Token);
        Assert.True(response.StatusCode == expected, $"{method} {path}: {(int)response.StatusCode} {text}");
        return text.Length == 0 ? [] : JsonNode.Parse(text)!.AsObject();
    }

    private static string Id(JsonObject made) => (string)made["id"]!;

    [Theory]
    [MemberData(nameof(Databases), MemberType = typeof(TaskApiWorld))]
    public async Task Every_write_the_api_makes_passes_the_real_schema_check(string kind)
    {
        using var world = await StartWithSchemaAsync(fixture, kind);
        var ben = await world.PersonAsync("ben");
        var api = await world.KeyAsync(ben, "tasks:read", "tasks:write");
        var post = HttpMethod.Post;
        var patch = HttpMethod.Patch;

        var list = Id(await Expect(api, post, "/api/v1/lists", new { name = "Home", color = "#3b82f6" }, HttpStatusCode.Created));
        await Expect(api, patch, $"/api/v1/lists/{list}", new { name = "House", color = "#22aa66" }, HttpStatusCode.OK);
        var section = Id(await Expect(api, post, "/api/v1/sections", new { listId = list, name = "Kitchen" }, HttpStatusCode.Created));
        await Expect(api, patch, $"/api/v1/sections/{section}", new { name = "Pantry" }, HttpStatusCode.OK);

        var task = Id(await Expect(api, post, "/api/v1/tasks", new
        {
            title = "Clean the oven",
            notes = "Both racks",
            listId = list,
            sectionId = section,
            priority = 2,
            progress = 30,
            tags = new[] { "home/kitchen", "weekend" },
            schedule = new { start = "2026-11-14T09:00", end = "2026-11-14T10:00", timeZone = "America/Chicago" },
            due = new { at = "2026-11-15" },
            recurrence = "FREQ=WEEKLY;BYDAY=SA",
            pinned = true,
        }, HttpStatusCode.Created));
        var sub = Id(await Expect(api, post, "/api/v1/tasks", new { title = "Buy cleaner", parentId = task }, HttpStatusCode.Created));
        await Expect(api, patch, $"/api/v1/tasks/{task}", new
        {
            title = "Clean the oven well",
            priority = 3,
            progress = 50,
            due = new { at = "2026-11-15T18:00", timeZone = "America/Chicago" },
            addTags = new[] { "chores" },
            removeTags = new[] { "weekend" },
            pinned = false,
        }, HttpStatusCode.OK);
        await Expect(api, patch, $"/api/v1/tasks/{task}", new { schedule = (object?)null, due = (object?)null, recurrence = (string?)null }, HttpStatusCode.OK);
        await Expect(api, patch, $"/api/v1/tasks/{task}", new { recurrence = "FREQ=DAILY" }, HttpStatusCode.OK);

        // A repeating task moves on and leaves a closed copy; then close, reopen, delete, restore.
        await Expect(api, post, $"/api/v1/tasks/{task}/complete", null, HttpStatusCode.OK);
        await Expect(api, post, $"/api/v1/tasks/{sub}/complete", new { status = "wontdo" }, HttpStatusCode.OK);
        await Expect(api, post, $"/api/v1/tasks/{sub}/reopen", null, HttpStatusCode.OK);
        await Expect(api, HttpMethod.Delete, $"/api/v1/tasks/{task}", null, HttpStatusCode.NoContent);
        await Expect(api, post, $"/api/v1/tasks/{task}/restore", null, HttpStatusCode.OK);

        // Quick add: a timed, repeating line with a new tag and a priority.
        var quick = await Expect(api, post, "/api/v1/tasks/quick",
            new { text = "Water plants tomorrow at 9am #garden !high every week", timeZone = "America/Chicago", listId = list },
            HttpStatusCode.Created);
        Assert.Equal("FREQ=WEEKLY", (string?)quick["task"]!["recurrence"]);

        // An id of your own (a ULID) is stored as it is; anything else is refused before it is tried.
        const string own = "01JD00000000000000000000S1";
        Assert.Equal(own, Id(await Expect(api, post, "/api/v1/tasks", new { id = own, title = "Own id", listId = list }, HttpStatusCode.Created)));
        await Expect(api, post, "/api/v1/tasks", new { id = "my-task-1", title = "Own id", listId = list }, HttpStatusCode.BadRequest);

        // All of it reads back.
        var tasks = (await api.GetFromJsonAsync<JsonObject>("/api/v1/tasks?status=all", Token))!["items"]!.AsArray();
        Assert.True(tasks.Count >= 3, tasks.ToJsonString());
    }

    [Theory]
    [MemberData(nameof(Databases), MemberType = typeof(TaskApiWorld))]
    public async Task Notes_are_taken_up_to_the_workspace_schemas_limit_and_refused_past_it(string kind)
    {
        // One limit, the schema's (0.14.0): the API refused notes over 80,000 characters while the
        // apps kept 100,000, so a task written in the app could not be edited through the CLI.
        using var embedded = typeof(Api.ApiTaskInput).Assembly.GetManifestResourceStream("workspace.schema.json")!;
        var limit = (int)JsonNode.Parse(embedded)!["$defs"]!["task"]!["properties"]!["notes"]!["maxLength"]!;
        Assert.Equal(Core.Api.TaskInput.MaxNotes, limit);
        Assert.Equal(Core.Api.ApiShapes.MaxStoredNotes, limit);

        using var world = await StartWithSchemaAsync(fixture, kind);
        var ben = await world.PersonAsync("ben");
        var api = await world.KeyAsync(ben, "tasks:read", "tasks:write");
        var list = Id(await Expect(api, HttpMethod.Post, "/api/v1/lists", new { name = "Home" }, HttpStatusCode.Created));
        var made = await Expect(api, HttpMethod.Post, "/api/v1/tasks",
            new { title = "Read the manual", listId = list, notes = new string('a', limit) }, HttpStatusCode.Created);
        Assert.Equal(limit, ((string)made["notes"]!).Length);

        var refused = await Expect(api, HttpMethod.Patch, $"/api/v1/tasks/{Id(made)}",
            new { notes = new string('b', limit + 1) }, HttpStatusCode.BadRequest);
        Assert.Equal($"at most {limit} characters", (string?)refused["errors"]!["notes"]![0]);
        var kept = await Expect(api, HttpMethod.Get, $"/api/v1/tasks/{Id(made)}", null, HttpStatusCode.OK);
        Assert.Equal(new string('a', limit), (string?)kept["notes"]);
    }

    [Theory]
    [MemberData(nameof(Databases), MemberType = typeof(TaskApiWorld))]
    public async Task A_task_stored_with_notes_over_the_limit_can_still_be_changed_and_its_notes_are_cut_for_everyone(string kind)
    {
        using var world = await StartWithSchemaAsync(fixture, kind);
        var ben = await world.PersonAsync("ben");
        var api = await world.KeyAsync(ben, "tasks:read", "tasks:write");
        var list = Id(await Expect(api, HttpMethod.Post, "/api/v1/lists", new { name = "Home" }, HttpStatusCode.Created));
        var task = Id(await Expect(api, HttpMethod.Post, "/api/v1/tasks", new { title = "Read the manual", listId = list }, HttpStatusCode.Created));

        // Notes kept before the limit (0.14.0): written as the server, past the schema check.
        // An emoji straddles the limit, so the cut must not split it.
        var longNotes = new string('a', Core.Api.ApiShapes.MaxStoredNotes - 1) + "\U0001F44D" + "tail";
        var services = world.Server.Services;
        var clock = services.GetRequiredService<ServerClock>();
        await services.GetRequiredService<SyncService>().WriteAsServerAsync(ben.Id,
            [new IncomingEntity("tasks", ServerEntities.Change(task, clock.Next(), new JsonObject { ["notes"] = longNotes }))], Token);
        var store = services.GetRequiredService<IEntityStore>();
        var before = (string)(await store.GetAsync(task, Token))!.Doc["_hlc"]!["notes"]!;

        await Expect(api, HttpMethod.Patch, $"/api/v1/tasks/{task}", new { title = "Read the whole manual" }, HttpStatusCode.OK);
        var stored = (await store.GetAsync(task, Token))!.Doc;
        var notes = (string)stored["notes"]!;
        Assert.Equal(new string('a', Core.Api.ApiShapes.MaxStoredNotes - 1), notes);
        // A fresh clock: every device takes the cut copy over its long one.
        Assert.True(string.CompareOrdinal((string)stored["_hlc"]!["notes"]!, before) > 0);
        Assert.Equal("Read the whole manual", (string?)stored["title"]);

        await Expect(api, HttpMethod.Post, $"/api/v1/tasks/{task}/complete", null, HttpStatusCode.OK);
    }
}
