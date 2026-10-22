using System.Text.Json.Nodes;
using Punchlist.Core.Audit;
using Punchlist.Core.Stats;
using Punchlist.Core.Storage;
using Punchlist.Storage.Sql;

namespace Punchlist.Storage.Tests;

/// <summary>What <see cref="IStatsSource"/> must read out of each database.</summary>
public abstract class StatsSourceContract : IAsyncLifetime
{
    private SqlDatabase database = null!;

    protected abstract Task<SqlDatabase> CreateAsync();

    public async ValueTask InitializeAsync() => database = await CreateAsync();

    public ValueTask DisposeAsync() => ValueTask.CompletedTask;

    private static CancellationToken Token => TestContext.Current.CancellationToken;

    private static IncomingEntity Task(string id, string createdBy, string status, string? completedAt = null, string? deletedAt = null) =>
        new("tasks", new JsonObject
        {
            ["id"] = id,
            ["title"] = "Secret title " + id,
            ["createdBy"] = createdBy,
            ["status"] = status,
            ["completedAt"] = completedAt,
            ["deletedAt"] = deletedAt,
            ["_hlc"] = new JsonObject(),
        });

    private static IncomingEntity List(string id, string visibility, bool inbox = false) =>
        new("lists", new JsonObject
        {
            ["id"] = id,
            ["name"] = "List " + id,
            ["visibility"] = visibility,
            ["isInbox"] = inbox,
            ["deletedAt"] = null,
            ["_hlc"] = new JsonObject(),
        });

    private static JsonObject Take(StoredEntity? _, IncomingEntity incoming) => (JsonObject)incoming.Doc.DeepClone();

    [Fact]
    public async Task Reads_task_and_list_facts_storage_and_a_version_that_moves_with_writes()
    {
        var store = new SqlEntityStore(database);
        var source = new SqlStatsSource(database);
        var before = await source.VersionAsync(Token);
        await store.WriteAsync("ben", [
            Task("T1", "ben", "open"),
            Task("T2", "ben", "done", "2026-10-03T08:00:00.000Z"),
            Task("T3", "sam", "wontdo", "2026-09-30T23:30:00.000Z"),
            Task("T4", "ben", "open", deletedAt: "2026-10-04T08:00:00.000Z"),
            List("L1", "private", inbox: true),
            List("L2", "shared"),
        ], Take, cancellation: Token);
        await store.WriteAsync("sam", [Task("T5", "sam", "open")], Take, cancellation: Token);
        Assert.NotEqual(before, await source.VersionAsync(Token));

        var tasks = (await source.TasksAsync(Token)).OrderBy(task => task.Status).ThenBy(task => task.CompletedAt).ToList();
        Assert.Equal([
            new TaskFacts("ben", "ben", "done", "2026-10-03T08:00:00.000Z"),
            new TaskFacts("ben", "ben", "open", null),
            new TaskFacts("sam", "sam", "open", null),
            new TaskFacts("ben", "sam", "wontdo", "2026-09-30T23:30:00.000Z"),
        ], tasks);
        Assert.Equal([new ListFacts("ben", "private", true), new ListFacts("ben", "shared", false)],
            (await source.ListsAsync(Token)).OrderBy(list => list.Visibility));
        var storage = await source.StorageAsync(Token);
        Assert.True(storage["ben"] > storage["sam"]);
    }

    [Fact]
    public async Task Reads_last_activity_and_devices_that_synced_lately_from_the_access_log()
    {
        var audit = new SqlAuditStore(database);
        var now = new DateTimeOffset(2026, 10, 22, 12, 0, 0, TimeSpan.Zero);
        var n = 0;
        AuditEntry Sync(string actor, string device, int daysAgo, string? by = null) => new()
        {
            Id = $"A{++n:D4}", Time = now.AddDays(-daysAgo), Kind = AuditKind.Access, Type = "request", Outcome = AuditOutcome.Ok,
            ActorId = actor, Device = device, Route = "/api/sync", Method = "POST", ImpersonatorId = by,
        };
        await audit.AppendAsync([
            Sync("ben", "phone", 1), Sync("ben", "laptop", 2), Sync("ben", "phone", 3), Sync("ben", "old tablet", 60),
            Sync("sam", "phone", 0, by: "ben"),
            new AuditEntry { Id = "E1", Time = now, Kind = AuditKind.Event, Type = "auth.sign-in", Outcome = AuditOutcome.Ok, ActorId = "kim" },
        ], Token);

        var activity = (await new SqlStatsSource(database).ActivityAsync(now.AddDays(-30), Token)).OrderBy(each => each.AccountId).ToList();
        Assert.Equal([
            new Activity("ben", now.AddDays(-1), 2),
            new Activity("kim", now, 0),
            // Viewed as by an admin: active, but not one of their devices.
            new Activity("sam", now, 0),
        ], activity);
    }
}
