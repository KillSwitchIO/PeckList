using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.DependencyInjection;
using ModelContextProtocol.Client;
using ModelContextProtocol.Protocol;
using PeckList.Core.Accounts;
using PeckList.Core.Audit;
using PeckList.Server.Api;
using PeckList.Server.Audit;
using PeckList.Server.Mcp;
using static PeckList.Server.Tests.TaskApiWorld;

namespace PeckList.Server.Tests;

/// <summary>
/// The MCP connector's tool set (PL-113, piece 2): the writes go through the task API's own
/// services as the key's owner, so its sharing rules, checks and repeats hold; a repeating task
/// closes only the occurrence asked for; writes take from the task API's write limit and are audited
/// with the key they came by.
/// </summary>
public sealed class McpToolTests(ServerFixture fixture) : IClassFixture<ServerFixture>
{
    private static CancellationToken Token => TestContext.Current.CancellationToken;

    private static Task<McpClient> Connect(HttpClient keyed) =>
        McpClient.CreateAsync(
            new HttpClientTransport(
                new HttpClientTransportOptions { Endpoint = new Uri(keyed.BaseAddress!, "/mcp"), TransportMode = HttpTransportMode.StreamableHttp },
                keyed, loggerFactory: null, ownsHttpClient: true),
            cancellationToken: Token);

    private static async Task<McpClient> ConnectAs(TaskApiWorld world, Person person, params string[] scopes) =>
        await Connect(await world.KeyAsync(person, scopes.Length > 0 ? scopes : [ApiScopes.TasksRead, ApiScopes.TasksWrite]));

    private static Task<CallToolResult> Call(McpClient client, string tool, object? arguments = null) =>
        client.CallToolAsync(
            tool,
            arguments is null
                ? null
                : JsonSerializer.SerializeToElement(arguments).EnumerateObject().ToDictionary(each => each.Name, each => (object?)each.Value),
            cancellationToken: Token).AsTask();

    /// <summary>A tool's structured answer, which must not be an error.</summary>
    private static async Task<JsonElement> Answer(McpClient client, string tool, object? arguments = null)
    {
        var result = await Call(client, tool, arguments);
        Assert.True(result.IsError != true, ErrorText(result));
        return result.StructuredContent!.Value;
    }

    /// <summary>A tool's error text, which it must answer.</summary>
    private static async Task<string> Refused(McpClient client, string tool, object? arguments = null)
    {
        var result = await Call(client, tool, arguments);
        Assert.True(result.IsError, $"{tool} was not refused");
        return ErrorText(result);
    }

    private static string ErrorText(CallToolResult result) =>
        string.Join(" ", result.Content.OfType<TextContentBlock>().Select(block => block.Text));

    private static string? Text(JsonElement element, string property) =>
        element.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;

    /// <summary>Null, or left out (structured results may leave out what is null).</summary>
    private static bool Empty(JsonElement element, string property) =>
        !element.TryGetProperty(property, out var value) || value.ValueKind == JsonValueKind.Null;

    private const string FirstId = "01JD00000000000000000000T1";

    /// <summary>
    /// The fields <paramref name="schema"/> requires that <paramref name="value"/> lacks, as a client
    /// checking answers against a tool's output schema finds them (the MCP Inspector does).
    /// </summary>
    private static IEnumerable<string> Missing(JsonElement schema, JsonElement value, string path = "$")
    {
        if (value.ValueKind == JsonValueKind.Object && schema.TryGetProperty("properties", out var properties))
        {
            if (schema.TryGetProperty("required", out var required))
            {
                foreach (var name in required.EnumerateArray().Select(each => each.GetString()!))
                {
                    if (!value.TryGetProperty(name, out _)) yield return $"{path}.{name}";
                }
            }
            foreach (var property in properties.EnumerateObject())
            {
                if (!value.TryGetProperty(property.Name, out var inner)) continue;
                foreach (var gap in Missing(property.Value, inner, $"{path}.{property.Name}")) yield return gap;
            }
        }
        else if (value.ValueKind == JsonValueKind.Array && schema.TryGetProperty("items", out var items))
        {
            var i = 0;
            foreach (var each in value.EnumerateArray())
            {
                foreach (var gap in Missing(items, each, $"{path}[{i++}]")) yield return gap;
            }
        }
    }

