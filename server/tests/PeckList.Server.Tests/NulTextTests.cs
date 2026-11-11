using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using PeckList.Core;
using PeckList.Core.Accounts;
using PeckList.Core.Sync;

namespace PeckList.Server.Tests;

/// <summary>
/// Text holding a NUL character, which PostgreSQL cannot store, on both databases. The PostgreSQL
/// cases run where <c>PECKLIST_TEST_POSTGRES</c> names a server (CI does).
/// </summary>
public sealed class NulTextTests(ServerFixture fixture) : IClassFixture<ServerFixture>
{
    private const string Password = "correct horse battery";
    private const string Sqlite = "sqlite";
    private const string Postgres = "postgres";
    private const string Clock = "2026-10-21T10:00:00.000Z-0000-dev1";

    private static CancellationToken Token => TestContext.Current.CancellationToken;

    public static TheoryData<string> Databases => [Sqlite, Postgres];

    private async Task<WebApplicationFactory<Program>> Start(string kind)
    {
        if (kind == Sqlite) return fixture.Factory(("ADMIN_PASSWORD", Password), ("DB_PATH", fixture.NewDbPath()));
        var given = Environment.GetEnvironmentVariable("PECKLIST_TEST_POSTGRES");
        Assert.SkipWhen(string.IsNullOrEmpty(given), "needs PECKLIST_TEST_POSTGRES");
        var name = $"test_{Guid.NewGuid():N}";
        await using (var admin = new Npgsql.NpgsqlConnection(given))
        {
            await admin.OpenAsync(Token);
            await using var create = new Npgsql.NpgsqlCommand($"CREATE DATABASE {name}", admin);
            await create.ExecuteNonQueryAsync(Token);
        }
        return fixture.Factory(
            ("ADMIN_PASSWORD", Password),
            ("DB_PROVIDER", "postgres"),
            ("DB_CONNECTION_STRING", new Npgsql.NpgsqlConnectionStringBuilder(given) { Database = name }.ToString()));
    }

    private static async Task<HttpClient> SignedIn(WebApplicationFactory<Program> server)
    {
        var client = server.CreateClient();
        (await client.PostAsJsonAsync("/auth/login", new { username = "admin", password = Password }, Token)).EnsureSuccessStatusCode();
        return client;
    }

