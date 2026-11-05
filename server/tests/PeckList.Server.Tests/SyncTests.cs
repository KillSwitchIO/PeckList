using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using PeckList.Core;
using PeckList.Core.Accounts;
using PeckList.Core.Sync;

namespace PeckList.Server.Tests;

public sealed class SyncTests(ServerFixture fixture) : IClassFixture<ServerFixture>, IDisposable
{
    private const string Password = "correct horse battery";
    private readonly WebApplicationFactory<Program> factory = fixture.Factory(("ADMIN_PASSWORD", Password), ("DB_PATH", fixture.NewDbPath()));

    private static CancellationToken Token => TestContext.Current.CancellationToken;

    public void Dispose() => factory.Dispose();

    private async Task<HttpClient> SignedIn(string username = "admin", string password = Password)
    {
        var client = factory.CreateClient();
        var login = await client.PostAsJsonAsync("/auth/login", new { username, password }, Token);
        login.EnsureSuccessStatusCode();
        return client;
    }

    private static JsonObject Task(string id, string title, string clock = "2026-10-21T10:00:00.000Z-0000-dev1", JsonObject? tags = null)
    {
        var task = new JsonObject
        {
            ["id"] = id,
            ["title"] = title,
            ["deletedAt"] = null,
            ["_hlc"] = new JsonObject { ["title"] = clock, ["deletedAt"] = clock },
        };
        if (tags is not null) task["tags"] = tags;
        return task;
    }