    [Fact]
    public async Task Every_answer_holds_what_its_output_schema_requires()
    {
        using var world = StartWithMcp(fixture);
        var ben = await world.PersonAsync("ben");
        // Reminders as the apps make them: before the task's time, or at a set time. Each leaves
        // the other field out in the task API, which the schema needs as null (QA, piece 2).
        var (collection, reminded) = TaskApiWorld.Task("RM", "GL", "Call the vet", due: "2026-11-23T15:00");
        reminded["reminders"] = new JsonArray(new JsonObject { ["before"] = 0 }, new JsonObject { ["at"] = "2026-11-23T09:00" });
        await PushAsync(ben, List("GL", "Garden"), (collection, reminded));
        await using var client = await ConnectAs(world, ben);
        var schemas = (await client.ListToolsAsync(cancellationToken: Token))
            .ToDictionary(tool => tool.Name, tool => tool.ProtocolTool.OutputSchema!.Value);

        // A task with most of its fields empty: each null must still be there, as null.
        var made = await Answer(client, McpTools.AddTask, new { title = "Mow the lawn", listId = "GL" });
        var id = Text(made.GetProperty("task"), "id")!;
        var answers = new List<(string Tool, JsonElement Answer)>
        {
            (McpTools.AddTask, made),
            (McpTools.ListLists, await Answer(client, McpTools.ListLists)),
            (McpTools.ListTags, await Answer(client, McpTools.ListTags)),
            (McpTools.FindTasks, await Answer(client, McpTools.FindTasks, new { listId = "GL" })),
            (McpTools.GetTask, await Answer(client, McpTools.GetTask, new { id })),
            (McpTools.GetTask, await Answer(client, McpTools.GetTask, new { id = "RM" })),
            (McpTools.QuickAdd, await Answer(client, McpTools.QuickAdd, new { text = "Buy seeds", listId = "GL" })),
            (McpTools.UpdateTask, await Answer(client, McpTools.UpdateTask, new { id, title = "Mow the front lawn" })),
            (McpTools.SetTaskNotes, await Answer(client, McpTools.SetTaskNotes, new { id, notes = "Edge too" })),
            (McpTools.CompleteTask, await Answer(client, McpTools.CompleteTask, new { id })),
            (McpTools.ReopenTask, await Answer(client, McpTools.ReopenTask, new { id })),
        };
        foreach (var (tool, answer) in answers) Assert.True(!Missing(schemas[tool], answer).Any(), $"{tool}: {string.Join(", ", Missing(schemas[tool], answer))}");
    }

