using Dapper;
using Punchlist.Core.Notifications;

namespace Punchlist.Storage.Sql;

/// <summary>Notifications in <c>notifications</c>; times as Unix milliseconds.</summary>
public sealed class SqlNotificationStore(SqlDatabase database) : INotificationStore
{
    private const string Columns =
        "id, user_id AS userId, kind, at, actor_id AS actorId, task_id AS taskId, list_id AS listId, " +
        "comment_id AS commentId, read_at AS readAt";

    public async Task AddAsync(IReadOnlyList<Notification> notifications, CancellationToken cancellation = default)
    {
        if (notifications.Count == 0) return;
        await using var connection = await database.OpenAsync(cancellation);
        await using var transaction = await database.BeginWriteAsync(connection, cancellation);
        await connection.ExecuteAsync(new CommandDefinition(
            """
            INSERT INTO notifications (id, user_id, kind, at, actor_id, task_id, list_id, comment_id, read_at)
            VALUES (@Id, @UserId, @Kind, @At, @ActorId, @TaskId, @ListId, @CommentId, @ReadAt)
            """,
            notifications.Select(Row.From).ToList(), transaction, cancellationToken: cancellation));
        await transaction.CommitAsync(cancellation);
    }

    public async Task<IReadOnlyList<Notification>> ListAsync(string userId, int limit, CancellationToken cancellation = default)
    {
        await using var connection = await database.OpenAsync(cancellation);
        var rows = await connection.QueryAsync<Row>(new CommandDefinition(
            $"SELECT {Columns} FROM notifications WHERE user_id = @userId ORDER BY at DESC, id DESC LIMIT @limit",
            new { userId, limit = Math.Clamp(limit, 1, 1000) }, cancellationToken: cancellation));
        return [.. rows.Select(row => row.ToNotification())];
    }

    public async Task<int> UnreadCountAsync(string userId, CancellationToken cancellation = default)
    {
        await using var connection = await database.OpenAsync(cancellation);
        return Convert.ToInt32(await connection.ExecuteScalarAsync(new CommandDefinition(
            "SELECT COUNT(*) FROM notifications WHERE user_id = @userId AND read_at IS NULL",
            new { userId }, cancellationToken: cancellation)));
    }

    public Task MarkReadAsync(string userId, IReadOnlyCollection<string>? ids, DateTimeOffset at, CancellationToken cancellation = default) =>
        WriteMineAsync(userId, ids, "UPDATE notifications SET read_at = @at WHERE user_id = @userId AND read_at IS NULL", at, cancellation);

    public Task DeleteAsync(string userId, IReadOnlyCollection<string>? ids, CancellationToken cancellation = default) =>
        WriteMineAsync(userId, ids, "DELETE FROM notifications WHERE user_id = @userId", null, cancellation);

    /// <summary>One write over some of a person's notifications (<paramref name="ids"/>), or all of them (null).</summary>
    private async Task WriteMineAsync(string userId, IReadOnlyCollection<string>? ids, string sql, DateTimeOffset? at, CancellationToken cancellation)
    {
        if (ids is { Count: 0 }) return;
        await using var connection = await database.OpenAsync(cancellation);
        await using var transaction = await database.BeginWriteAsync(connection, cancellation);
        var only = ids is null ? "" : $" AND {database.IdInList}";
        await connection.ExecuteAsync(new CommandDefinition(
            sql + only, new { userId, ids = ids?.ToArray(), at = at?.ToUnixTimeMilliseconds() }, transaction, cancellationToken: cancellation));
        await transaction.CommitAsync(cancellation);
    }

    public async Task<int> PruneAsync(DateTimeOffset before, CancellationToken cancellation = default)
    {
        await using var connection = await database.OpenAsync(cancellation);
        return await connection.ExecuteAsync(new CommandDefinition(
            "DELETE FROM notifications WHERE at < @before",
            new { before = before.ToUnixTimeMilliseconds() }, cancellationToken: cancellation));
    }

    private sealed record Row
    {
        public string Id { get; init; } = "";
        public string UserId { get; init; } = "";
        public string Kind { get; init; } = "";
        public long At { get; init; }
        public string? ActorId { get; init; }
        public string? TaskId { get; init; }
        public string? ListId { get; init; }
        public string? CommentId { get; init; }
        public long? ReadAt { get; init; }

        public static Row From(Notification notification) => new()
        {
            Id = notification.Id,
            UserId = notification.UserId,
            Kind = notification.Kind,
            At = notification.At.ToUnixTimeMilliseconds(),
            ActorId = notification.ActorId,
            TaskId = notification.TaskId,
            ListId = notification.ListId,
            CommentId = notification.CommentId,
            ReadAt = notification.ReadAt?.ToUnixTimeMilliseconds(),
        };

        public Notification ToNotification() => new()
        {
            Id = Id,
            UserId = UserId,
            Kind = Kind,
            At = DateTimeOffset.FromUnixTimeMilliseconds(At),
            ActorId = ActorId,
            TaskId = TaskId,
            ListId = ListId,
            CommentId = CommentId,
            ReadAt = ReadAt is { } read ? DateTimeOffset.FromUnixTimeMilliseconds(read) : null,
        };
    }
}
