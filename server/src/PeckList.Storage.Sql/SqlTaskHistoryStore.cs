using Dapper;
using PeckList.Core.History;

namespace PeckList.Storage.Sql;

/// <summary>Task history in <c>task_history</c> (R-FB-105); times as Unix milliseconds.</summary>
public sealed class SqlTaskHistoryStore(SqlDatabase database) : ITaskHistoryStore
{
    private const string Columns =
        "id, task_id AS taskId, at, actor_id AS actorId, field, before_val AS beforeVal, after_val AS afterVal";

    public async Task AddAsync(IReadOnlyList<HistoryEntry> entries, CancellationToken cancellation = default)
    {
        if (entries.Count == 0) return;
        await using var connection = await database.OpenAsync(cancellation);
        await using var transaction = await database.BeginWriteAsync(connection, cancellation);
        await connection.ExecuteAsync(new CommandDefinition(
            """
            INSERT INTO task_history (id, task_id, at, actor_id, field, before_val, after_val)
            VALUES (@Id, @TaskId, @At, @ActorId, @Field, @BeforeVal, @AfterVal)
            """,
            entries.Select(Row.From).ToList(), transaction, cancellationToken: cancellation));
        await transaction.CommitAsync(cancellation);
    }

    public async Task<IReadOnlyList<HistoryEntry>> ListAsync(string taskId, int limit, CancellationToken cancellation = default)
    {
        await using var connection = await database.OpenAsync(cancellation);
        var rows = await connection.QueryAsync<Row>(new CommandDefinition(
            $"SELECT {Columns} FROM task_history WHERE task_id = @taskId ORDER BY at DESC, id DESC LIMIT @limit",
            new { taskId, limit = Math.Clamp(limit, 1, 1000) }, cancellationToken: cancellation));
        return [.. rows.Select(row => row.ToEntry())];
    }

    public async Task<HistoryEntry?> LatestAsync(string taskId, string field, CancellationToken cancellation = default)
    {
        await using var connection = await database.OpenAsync(cancellation);
        var row = await connection.QueryFirstOrDefaultAsync<Row>(new CommandDefinition(
            $"SELECT {Columns} FROM task_history WHERE task_id = @taskId AND field = @field ORDER BY at DESC, id DESC LIMIT 1",
            new { taskId, field }, cancellationToken: cancellation));
        return row?.ToEntry();
    }

    public async Task UpdateAsync(string id, string? after, DateTimeOffset at, CancellationToken cancellation = default)
    {
        await using var connection = await database.OpenAsync(cancellation);
        await using var transaction = await database.BeginWriteAsync(connection, cancellation);
        await connection.ExecuteAsync(new CommandDefinition(
            "UPDATE task_history SET after_val = @after, at = @at WHERE id = @id",
            new { id, after, at = at.ToUnixTimeMilliseconds() }, transaction, cancellationToken: cancellation));
        await transaction.CommitAsync(cancellation);
    }

    public async Task DeleteAsync(string id, CancellationToken cancellation = default)
    {
        await using var connection = await database.OpenAsync(cancellation);
        await using var transaction = await database.BeginWriteAsync(connection, cancellation);
        await connection.ExecuteAsync(new CommandDefinition(
            "DELETE FROM task_history WHERE id = @id", new { id }, transaction, cancellationToken: cancellation));
        await transaction.CommitAsync(cancellation);
    }

    public async Task ForgetActorAsync(string actorId, CancellationToken cancellation = default)
    {
        await using var connection = await database.OpenAsync(cancellation);
        await using var transaction = await database.BeginWriteAsync(connection, cancellation);
        await connection.ExecuteAsync(new CommandDefinition(
            "UPDATE task_history SET actor_id = NULL WHERE actor_id = @actorId",
            new { actorId }, transaction, cancellationToken: cancellation));
        await transaction.CommitAsync(cancellation);
    }

    public async Task<int> PruneAsync(DateTimeOffset before, CancellationToken cancellation = default)
    {
        await using var connection = await database.OpenAsync(cancellation);
        return await connection.ExecuteAsync(new CommandDefinition(
            "DELETE FROM task_history WHERE at < @before",
            new { before = before.ToUnixTimeMilliseconds() }, cancellationToken: cancellation));
    }

    private sealed record Row
    {
        public string Id { get; init; } = "";
        public string TaskId { get; init; } = "";
        public long At { get; init; }
        public string? ActorId { get; init; }
        public string Field { get; init; } = "";
        public string? BeforeVal { get; init; }
        public string? AfterVal { get; init; }

        public static Row From(HistoryEntry entry) => new()
        {
            Id = entry.Id,
            TaskId = entry.TaskId,
            At = entry.At.ToUnixTimeMilliseconds(),
            ActorId = entry.ActorId,
            Field = entry.Field,
            BeforeVal = entry.Before,
            AfterVal = entry.After,
        };

        public HistoryEntry ToEntry() => new()
        {
            Id = Id,
            TaskId = TaskId,
            At = DateTimeOffset.FromUnixTimeMilliseconds(At),
            ActorId = ActorId,
            Field = Field,
            Before = BeforeVal,
            After = AfterVal,
        };
    }
}