    private static async Task<SyncResponse> Sync(HttpClient client, params JsonObject[] tasks)
    {
        var response = await client.PostAsJsonAsync("/api/sync", new
        {
            schemaVersion = WorkspaceSchema.CurrentVersion,
            cursor = (long?)null,
            changes = tasks.Select(task => new { collection = "tasks", entity = task }),
        }, Token);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<SyncResponse>(Token))!;
    }

    private static JsonObject Find(SyncResponse response, string id) =>
        response.Changes.Single(change => (string?)change.Entity["id"] == id).Entity;

    [Theory]
    [MemberData(nameof(Databases))]
    public async Task Text_with_a_NUL_syncs_without_it_and_every_device_ends_with_the_same_text(string kind)
    {
        using var server = await Start(kind);
        var phone = await SignedIn(server);
        var laptop = await SignedIn(server);
        var onPhone = new JsonObject
        {
            ["id"] = "T1",
            ["title"] = "Milk\0 and eggs",
            ["notes"] = "a\0b",
            ["deletedAt"] = null,
            ["_hlc"] = new JsonObject { ["title"] = Clock, ["notes"] = Clock, ["deletedAt"] = Clock },
        };
        var other = new JsonObject
        {
            ["id"] = "T2", ["title"] = "Bread", ["deletedAt"] = null,
            ["_hlc"] = new JsonObject { ["title"] = Clock, ["deletedAt"] = Clock },
        };

        var pushed = await Sync(phone, (JsonObject)onPhone.DeepClone(), other);
        Assert.Empty(pushed.Invalid ?? []);
        Assert.Equal("Bread", (string?)Find(pushed, "T2")["title"]);
        var fromServer = Find(pushed, "T1");
        Assert.Equal("Milk and eggs", (string?)fromServer["title"]);
        Assert.Equal("ab", (string?)fromServer["notes"]);

        // The phone merges what came back into its own copy as the app does; the laptop starts fresh.
        var phoneAfter = Merge.Entity(onPhone, fromServer, WorkspaceSchema.ElementSetFields("tasks"));
        var onLaptop = Find(await Sync(laptop), "T1");
        Assert.True(JsonNode.DeepEquals(phoneAfter, onLaptop), $"{phoneAfter.ToJsonString()} != {onLaptop.ToJsonString()}");
        Assert.Equal("Milk and eggs", (string?)phoneAfter["title"]);
    }

    public static TheoryData<string, bool> DatabasesAndOrders => new() { { Sqlite, true }, { Sqlite, false }, { Postgres, true }, { Postgres, false } };

    [Theory]
    [MemberData(nameof(DatabasesAndOrders))]
    public async Task A_later_edit_from_another_device_still_wins_over_text_stripped_of_a_NUL(string kind, bool laterArrivesFirst)
    {
        using var server = await Start(kind);
        var phone = await SignedIn(server);
        var laptop = await SignedIn(server);
        static JsonObject Titled(string title, string stamp) => new()
        {
            ["id"] = "T1", ["title"] = title, ["deletedAt"] = null,
            ["_hlc"] = new JsonObject { ["title"] = stamp, ["deletedAt"] = "2026-10-21T09:00:00.000Z-0000-dev1" },
        };
        // The phone renamed it offline at 10:00, with a NUL; the laptop at 10:30. Both reach the server later.
        var fromPhone = Titled("Phone\0 title", "2026-10-21T10:00:00.000Z-0000-dev1");
        var fromLaptop = Titled("Laptop title", "2026-10-21T10:30:00.000Z-0000-dev2");
        if (laterArrivesFirst) await Sync(laptop, fromLaptop);
        await Sync(phone, fromPhone);
        if (!laterArrivesFirst) await Sync(laptop, fromLaptop);

        Assert.Equal("Laptop title", (string?)Find(await Sync(laptop), "T1")["title"]);
        Assert.Equal("Laptop title", (string?)Find(await Sync(phone), "T1")["title"]);
    }

    [Theory]
    [MemberData(nameof(Databases))]
    public async Task A_NUL_inside_a_set_refuses_only_that_change(string kind)
    {
        using var server = await Start(kind);
        var phone = await SignedIn(server);
        var task = new JsonObject
        {
            ["id"] = "T1", ["title"] = "Tagged", ["deletedAt"] = null,
            ["tags"] = new JsonObject { ["G1"] = new JsonObject { ["in"] = true, ["hlc"] = Clock, ["note"] = "a\0b" } },
            ["_hlc"] = new JsonObject { ["title"] = Clock, ["deletedAt"] = Clock },
        };
        var other = new JsonObject
        {
            ["id"] = "T2", ["title"] = "Bread", ["deletedAt"] = null,
            ["_hlc"] = new JsonObject { ["title"] = Clock, ["deletedAt"] = Clock },
        };
        var pushed = await Sync(phone, task, other);
        var refused = Assert.Single(pushed.Invalid ?? []);
        Assert.Equal(("T1", "invalid_text"), (refused.Id, refused.Code));
        Assert.Equal("Bread", (string?)Find(pushed, "T2")["title"]);
    }

    [Theory]
    [MemberData(nameof(Databases))]
    public async Task A_lookup_and_a_passkey_name_with_a_NUL_are_answered_without_it(string kind)
    {
        using var server = await Start(kind);
        var client = await SignedIn(server);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/users/lookup?q=nob%00ody", Token)).StatusCode);

        var adminId = (await server.Services.GetRequiredService<IAccountStore>().FindByUsernameAsync("admin", Token))!.Id;
        await server.Services.GetRequiredService<IPasskeyStore>().AddAsync(new Passkey
        {
            Id = "pk1", AccountId = adminId, Name = "Phone", PublicKey = "AAAA", CreatedAt = DateTimeOffset.UtcNow,
        }, Token);
        var renamed = await client.PutAsJsonAsync("/api/account/passkeys/pk1", new { name = "Lap\0top" }, Token);
        Assert.Equal(HttpStatusCode.OK, renamed.StatusCode);
        Assert.Equal("Laptop", (await server.Services.GetRequiredService<IPasskeyStore>().FindAsync("pk1", Token))!.Name);
    }
}
