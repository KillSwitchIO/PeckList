using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using PeckList.Core;
using PeckList.Core.Accounts;
using PeckList.Core.Sharing;
using PeckList.Server.Auth;

namespace PeckList.Server.Tests;

/// <summary>
/// A server for the task API tests (PL-137), on SQLite or on PostgreSQL where
/// <c>PECKLIST_TEST_POSTGRES</c> names a server (CI and the dev's full run do): people, their
/// sessions and keys, and workspace data pushed through sync as the apps push it.
/// </summary>
internal sealed class TaskApiWorld : IDisposable
{
    public const string Sqlite = "sqlite";
    public const string Postgres = "postgres";
    public const string AdminPassword = "correct horse battery";
    private const string Password = "a long enough password";

    public static TheoryData<string> Databases => [Sqlite, Postgres];

    private static CancellationToken Token => TestContext.Current.CancellationToken;

    public WebApplicationFactory<Program> Server { get; }

    private TaskApiWorld(WebApplicationFactory<Program> server) => Server = server;

    /// <summary>
    /// The same world with the real schema check, not the test host's accept-anything one. Its
    /// data must then be whole (ULID ids, every required field), so it is made through the API.
    /// </summary>
    public static async Task<TaskApiWorld> StartWithSchemaAsync(ServerFixture fixture, string kind)
    {
        var world = await StartAsync(fixture, kind);
        return new TaskApiWorld(world.Server.WithWebHostBuilder(host =>
            host.ConfigureTestServices(services => services.AddSingleton(EntitySchema.Validator()))));
    }

    public static async Task<TaskApiWorld> StartAsync(ServerFixture fixture, string kind)
    {
        if (kind == Sqlite) return new TaskApiWorld(fixture.Factory(("ADMIN_PASSWORD", AdminPassword), ("DB_PATH", fixture.NewDbPath())));
        var given = Environment.GetEnvironmentVariable("PECKLIST_TEST_POSTGRES");
        Assert.SkipWhen(string.IsNullOrEmpty(given), "needs PECKLIST_TEST_POSTGRES");
        var name = $"test_{Guid.NewGuid():N}";
        await using (var admin = new Npgsql.NpgsqlConnection(given))
        {
            await admin.OpenAsync(Token);
            await using var create = new Npgsql.NpgsqlCommand($"CREATE DATABASE {name}", admin);
            await create.ExecuteNonQueryAsync(Token);
        }
        return new TaskApiWorld(fixture.Factory(
            ("ADMIN_PASSWORD", AdminPassword),
            ("DB_PROVIDER", "postgres"),
            ("DB_CONNECTION_STRING", new Npgsql.NpgsqlConnectionStringBuilder(given) { Database = name }.ToString())));
    }

    public void Dispose() => Server.Dispose();

    /// <summary>One person: a signed-in session, and their id.</summary>
    public sealed record Person(string Id, string Username, HttpClient Session);

    public async Task<Person> PersonAsync(string username)
    {
        var account = await Server.Services.GetRequiredService<AccountService>()
            .CreateUserAsync(username, Password, mustChangePassword: false, cancellation: Token);
        var client = Server.CreateClient();
        (await client.PostAsJsonAsync("/auth/login", new { username, password = Password }, Token)).EnsureSuccessStatusCode();
        return new Person(account.Id, username, client);
    }

    public async Task BefriendAsync(Person a, Person b) =>
        Assert.NotNull(await Server.Services.GetRequiredService<Friends>().MakeFriendsAsync(a.Id, b.Id, cancellation: Token));

    /// <summary>A client signed in with a new key of the person's, with these scopes.</summary>
    public async Task<HttpClient> KeyAsync(Person person, params string[] scopes)
    {
        var made = await person.Session.PostAsJsonAsync("/api/account/api-keys", new { name = "Test key", scopes }, Token);
        made.EnsureSuccessStatusCode();
        var created = await made.Content.ReadFromJsonAsync<ApiKeyAuth.CreatedKey>(Token);
        var client = Server.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", created!.Token);
        return client;
    }

