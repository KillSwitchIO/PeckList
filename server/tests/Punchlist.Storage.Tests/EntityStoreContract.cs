using System.Text.Json.Nodes;
using Punchlist.Core.Storage;

namespace Punchlist.Storage.Tests;

/// <summary>What every <see cref="IEntityStore"/> adapter must do. Each adapter's test class derives from this.</summary>
public abstract class EntityStoreContract : IAsyncLifetime
{
    protected IEntityStore Store { get; private set; } = null!;

    /// <summary>A fresh, empty, migrated store.</summary>
    protected abstract Task<IEntityStore> CreateStoreAsync();

    public async ValueTask InitializeAsync() => Store = await CreateStoreAsync();

    public virtual ValueTask DisposeAsync() => ValueTask.CompletedTask;

    private static CancellationToken Token => TestContext.Current.CancellationToken;

    protected static IncomingEntity Task(string id, string title, string? hlc = null) =>
        new("tasks", new JsonObject
        {
            ["id"] = id,
            ["title"] = title,
            ["deletedAt"] = null,
            ["_hlc"] = new JsonObject { ["title"] = hlc ?? "2026-10-21T10:00:00.000Z-0000-dev1" },
        });

    /// <summary>Store whatever arrives.</summary>
    private static JsonObject TakeIncoming(StoredEntity? _, IncomingEntity incoming) => (JsonObject)incoming.Doc.DeepClone();

    [Fact]
    public async Task An_empty_store_has_cursor_zero_and_no_changes()
    {
        Assert.Equal(0, await Store.CursorAsync(Token));
        var page = await Store.ChangesAsync("u1", 0, 10, Token);
        Assert.Empty(page.Entities);
        Assert.Equal(0, page.Cursor);
        Assert.False(page.More);
        Assert.True(await Store.PingAsync(Token));
    }

    [Fact]
    public async Task Migrating_twice_changes_nothing()
    {
        await Store.WriteAsync("u1", [Task("T1", "Mow")], TakeIncoming, Token);
        await Store.MigrateAsync(Token);
        Assert.Equal("Mow", (string?)(await Store.GetAsync("T1", Token))!.Doc["title"]);
    }

    [Fact]
    public async Task Writes_get_increasing_seqs_in_input_order()
    {
        var written = await Store.WriteAsync("u1", [Task("T1", "Mow"), Task("T2", "Rake")], TakeIncoming, Token);
        Assert.Equal(["T1", "T2"], written.Select(each => each.Id));
        Assert.Equal([1L, 2L], written.Select(each => each.Seq));
        Assert.Equal(2, await Store.CursorAsync(Token));

        var again = await Store.WriteAsync("u1", [Task("T1", "Mow the lawn")], TakeIncoming, Token);
        Assert.Equal(3, again.Single().Seq);
    }

    [Fact]
    public async Task Keeps_the_json_as_written()
    {
        var doc = new JsonObject
        {
            ["id"] = "T1",
            ["title"] = "Café ☕ <b>&</b> \"quoted\"",
            ["schedule"] = new JsonObject { ["start"] = "2026-11-03T09:00", ["allDay"] = false },
            ["tags"] = new JsonObject { ["G1"] = new JsonObject { ["in"] = true, ["hlc"] = "2026-10-21T10:00:00.000Z-0000-dev1" } },
            ["progress"] = 40,
            ["deletedAt"] = null,
            ["_hlc"] = new JsonObject(),
        };
        await Store.WriteAsync("u1", [new IncomingEntity("tasks", doc)], TakeIncoming, Token);
        var stored = await Store.GetAsync("T1", Token);
        Assert.NotNull(stored);
        Assert.Equal("tasks", stored.Collection);
        Assert.Equal("u1", stored.OwnerId);
        Assert.True(JsonNode.DeepEquals(doc, stored.Doc), stored.Doc.ToJsonString());
    }

    [Fact]
    public async Task Resolve_sees_what_is_stored_and_can_skip_a_write()
    {
        await Store.WriteAsync("u1", [Task("T1", "Mow")], TakeIncoming, Token);
        StoredEntity? seen = null;
        var written = await Store.WriteAsync("u1", [Task("T1", "Rake")], (stored, _) =>
        {
            seen = stored;
            return null;
        }, Token);
        Assert.Empty(written);
        Assert.Equal("Mow", (string?)seen!.Doc["title"]);
        Assert.Equal(1, await Store.CursorAsync(Token));
        Assert.Equal("Mow", (string?)(await Store.GetAsync("T1", Token))!.Doc["title"]);
    }

    [Fact]
    public async Task The_same_id_twice_in_a_batch_builds_on_the_first()
    {
        var seen = new List<string?>();
        var written = await Store.WriteAsync("u1", [Task("T1", "Mow"), Task("T1", "Rake")], (stored, incoming) =>
        {
            seen.Add((string?)stored?.Doc["title"]);
            return (JsonObject)incoming.Doc.DeepClone();
        }, Token);
        Assert.Equal([null, "Mow"], seen);
        Assert.Equal("Rake", (string?)written.Single().Doc["title"]);
        Assert.Equal("Rake", (string?)(await Store.GetAsync("T1", Token))!.Doc["title"]);
    }