    [Fact]
    public async Task Writes_make_change_close_and_reopen_tasks_as_the_task_api_does()
    {
        using var world = StartWithMcp(fixture);
        var ben = await world.PersonAsync("ben");
        await PushAsync(ben, List("GL", "Garden"));
        await using var client = await ConnectAs(world, ben);

        var made = await Answer(client, McpTools.AddTask, new
        {
            title = "Mow the lawn", listId = "GL", id = FirstId, due = "2026-11-30", tags = new[] { "yard" }, priority = "high",
        });
        Assert.True(made.GetProperty("byYou").GetBoolean());
        Assert.False(made.GetProperty("shared").GetBoolean());
        var task = made.GetProperty("task");
        Assert.Equal((FirstId, "Mow the lawn", "2026-11-30", 3), (Text(task, "id"), Text(task, "title"), Text(task.GetProperty("due"), "at"), task.GetProperty("priority").GetInt32()));
        // The same id again is the same task, not a second one: a retry is safe.
        Assert.Equal("Mow the lawn", Text((await Answer(client, McpTools.AddTask, new { title = "Other", listId = "GL", id = FirstId })).GetProperty("task"), "title"));
        Assert.Equal(1, (await Answer(client, McpTools.FindTasks, new { listId = "GL" })).GetProperty("items").GetArrayLength());
        Assert.Contains("yard", (await Answer(client, McpTools.ListTags)).GetRawText());

        // Only the fields given change; clear empties one; notes are set_task_notes' alone.
        var changed = (await Answer(client, McpTools.UpdateTask, new { id = FirstId, title = "Mow the front lawn", clear = new[] { "due" } })).GetProperty("task");
        Assert.Equal(("Mow the front lawn", true, 3), (Text(changed, "title"), Empty(changed, "due"), changed.GetProperty("priority").GetInt32()));
        Assert.Contains("Nothing to change", await Refused(client, McpTools.UpdateTask, new { id = FirstId }));
        Assert.Contains("both given and cleared", await Refused(client, McpTools.UpdateTask, new { id = FirstId, due = "2026-12-01", clear = new[] { "due" } }));
        // A field's own problem comes through, as the task API says it (QA, piece 2).
        Assert.Contains("progress: must be 0 to 100 in steps of 10", await Refused(client, McpTools.UpdateTask, new { id = FirstId, progress = 25 }));
        Assert.Equal("Edge the path too", Text((await Answer(client, McpTools.SetTaskNotes, new { id = FirstId, notes = "Edge the path too" })).GetProperty("task"), "notes"));

        // A subtask shows under its task.
        await Answer(client, McpTools.AddTask, new { title = "Empty the catcher", parentId = FirstId });
        var detail = await Answer(client, McpTools.GetTask, new { id = FirstId });
        Assert.Equal("Empty the catcher", Text(Assert.Single(detail.GetProperty("subtasks").EnumerateArray()).GetProperty("task"), "title"));

        // Closing closes its subtasks too; closing again leaves it closed; reopening opens it.
        var closed = await Answer(client, McpTools.CompleteTask, new { id = FirstId });
        Assert.Equal(("done", true), (Text(closed.GetProperty("task").GetProperty("task"), "status"), Empty(closed, "next")));
        Assert.Equal("done", Text((await Answer(client, McpTools.FindTasks, new { parentId = FirstId, status = "all" })).GetProperty("items")[0].GetProperty("task"), "status"));
        Assert.Equal("done", Text((await Answer(client, McpTools.CompleteTask, new { id = FirstId })).GetProperty("task").GetProperty("task"), "status"));
        Assert.Equal("open", Text((await Answer(client, McpTools.ReopenTask, new { id = FirstId })).GetProperty("task"), "status"));

        // Quick add reads the line as the app does.
        var quick = (await Answer(client, McpTools.QuickAdd, new { text = "Buy seeds !high", listId = "GL" })).GetProperty("task");
        Assert.Equal(("Buy seeds", 3, "GL"), (Text(quick, "title"), quick.GetProperty("priority").GetInt32(), Text(quick, "listId")));

        // The API's own refusals come back as tool errors with its stable codes.
        Assert.Contains("(not_found)", await Refused(client, McpTools.UpdateTask, new { id = "nope", title = "x" }));
        Assert.Contains("priority must be", await Refused(client, McpTools.AddTask, new { title = "x", priority = "urgent" }));
    }

