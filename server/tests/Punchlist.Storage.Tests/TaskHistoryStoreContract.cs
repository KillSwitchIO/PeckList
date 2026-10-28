using Punchlist.Core.History;

namespace Punchlist.Storage.Tests;

/// <summary>What every <see cref="ITaskHistoryStore"/> adapter must do (R-FB-105).</summary>
public abstract class TaskHistoryStoreContract : IAsyncLifetime
{
    protected ITaskHistoryStore History { get; private set; } = null!;

    protected abstract Task<ITaskHistoryStore> CreateAsync();

    public async ValueTask InitializeAsync() => History = await CreateAsync();

    public ValueTask DisposeAsync() => ValueTask.CompletedTask;

    private static CancellationToken Token => TestContext.Current.CancellationToken;

    private static readonly DateTimeOffset Monday = new(2026, 10, 19, 8, 0, 0, TimeSpan.Zero);

    private static HistoryEntry Entry(string id, string task, int minutes, string field, string? after = null) => new()
    {
        Id = id,
        TaskId = task,
        At = Monday.AddMinutes(minutes),
        ActorId = "sam",
        Field = field,
        Before = "\"old\"",
        After = after,
    };

    [Fact]
    public async Task Lists_a_tasks_changes_newest_first_and_finds_a_fields_latest()
    {
        await History.AddAsync([Entry("H1", "T1", 1, "title", "\"a\""), Entry("H2", "T1", 3, "title", "\"b\""), Entry("H3", "T2", 2, "priority")], Token);
        var changes = await History.ListAsync("T1", 10, Token);
        Assert.Equal(["H2", "H1"], changes.Select(each => each.Id));
        Assert.Equal(("sam", "\"old\"", "\"b\"", Monday.AddMinutes(3)), (changes[0].ActorId, changes[0].Before, changes[0].After, changes[0].At));
        Assert.Equal("H2", (await History.LatestAsync("T1", "title", Token))?.Id);
        Assert.Null(await History.LatestAsync("T1", "priority", Token));
    }

    [Fact]
    public async Task Updates_deletes_forgets_an_actor_and_prunes()
    {
        await History.AddAsync([Entry("H1", "T1", 1, "title", "\"a\""), Entry("H2", "T1", 60, "notes")], Token);
        await History.UpdateAsync("H1", "\"z\"", Monday.AddMinutes(5), Token);
        Assert.Equal("\"z\"", (await History.LatestAsync("T1", "title", Token))?.After);
        await History.ForgetActorAsync("sam", Token);
        Assert.All(await History.ListAsync("T1", 10, Token), each => Assert.Null(each.ActorId));
        Assert.Equal(1, await History.PruneAsync(Monday.AddMinutes(30), Token));
        await History.DeleteAsync("H2", Token);
        Assert.Empty(await History.ListAsync("T1", 10, Token));
    }
}