    [Fact]
    public async Task An_existing_entity_keeps_its_owner()
    {
        await Store.WriteAsync("u1", [Task("T1", "Mow")], TakeIncoming, Token);
        var written = await Store.WriteAsync("u2", [Task("T1", "Rake")], TakeIncoming, Token);
        Assert.Equal("u1", written.Single().OwnerId);
        Assert.Empty((await Store.ChangesAsync("u2", 0, 10, Token)).Entities);
    }

    [Fact]
    public async Task Changes_show_only_what_the_user_may_see_after_the_cursor()
    {
        await Store.WriteAsync("u1", [Task("T1", "Mow")], TakeIncoming, Token);
        await Store.WriteAsync("u2", [Task("T2", "Paint")], TakeIncoming, Token);
        await Store.WriteAsync("u1", [Task("T3", "Rake")], TakeIncoming, Token);

        var all = await Store.ChangesAsync("u1", 0, 10, Token);
        Assert.Equal(["T1", "T3"], all.Entities.Select(each => each.Id));
        Assert.Equal(3, all.Cursor);

        var later = await Store.ChangesAsync("u1", 1, 10, Token);
        Assert.Equal(["T3"], later.Entities.Select(each => each.Id));
    }

    [Fact]
    public async Task A_rewritten_entity_moves_to_the_end_of_the_feed()
    {
        await Store.WriteAsync("u1", [Task("T1", "Mow"), Task("T2", "Rake")], TakeIncoming, Token);
        await Store.WriteAsync("u1", [Task("T1", "Mow again")], TakeIncoming, Token);
        var page = await Store.ChangesAsync("u1", 0, 10, Token);
        Assert.Equal(["T2", "T1"], page.Entities.Select(each => each.Id));
        Assert.Equal("Mow again", (string?)page.Entities[1].Doc["title"]);
    }

    [Fact]
    public async Task Pages_through_the_feed()
    {
        var tasks = Enumerable.Range(1, 5).Select(index => Task($"T{index}", $"Task {index}")).ToList();
        await Store.WriteAsync("u1", tasks, TakeIncoming, Token);

        var first = await Store.ChangesAsync("u1", 0, 2, Token);
        Assert.Equal(["T1", "T2"], first.Entities.Select(each => each.Id));
        Assert.True(first.More);
        var second = await Store.ChangesAsync("u1", first.Cursor, 2, Token);
        Assert.Equal(["T3", "T4"], second.Entities.Select(each => each.Id));
        var third = await Store.ChangesAsync("u1", second.Cursor, 2, Token);
        Assert.Equal(["T5"], third.Entities.Select(each => each.Id));
        Assert.False(third.More);
    }

    [Fact]
    public async Task Tombstones_stay_in_the_feed()
    {
        await Store.WriteAsync("u1", [Task("T1", "Mow")], TakeIncoming, Token);
        var deleted = Task("T1", "Mow");
        deleted.Doc["deletedAt"] = "2026-10-21T11:00:00.000Z";
        await Store.WriteAsync("u1", [deleted], TakeIncoming, Token);
        var page = await Store.ChangesAsync("u1", 1, 10, Token);
        Assert.Equal("2026-10-21T11:00:00.000Z", (string?)page.Entities.Single().Doc["deletedAt"]);
    }

    [Fact]
    public async Task Lists_everything_in_seq_order()
    {
        await Store.WriteAsync("u1", [Task("T1", "Mow")], TakeIncoming, Token);
        await Store.WriteAsync("u2", [Task("T2", "Paint")], TakeIncoming, Token);
        await Store.WriteAsync("u1", [Task("T1", "Mow again")], TakeIncoming, Token);
        var all = new List<StoredEntity>();
        await foreach (var entity in Store.AllAsync(Token)) all.Add(entity);
        Assert.Equal(["T2", "T1"], all.Select(each => each.Id));
        Assert.Equal([2L, 3L], all.Select(each => each.Seq));
    }

    [Fact]
    public async Task Writes_many_ids_at_once()
    {
        // More ids than one IN (...) takes.
        var tasks = Enumerable.Range(1, 1000).Select(index => Task($"T{index:D4}", $"Task {index}")).ToList();
        await Store.WriteAsync("u1", tasks, TakeIncoming, Token);
        var updated = await Store.WriteAsync("u1", tasks, (stored, incoming) => stored is null ? null : (JsonObject)incoming.Doc.DeepClone(), Token);
        Assert.Equal(1000, updated.Count);
        Assert.Equal(2000, await Store.CursorAsync(Token));
    }

    [Fact]
    public async Task Concurrent_writers_never_leave_a_gap_behind_a_cursor()
    {
        // Many writers at once: every change a reader sees must come after every change it saw
        // before, so following the cursor never skips one.
        var writers = Enumerable.Range(0, 8).Select(writer => System.Threading.Tasks.Task.Run(async () =>
        {
            for (var round = 0; round < 10; round++)
            {
                await Store.WriteAsync("u1", [Task($"W{writer}-{round}", "x")], TakeIncoming, Token);
            }
        }, Token)).ToList();

        var seen = new HashSet<string>();
        long cursor = 0;
        while (writers.Any(writer => !writer.IsCompleted) || cursor < await Store.CursorAsync(Token))
        {
            var page = await Store.ChangesAsync("u1", cursor, 7, Token);
            foreach (var entity in page.Entities) seen.Add(entity.Id);
            cursor = page.Cursor;
        }
        await System.Threading.Tasks.Task.WhenAll(writers);
        Assert.Equal(80, seen.Count);
        Assert.Equal(80, await Store.CursorAsync(Token));
    }
}