    [Fact]
    public async Task A_repeating_task_closes_only_the_occurrence_asked_for_so_a_retry_skips_none()
    {
        using var world = StartWithMcp(fixture);
        var ben = await world.PersonAsync("ben");
        await PushAsync(ben, List("GL", "Garden"), TaskApiWorld.Task("R1", "GL", "Water the plants", due: "2026-11-23", recurrence: "FREQ=DAILY"));
        await using var client = await ConnectAs(world, ben);

        // Guessing "the current one" is what makes a retry skip one: the occurrence is asked for.
        Assert.Contains("pass occurrence", await Refused(client, McpTools.CompleteTask, new { id = "R1" }));

        var closed = await Answer(client, McpTools.CompleteTask, new { id = "R1", occurrence = "2026-11-23" });
        Assert.Equal("done", Text(closed.GetProperty("task").GetProperty("task"), "status"));
        var next = Text(closed.GetProperty("next").GetProperty("task").GetProperty("due"), "at");
        Assert.NotNull(next);
        Assert.NotEqual("2026-11-23", next);

        // The same call again (a retry after a lost answer) closes nothing and says why.
        var again = await Answer(client, McpTools.CompleteTask, new { id = "R1", occurrence = "2026-11-23" });
        Assert.Contains("Not closed", Text(again, "note"));
        Assert.Equal(("open", next), (Text(again.GetProperty("task").GetProperty("task"), "status"), Text(again.GetProperty("task").GetProperty("task").GetProperty("due"), "at")));
        Assert.Equal(next, Text((await Answer(client, McpTools.GetTask, new { id = "R1" })).GetProperty("task").GetProperty("due"), "at"));
    }

    [Fact]
    public async Task Two_completes_at_once_for_one_occurrence_close_it_once()
    {
        using var world = StartWithMcp(fixture);
        var ben = await world.PersonAsync("ben");
        await PushAsync(ben, List("GL", "Garden"), TaskApiWorld.Task("R1", "GL", "Water the plants", due: "2026-11-23", recurrence: "FREQ=DAILY"));
        await using var first = await ConnectAs(world, ben);
        await using var second = await ConnectAs(world, ben);

        // A retry sent before the first answer came (Dev 1, piece 2): one closes, one finds it moved on.
        var both = await System.Threading.Tasks.Task.WhenAll(
            Answer(first, McpTools.CompleteTask, new { id = "R1", occurrence = "2026-11-23" }),
            Answer(second, McpTools.CompleteTask, new { id = "R1", occurrence = "2026-11-23" }));
        Assert.Single(both, answer => Text(answer, "note") is null);
        Assert.Single(both, answer => Text(answer, "note") is not null);
        var next = Text(both.Single(answer => Text(answer, "note") is null).GetProperty("next").GetProperty("task").GetProperty("due"), "at");
        Assert.Equal(next, Text((await Answer(first, McpTools.GetTask, new { id = "R1" })).GetProperty("task").GetProperty("due"), "at"));
        Assert.Single((await Answer(first, McpTools.FindTasks, new { listId = "GL", status = "done" })).GetProperty("items").EnumerateArray());
    }

    [Fact]
    public async Task A_batch_of_writes_is_refused_whole()
    {
        using var world = StartWithMcp(fixture);
        var ben = await world.PersonAsync("ben");
        await PushAsync(ben, List("GL", "Garden"));
        var keyed = await world.KeyAsync(ben, ApiScopes.TasksRead, ApiScopes.TasksWrite);

        // JSON-RPC batches belong to the older revisions (2025-03-26). SDK 2.4.0 answers one 400 and
        // runs none of it. An SDK that takes them fails this on purpose (Dev 1, piece 2): then check
        // that each write in a batch is audited on its own, as WriteAsync records one entry per call.
        var request = new HttpRequestMessage(HttpMethod.Post, "/mcp")
        {
            Content = new StringContent(
                """
                [{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"add_task","arguments":{"title":"One","listId":"GL"}}},
                 {"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"add_task","arguments":{"title":"Two","listId":"GL"}}}]
                """,
                System.Text.Encoding.UTF8, "application/json"),
        };
        request.Headers.Accept.ParseAdd("application/json");
        request.Headers.Accept.ParseAdd("text/event-stream");
        request.Headers.Add("MCP-Protocol-Version", "2025-03-26");
        var answer = await keyed.SendAsync(request, Token);
        TestContext.Current.SendDiagnosticMessage($"batch: {(int)answer.StatusCode} {await answer.Content.ReadAsStringAsync(Token)}");

        Assert.Equal(HttpStatusCode.BadRequest, answer.StatusCode);
        Assert.Empty((await keyed.GetFromJsonAsync<JsonObject>("/api/v1/tasks?listId=GL", Token))!["items"]!.AsArray());
        await world.Server.Services.GetRequiredService<AuditLog>().FlushAsync(Token);
        Assert.Empty((await world.Server.Services.GetRequiredService<IAuditStore>()
            .QueryAsync(new AuditQuery { Type = McpConnector.WriteEvent, Ascending = true }, Token)).Entries);
    }