    private static async Task<SyncResponse> Sync(HttpClient client, long? cursor, params JsonObject[] tasks)
    {
        var response = await client.PostAsJsonAsync("/api/sync", new
        {
            schemaVersion = WorkspaceSchema.CurrentVersion,
            cursor,
            changes = tasks.Select(task => new { collection = "tasks", entity = task }),
        }, Token);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<SyncResponse>(Token))!;
    }

    private static string? Title(SyncResponse response, string id) =>
        (string?)response.Changes.Single(change => (string?)change.Entity["id"] == id).Entity["title"];

    [Fact]
    public async Task Needs_a_login()
    {
        var response = await factory.CreateClient().PostAsJsonAsync("/api/sync", new { schemaVersion = WorkspaceSchema.CurrentVersion }, Token);
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Waits_for_a_required_password_change()
    {
        var accounts = factory.Services.GetRequiredService<AccountService>();
        await accounts.CreateUserAsync("sam", "sams first password", cancellation: Token);
        var client = await SignedIn("sam", "sams first password");
        var response = await client.PostAsJsonAsync("/api/sync", new { schemaVersion = WorkspaceSchema.CurrentVersion }, Token);
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.Contains("password_change_required", await response.Content.ReadAsStringAsync(Token));
    }

    [Fact]
    public async Task Two_devices_converge()
    {
        var laptop = await SignedIn();
        var phone = await SignedIn();

        // The laptop makes a task; the phone pulls it.
        var first = await Sync(laptop, null, Task("T1", "Mow", tags: new JsonObject
        {
            ["G1"] = new JsonObject { ["in"] = true, ["hlc"] = "2026-10-21T10:00:00.000Z-0000-dev1" },
        }));
        var pulled = await Sync(phone, null);
        Assert.Equal("Mow", Title(pulled, "T1"));

        // Both edit offline: the laptop renames later, the phone adds a tag. Both survive.
        await Sync(laptop, first.Cursor, Task("T1", "Mow the lawn", "2026-10-21T10:05:00.000Z-0000-dev1"));
        var phoneEdit = Task("T1", "Mow", tags: new JsonObject
        {
            ["G2"] = new JsonObject { ["in"] = true, ["hlc"] = "2026-10-21T10:03:00.000Z-0000-dev2" },
        });
        var phoneResult = await Sync(phone, pulled.Cursor, phoneEdit);
        var laptopResult = await Sync(laptop, first.Cursor);

        var onPhone = phoneResult.Changes.Single().Entity;
        var onLaptop = laptopResult.Changes.Single().Entity;
        Assert.Equal("Mow the lawn", (string?)onPhone["title"]);
        Assert.True(JsonNode.DeepEquals(onPhone, onLaptop));
        Assert.Equal(["G1", "G2"], onPhone["tags"]!.AsObject().Select(pair => pair.Key).Order());
    }

    [Fact]
    public async Task Pushing_what_the_server_has_adds_nothing_to_the_feed()
    {
        var client = await SignedIn();
        var first = await Sync(client, null, Task("T1", "Mow"));
        var again = await Sync(client, first.Cursor, Task("T1", "Mow"));
        Assert.Empty(again.Changes);
        Assert.Equal(first.Cursor, again.Cursor);
    }

    [Fact]
    public async Task Users_see_and_change_only_their_own_entities()
    {
        var accounts = factory.Services.GetRequiredService<AccountService>();
        await accounts.CreateUserAsync("sam", "sams own password", mustChangePassword: false, cancellation: Token);
        var admin = await SignedIn();
        var sam = await SignedIn("sam", "sams own password");

        await Sync(admin, null, Task("T1", "Admin's task"));
        var samView = await Sync(sam, null, Task("T1", "Taken over", "2026-10-21T11:00:00.000Z-0000-dev9"), Task("T2", "Sam's task"));
        Assert.Equal(["T2"], samView.Changes.Where(change => change.Collection == "tasks").Select(change => (string?)change.Entity["id"]));

        var adminView = await Sync(admin, null);
        Assert.Equal("Admin's task", Title(adminView, "T1"));
        Assert.DoesNotContain(adminView.Changes, change => (string?)change.Entity["id"] == "T2");
    }

    [Fact]
    public async Task Pages_a_long_feed()
    {
        var client = await SignedIn();
        var tasks = Enumerable.Range(0, SyncService.PageSize + 20).Select(index => Task($"T{index:D4}", $"Task {index}")).ToArray();
        var first = await Sync(client, null, tasks);
        Assert.True(first.More);
        Assert.Equal(SyncService.PageSize, first.Changes.Count);
        var second = await Sync(client, first.Cursor);
        Assert.False(second.More);
        // The account's profile (written on its first sync) is in the feed too.
        Assert.Equal(21, second.Changes.Count);
    }

    [Fact]
    public async Task A_stopping_server_ends_event_streams_at_once()
    {
        using var server = fixture.Factory(("ADMIN_PASSWORD", Password));
        var client = server.CreateClient();
        (await client.PostAsJsonAsync("/auth/login", new { username = "admin", password = Password }, Token)).EnsureSuccessStatusCode();
        using var events = await client.GetAsync("/api/events", HttpCompletionOption.ResponseHeadersRead, Token);
        using var reader = new StreamReader(await events.Content.ReadAsStreamAsync(Token));
        Assert.Equal(": connected", await reader.ReadLineAsync(Token));

        // A restart to apply settings or restore a backup must not wait out the shutdown timeout.
        server.Services.GetRequiredService<Microsoft.Extensions.Hosting.IHostApplicationLifetime>().StopApplication();
        using var patience = CancellationTokenSource.CreateLinkedTokenSource(Token);
        patience.CancelAfter(TimeSpan.FromSeconds(5));
        string? line;
        do line = await reader.ReadLineAsync(patience.Token); while (line is not null);
    }

    [Fact]
    public async Task Tells_the_other_devices_when_something_changes()
    {
        var laptop = await SignedIn();
        var phone = await SignedIn();
        using var events = await phone.GetAsync("/api/events", HttpCompletionOption.ResponseHeadersRead, Token);
        Assert.Equal("text/event-stream", events.Content.Headers.ContentType?.MediaType);
        using var reader = new StreamReader(await events.Content.ReadAsStreamAsync(Token));
        Assert.Equal(": connected", await reader.ReadLineAsync(Token));

        var request = new HttpRequestMessage(HttpMethod.Post, "/api/sync")
        {
            Content = JsonContent.Create(new
            {
                schemaVersion = WorkspaceSchema.CurrentVersion,
                cursor = (long?)null,
                changes = new[] { new { collection = "tasks", entity = Task("T1", "Mow") } },
            }),
        };
        request.Headers.Add(SyncEndpoints.DeviceHeader, "laptop1");
        (await laptop.SendAsync(request, Token)).EnsureSuccessStatusCode();

        // A missing event must fail the test, not hang the run.
        using var patience = CancellationTokenSource.CreateLinkedTokenSource(Token);
        patience.CancelAfter(TimeSpan.FromSeconds(10));
        string? line;
        do line = await reader.ReadLineAsync(patience.Token); while (line is "" or null || line.StartsWith(':'));
        Assert.Equal("event: changed", line);
        var data = JsonNode.Parse((await reader.ReadLineAsync(patience.Token))!["data: ".Length..])!;
        Assert.Equal("laptop1", (string?)data["source"]);
        Assert.True((long?)data["cursor"] > 0);
    }

    [Fact]
    public async Task Refuses_another_schema_version()
    {
        var client = await SignedIn();
        var response = await client.PostAsJsonAsync("/api/sync", new { schemaVersion = WorkspaceSchema.CurrentVersion - 1 }, Token);
        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        var error = await response.Content.ReadFromJsonAsync<SyncError>(Token);
        Assert.Equal("schema_mismatch", error!.Error);
        Assert.Equal(WorkspaceSchema.CurrentVersion, error.ServerSchemaVersion);
    }

    // Audit C1: one bad change used to fail the whole request, and the device sent the same batch
    // again every 30 s, so nothing it changed after that ever synced. C8: a date that matches the
    // pattern but is not a date was a 500.
    [Theory]
    [InlineData("""{"collection":"widgets","entity":{"id":"X1","_hlc":{}}}""", "X1", "invalid_change", "unknown collection")]
    [InlineData("""{"collection":"tasks","entity":{"title":"no id","_hlc":{}}}""", null, "invalid_change", "malformed id")]
    [InlineData("""{"collection":"tasks","entity":{"id":"X1"}}""", "X1", "invalid_change", "missing _hlc")]
    [InlineData("""{"collection":"tasks","entity":{"id":"X1","_hlc":{"title":"yesterday"}}}""", "X1", "invalid_change", "bad clock for title")]
    [InlineData("""{"collection":"tasks","entity":{"id":"X1","_hlc":{"title":"2026-13-45T10:00:00.000Z-0000-dev1"}}}""", "X1", "invalid_change", "bad clock for title")]
    [InlineData("""{"collection":"tasks","entity":{"id":"X1","_hlc":{},"tags":{"G1":{"in":true,"hlc":"soon"}}}}""", "X1", "invalid_change", "bad clock for tags.G1")]
    [InlineData("""{"collection":"tasks","entity":{"id":"X1","_hlc":{"title":"2999-01-01T00:00:00.000Z-0000-dev1"}}}""", "X1", "clock_drift", "more than an hour ahead")]
    // R-FB-94: half an emoji (imported text) used to be a 500 when the server wrote it out.
    [InlineData("""{"collection":"tasks","entity":{"id":"X1","title":"cut \udc8f","_hlc":{"title":"2026-10-20T10:00:00.000Z-0000-dev1"}}}""", "X1", "invalid_text", "not valid Unicode")]
    public async Task Sets_aside_a_bad_change_and_takes_the_rest_of_the_push(string change, string? id, string code, string message)
    {
        var client = await SignedIn();
        var good = Task("G1", "Still syncs").ToJsonString();
        var body = $$"""{"schemaVersion":{{WorkspaceSchema.CurrentVersion}},"changes":[{{change}},{"collection":"tasks","entity":{{good}}}]}""";
        var response = await client.PostAsync("/api/sync", new StringContent(body, System.Text.Encoding.UTF8, "application/json"), Token);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var result = (await response.Content.ReadFromJsonAsync<SyncResponse>(Token))!;
        var aside = Assert.Single(result.Invalid!);
        Assert.Equal((0, id, code), (aside.Index, aside.Id, aside.Code));
        Assert.Contains(message, aside.Reason);
        Assert.Equal("Still syncs", Title(result, "G1"));
        Assert.DoesNotContain(result.Changes, each => (string?)each.Entity["id"] == "X1");
    }

    [Fact]
    public async Task Sets_aside_an_entity_of_the_wrong_shape_or_size_and_keeps_a_whole_one()
    {
        // Audit S4, with the server's own validator (the fixture swaps in one that takes anything).
        using var server = fixture.Factory(("ADMIN_PASSWORD", Password), ("DB_PATH", fixture.NewDbPath()))
            .WithWebHostBuilder(host => host.ConfigureTestServices(services => services.AddSingleton(EntitySchema.Validator())));
        var client = server.CreateClient();
        (await client.PostAsJsonAsync("/auth/login", new { username = "admin", password = Password }, Token)).EnsureSuccessStatusCode();
        var me = (await client.GetFromJsonAsync<JsonObject>("/auth/me", Token))!["id"]!.GetValue<string>();
        var clock = "2026-10-21T10:00:00.000Z-0000-dev1";
        JsonObject Whole(string id, string title) => new()
        {
            ["id"] = id, ["createdAt"] = "2026-10-21T10:00:00.000Z", ["createdBy"] = me, ["deletedAt"] = null, ["origin"] = "local",
            ["title"] = title, ["notes"] = "", ["listId"] = "01DEV100000000000000000005", ["sectionId"] = null, ["parentId"] = null,
            ["order"] = "V", ["status"] = "open", ["completedAt"] = null, ["completedBy"] = null, ["priority"] = 0,
            ["schedule"] = null, ["due"] = null, ["tags"] = new JsonObject(), ["assignees"] = new JsonObject(),
            ["blockedBy"] = new JsonObject(), ["recurrence"] = null, ["progress"] = 0,
            ["_hlc"] = new JsonObject { ["title"] = clock },
        };
        var wrong = Whole("01DEV1000000000000000000B1", "Wrong");
        wrong["status"] = "maybe";
        var huge = Whole("01DEV1000000000000000000B2", "Huge");
        huge["notes"] = new string('x', PeckList.Core.Sync.WorkspaceEntityValidator.MaxEntityBytes);
        var body = new JsonObject
        {
            ["schemaVersion"] = WorkspaceSchema.CurrentVersion,
            ["changes"] = new JsonArray(
                new JsonObject { ["collection"] = "tasks", ["entity"] = wrong },
                new JsonObject { ["collection"] = "tasks", ["entity"] = huge },
                new JsonObject { ["collection"] = "tasks", ["entity"] = Whole("01DEV1000000000000000000B3", "Whole") }),
        };
        var response = await client.PostAsync("/api/sync", new StringContent(body.ToJsonString(), System.Text.Encoding.UTF8, "application/json"), Token);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var result = (await response.Content.ReadFromJsonAsync<SyncResponse>(Token))!;
        Assert.Equal([(0, "invalid_change"), (1, "invalid_change")], result.Invalid!.Select(each => (each.Index, each.Code)));
        Assert.Contains("/status must be one of the allowed values", result.Invalid![0].Reason);
        Assert.Contains("too large", result.Invalid![1].Reason);
        // The whole one passes the checks (index 2 is not set aside); the sharing rules then decide
        // where it may go, as for any task.
    }

    [Fact]
    public async Task Takes_a_change_stamped_a_little_ahead_and_says_what_time_the_server_has()
    {
        var client = await SignedIn();
        var ahead = DateTimeOffset.UtcNow.AddMinutes(30).UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", System.Globalization.CultureInfo.InvariantCulture);

        var result = await Sync(client, null, Task("A1", "Half an hour ahead", $"{ahead}-0000-dev1"));

        Assert.Empty(result.Invalid!);
        Assert.Equal("Half an hour ahead", Title(result, "A1"));
        var serverTime = DateTimeOffset.Parse(result.ServerTime!, System.Globalization.CultureInfo.InvariantCulture);
        Assert.InRange(serverTime, DateTimeOffset.UtcNow.AddMinutes(-1), DateTimeOffset.UtcNow.AddMinutes(1));
    }
}