    private static int clock;

    /// <summary>Every field stamped with a fresh clock (later calls win).</summary>
    public static JsonObject Entity(string id, JsonObject fields)
    {
        var tick = Interlocked.Increment(ref clock);
        var stamp = $"2026-10-21T10:{tick / 60 % 60:D2}:{tick % 60:D2}.000Z-0000-dev1";
        fields["id"] = id;
        fields["createdAt"] ??= "2026-10-21T09:00:00.000Z";
        fields["deletedAt"] ??= null;
        var clocks = new JsonObject();
        foreach (var (field, _) in fields) if (field != "id") clocks[field] = stamp;
        fields["_hlc"] = clocks;
        return fields;
    }

    public static (string, JsonObject) List(string id, string name, string visibility = "private", bool inbox = false) =>
        ("lists", Entity(id, new JsonObject
        {
            ["name"] = name, ["color"] = "#3A7D44", ["icon"] = null, ["folderId"] = null, ["visibility"] = visibility,
            ["archived"] = false, ["order"] = "a1", ["isInbox"] = inbox,
        }));

    public static (string, JsonObject) Member(string id, string list, string user, string role) =>
        ("listMembers", Entity(id, new JsonObject { ["listId"] = list, ["principal"] = $"user:{user}", ["role"] = role }));

    public static (string, JsonObject) Section(string id, string list, string name) =>
        ("sections", Entity(id, new JsonObject { ["listId"] = list, ["name"] = name, ["order"] = "a1" }));

    public static (string, JsonObject) Tag(string id, string name) =>
        ("tags", Entity(id, new JsonObject { ["name"] = name, ["color"] = "#8A6D3B", ["order"] = "a1" }));

    public static JsonObject Set(params string[] members)
    {
        var set = new JsonObject();
        foreach (var member in members) set[member] = new JsonObject { ["in"] = true, ["hlc"] = "2026-10-21T09:30:00.000Z-0000-dev1" };
        return set;
    }

    public static (string, JsonObject) Task(
        string id, string list, string title, string status = "open", string? parent = null, string? section = null,
        string[]? tags = null, string? due = null, string? start = null, string? recurrence = null, int priority = 0)
        => ("tasks", Entity(id, new JsonObject
        {
            ["title"] = title, ["notes"] = "", ["listId"] = list, ["sectionId"] = section, ["parentId"] = parent, ["order"] = "a1",
            ["status"] = status, ["completedAt"] = null, ["completedBy"] = null, ["priority"] = priority,
            ["schedule"] = start is null ? null : new JsonObject { ["start"] = start, ["end"] = null, ["allDay"] = start.Length == 10, ["timeZone"] = "America/Chicago" },
            ["due"] = due is null ? null : new JsonObject { ["at"] = due, ["allDay"] = due.Length == 10, ["timeZone"] = "America/Chicago" },
            ["tags"] = Set(tags ?? []), ["assignees"] = new JsonObject(), ["blockedBy"] = new JsonObject(),
            ["recurrence"] = recurrence, ["progress"] = 0,
        }));

    /// <summary>Push changes through sync, as the apps do.</summary>
    public static async Task PushAsync(Person person, params (string Collection, JsonObject Entity)[] changes)
    {
        var response = await person.Session.PostAsJsonAsync("/api/sync", new
        {
            schemaVersion = WorkspaceSchema.CurrentVersion,
            cursor = (long?)null,
            changes = changes.Select(change => new { collection = change.Collection, entity = change.Entity }),
        }, Token);
        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadFromJsonAsync<JsonObject>(Token);
        Assert.Empty(body!["rejected"]!.AsArray());
        var invalid = body["invalid"]?.AsArray() ?? [];
        Assert.True(invalid.Count == 0, $"the schema refused: {invalid.ToJsonString()}");
    }
}