    [Fact]
    public async Task Sharing_holds_a_viewer_may_not_write_and_another_persons_task_is_not_there()
    {
        using var world = StartWithMcp(fixture);
        var ben = await world.PersonAsync("ben");
        var sam = await world.PersonAsync("sam");
        var lee = await world.PersonAsync("lee");
        var max = await world.PersonAsync("max");
        await world.BefriendAsync(ben, sam);
        await world.BefriendAsync(ben, lee);
        await PushAsync(ben, List("SH", "Chores", visibility: "shared"), Member("M1", "SH", sam.Id, "editor"), Member("M2", "SH", lee.Id, "viewer"));
        await using var bens = await ConnectAs(world, ben);
        var dishes = Text((await Answer(bens, McpTools.AddTask, new { title = "Dishes", listId = "SH" })).GetProperty("task"), "id")!;

        // Another person's task says so (Security: a client can tell their words from the user's).
        await using var sams = await ConnectAs(world, sam);
        var seen = (await Answer(sams, McpTools.FindTasks, new { listId = "SH" })).GetProperty("items")[0];
        Assert.False(seen.GetProperty("byYou").GetBoolean());
        Assert.Equal(ben.Id, Text(seen.GetProperty("task"), "createdBy"));
        Assert.Equal("Wash up", Text((await Answer(sams, McpTools.UpdateTask, new { id = dishes, title = "Wash up" })).GetProperty("task"), "title"));

        // A viewer reads but may not change.
        await using var lees = await ConnectAs(world, lee);
        Assert.Equal("Wash up", Text((await Answer(lees, McpTools.GetTask, new { id = dishes })).GetProperty("task"), "title"));
        Assert.Contains("(forbidden)", await Refused(lees, McpTools.UpdateTask, new { id = dishes, title = "x" }));
        Assert.Contains("(forbidden)", await Refused(lees, McpTools.CompleteTask, new { id = dishes }));
        Assert.Contains("(forbidden)", await Refused(lees, McpTools.AddTask, new { title = "x", listId = "SH" }));

        // Someone the list isn't shared with sees nothing there, the same as no task at all.
        await using var maxs = await ConnectAs(world, max);
        Assert.Equal($"There is no task {dishes} that the user can see.", await Refused(maxs, McpTools.GetTask, new { id = dishes }));
        Assert.Contains("(not_found)", await Refused(maxs, McpTools.SetTaskNotes, new { id = dishes, notes = "x" }));
        // Ben made it, but Sam retitled it: it still reads as Ben's, so it says its list is shared, and
        // that its text may not be his (Security, piece 2).
        var retitled = await Answer(bens, McpTools.GetTask, new { id = dishes });
        Assert.Equal(("Wash up", true, true), (Text(retitled.GetProperty("task"), "title"), retitled.GetProperty("byYou").GetBoolean(), retitled.GetProperty("shared").GetBoolean()));
        Assert.True(seen.GetProperty("shared").GetBoolean());
    }

