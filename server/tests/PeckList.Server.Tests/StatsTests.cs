using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using PeckList.Core;
using PeckList.Core.Accounts;
using PeckList.Core.Stats;
using PeckList.Server.Audit;

namespace PeckList.Server.Tests;

/// <summary>Server stats over HTTP (spec: Server stats): counts only, fresh after a sync, the same for the person themselves.</summary>
public sealed class StatsTests(ServerFixture fixture) : IClassFixture<ServerFixture>
{
    private const string AdminPassword = "correct horse battery";
    private const string Password = "a long enough password";
    private const string Clock = "2026-10-22T10:00:00.000Z-0000-dev1";

    private static CancellationToken Token => TestContext.Current.CancellationToken;

    private static async Task<HttpClient> LogIn(WebApplicationFactory<Program> server, string username, string password)
    {
        var client = server.CreateClient();
        (await client.PostAsJsonAsync("/auth/login", new { username, password }, Token)).EnsureSuccessStatusCode();
        return client;
    }

    private static JsonObject Task(string id, string status, string? completedAt) => new()
    {
        ["id"] = id, ["title"] = "Private title " + id, ["listId"] = "L1", ["parentId"] = null, ["status"] = status,
        ["completedAt"] = completedAt, ["createdBy"] = null, ["deletedAt"] = null,
        ["_hlc"] = new JsonObject { ["title"] = Clock, ["listId"] = Clock, ["status"] = Clock, ["completedAt"] = Clock, ["deletedAt"] = Clock },
    };

    private static async Task Push(HttpClient client, params (string Collection, JsonObject Entity)[] changes) =>
        (await client.PostAsJsonAsync("/api/sync", new
        {
            schemaVersion = WorkspaceSchema.CurrentVersion,
            cursor = (long?)null,
            changes = changes.Select(change => new { collection = change.Collection, entity = change.Entity }).ToArray(),
        }, Token)).EnsureSuccessStatusCode();

    [Fact]
    public async Task Admins_see_counts_per_person_that_follow_syncs_and_people_see_their_own()
    {
        using var server = fixture.Factory(("ADMIN_PASSWORD", AdminPassword));
        var admin = await LogIn(server, "admin", AdminPassword);
        var samId = (await server.Services.GetRequiredService<AccountService>()
            .CreateUserAsync("sam", Password, mustChangePassword: false, cancellation: Token)).Id;
        var sam = await LogIn(server, "sam", Password);
        var now = DateTimeOffset.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ", System.Globalization.CultureInfo.InvariantCulture);
        await Push(sam,
            ("lists", new JsonObject
            {
                ["id"] = "L1", ["name"] = "Chores", ["visibility"] = "shared", ["isInbox"] = false, ["deletedAt"] = null,
                ["_hlc"] = new JsonObject { ["name"] = Clock, ["visibility"] = Clock, ["isInbox"] = Clock, ["deletedAt"] = Clock },
            }),
            ("tasks", Task("T1", "open", null)), ("tasks", Task("T2", "done", now)));

        Assert.Equal(HttpStatusCode.Forbidden, (await sam.GetAsync("/api/admin/stats", Token)).StatusCode);
        var body = await admin.GetStringAsync("/api/admin/stats", Token);
        Assert.DoesNotContain("Private title", body);
        Assert.DoesNotContain("Chores", body);
        var stats = JsonNode.Parse(body)!;
        var row = stats["people"]!.AsArray().Single(person => (string?)person!["username"] == "sam")!;
        Assert.Equal((1, 1, 1, 1, 1), ((int)row["openTasks"]!, (int)row["closedTasks"]!, (int)row["closedThisMonth"]!, (int)row["lists"]!, (int)row["sharedLists"]!));
        Assert.True((long)row["storageBytes"]! > 0);
        Assert.Equal(12, row["closedByMonth"]!.AsArray().Count);

        // A sync changes the numbers right away.
        await Push(sam, ("tasks", Task("T1", "wontdo", now)));
        var after = await admin.GetFromJsonAsync<ServerStats>("/api/admin/stats", Token);
        Assert.Equal((0, 2), (after!.OpenTasks, after.ClosedTasks));

        await server.Services.GetRequiredService<AuditLog>().FlushAsync(Token);
        var mine = await sam.GetFromJsonAsync<UserStats>("/api/account/stats", Token);
        var theirs = after.People.Single(person => person.Id == samId);
        Assert.Equal(theirs with { ClosedByMonth = [] }, mine! with { ClosedByMonth = [] });
        Assert.Equal(theirs.ClosedByMonth, mine.ClosedByMonth);
    }
}