    [Fact]
    public async Task A_task_in_a_list_the_user_cannot_see_counts_as_shared()
    {
        using var world = StartWithMcp(fixture);
        var ben = await world.PersonAsync("ben");
        var sam = await world.PersonAsync("sam");
        await world.BefriendAsync(ben, sam);
        var (collection, task) = TaskApiWorld.Task("T1", "SL", "Fix the gate");
        task["assignees"] = Set($"user:{ben.Id}");
        await PushAsync(sam, List("SL", "Sam's jobs", visibility: "shared"), Member("MB", "SL", ben.Id, "editor"), (collection, task));
        // Taken off the list, Ben still sees the task assigned to him, but not its list: text Sam's
        // members can still rewrite, so it isn't his private list (Security, piece 2).
        await PushAsync(sam, ("listMembers", Entity("MB", new JsonObject
        {
            ["listId"] = "SL", ["principal"] = $"user:{ben.Id}", ["role"] = "editor", ["deletedAt"] = "2026-10-21T11:00:00.000Z",
        })));
        await using var bens = await ConnectAs(world, ben);
        Assert.DoesNotContain("Sam's jobs", (await Answer(bens, McpTools.ListLists)).GetRawText());
        var seen = await Answer(bens, McpTools.GetTask, new { id = "T1" });
        Assert.Equal(("Fix the gate", false, true), (Text(seen.GetProperty("task"), "title"), seen.GetProperty("byYou").GetBoolean(), seen.GetProperty("shared").GetBoolean()));
    }

    [Fact]
    public async Task A_read_only_key_reads_but_writes_nothing()
    {
        using var world = StartWithMcp(fixture);
        var ben = await world.PersonAsync("ben");
        await PushAsync(ben, List("GL", "Garden"));
        await using var reader = await ConnectAs(world, ben, ApiScopes.TasksRead);
        Assert.Contains("Garden", (await Answer(reader, McpTools.ListLists)).GetRawText());
        foreach (var tool in McpConnector.ToolScopes.Where(each => each.Value == ApiScopes.TasksWrite).Select(each => each.Key))
        {
            Assert.Equal($"This API key lacks the tasks:write permission that {tool} needs.", await Refused(reader, tool, new { id = "x", title = "x", text = "x", notes = "x", until = "x" }));
        }
        Assert.Equal(0, (await Answer(reader, McpTools.FindTasks, new { status = "all" })).GetProperty("items").GetArrayLength());

        // Answered 200 with a tool error, which the access log can't tell from a success, so the first
        // refusal is noted as denied, naming the key; the rest that minute add nothing (Security, piece 2).
        await world.Server.Services.GetRequiredService<AuditLog>().FlushAsync(Token);
        var denied = Assert.Single((await world.Server.Services.GetRequiredService<IAuditStore>()
            .QueryAsync(new AuditQuery { Type = McpConnector.WriteEvent, Ascending = true }, Token)).Entries);
        Assert.Equal((AuditOutcome.Denied, $"{McpTools.QuickAdd} x", "Test key", ben.Id), (denied.Outcome, denied.Detail, denied.TargetName, denied.ActorId));
    }

    [Fact]
    public async Task Writes_take_from_the_task_apis_write_limit_and_are_audited_with_the_key()
    {
        using var world = StartWithMcp(fixture);
        var ben = await world.PersonAsync("ben");
        await PushAsync(ben, List("GL", "Garden"));
        var keyed = await world.KeyAsync(ben, ApiScopes.TasksRead, ApiScopes.TasksWrite);
        var keyId = (string?)(await keyed.GetFromJsonAsync<JsonObject>("/api/v1/me", Token))!["key"]!["id"];
        await using var client = await Connect(keyed);

        // One write by MCP, the rest of the minute's by the API in a session, then one more by MCP:
        // that is the whole limit, so the API's next write is refused, and MCP's next one too.
        var made = Text((await Answer(client, McpTools.AddTask, new { title = "Mow the lawn", listId = "GL" })).GetProperty("task"), "id")!;
        for (var i = 0; i < TaskApiEndpoints.WritesPerMinute - 2; i++)
        {
            var write = await ben.Session.PatchAsJsonAsync($"/api/v1/tasks/{made}", new { title = $"Mow {i}" }, Token);
            Assert.Equal(HttpStatusCode.OK, write.StatusCode);
        }
        await Answer(client, McpTools.UpdateTask, new { id = made, title = "Mow the front lawn" });
        Assert.Equal(HttpStatusCode.TooManyRequests, (await ben.Session.PatchAsJsonAsync($"/api/v1/tasks/{made}", new { title = "x" }, Token)).StatusCode);
        Assert.Contains("Too many changes this minute", await Refused(client, McpTools.UpdateTask, new { id = made, title = "x" }));
        // A client trying again and again leaves one line a minute, not one each (Security, piece 2).
        Assert.Contains("Too many changes this minute", await Refused(client, McpTools.UpdateTask, new { id = made, title = "y" }));
        // Reads have a budget of their own.
        Assert.Equal("Mow the front lawn", Text((await Answer(client, McpTools.GetTask, new { id = made })).GetProperty("task"), "title"));

        // Each write names the key it came by, the tool and the task (Dev 1 and Security, piece 1).
        await world.Server.Services.GetRequiredService<AuditLog>().FlushAsync(Token);
        var events = (await world.Server.Services.GetRequiredService<IAuditStore>()
            .QueryAsync(new AuditQuery { Type = McpConnector.WriteEvent, Ascending = true }, Token)).Entries;
        Assert.Equal(
            [
                (AuditOutcome.Ok, $"add_task {made}"),
                (AuditOutcome.Ok, $"update_task {made}"),
                (AuditOutcome.Throttled, $"update_task {made}"),
            ],
            events.Select(entry => (entry.Outcome, entry.Detail)));
        Assert.All(events, entry => Assert.Equal((ben.Id, keyId, "Test key"), (entry.ActorId, entry.TargetId, entry.TargetName)));
        // Reads are not audited as changes.
        Assert.DoesNotContain(events, entry => entry.Detail!.StartsWith(McpTools.GetTask, StringComparison.Ordinal));
    }

    [Fact]
    public async Task A_refused_write_is_audited_as_refused_and_snooze_takes_a_time_not_a_length()
    {
        using var world = StartWithMcp(fixture);
        var ben = await world.PersonAsync("ben");
        await PushAsync(ben, List("GL", "Garden"), TaskApiWorld.Task("T1", "GL", "Call the vet"));
        await using var client = await ConnectAs(world, ben);

        Assert.Contains("ISO 8601", await Refused(client, McpTools.SnoozeTask, new { id = "T1", until = "in an hour" }));
        // Without its offset it would be read in the server's zone (UTC in the image): refused.
        Assert.Contains("ISO 8601", await Refused(client, McpTools.SnoozeTask, new { id = "T1", until = DateTime.UtcNow.AddHours(1).ToString("yyyy-MM-ddTHH:mm:ss") }));
        Assert.Contains("in the future", await Refused(client, McpTools.SnoozeTask, new { id = "T1", until = DateTimeOffset.UtcNow.AddMinutes(-5).ToString("O") }));
        Assert.Contains("at most a week", await Refused(client, McpTools.SnoozeTask, new { id = "T1", until = DateTimeOffset.UtcNow.AddDays(8).ToString("O") }));
        // A task with no reminder: the API's own refusal.
        await Refused(client, McpTools.SnoozeTask, new { id = "T1", until = DateTimeOffset.UtcNow.AddHours(1).ToString("O") });

        await world.Server.Services.GetRequiredService<AuditLog>().FlushAsync(Token);
        var events = (await world.Server.Services.GetRequiredService<IAuditStore>()
            .QueryAsync(new AuditQuery { Type = McpConnector.WriteEvent, Ascending = true }, Token)).Entries;
        Assert.Equal(5, events.Count);
        Assert.All(events, entry => Assert.Equal((AuditOutcome.Refused, "snooze_task T1"), (entry.Outcome, entry.Detail)));
    }
}
