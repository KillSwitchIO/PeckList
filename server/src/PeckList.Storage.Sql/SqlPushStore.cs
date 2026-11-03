using Dapper;
using PeckList.Core.Push;

namespace PeckList.Storage.Sql;

/// <summary>Web Push subscriptions in <c>push_subscriptions</c>, sent reminders in <c>sent_reminders</c>.</summary>
public sealed class SqlPushStore(SqlDatabase database, TimeProvider time) : IPushStore
{
    public async Task SaveAsync(PushSubscription subscription, CancellationToken cancellation = default)
    {
        await using var connection = await database.OpenAsync(cancellation);
        await using var transaction = await database.BeginWriteAsync(connection, cancellation);
        await connection.ExecuteAsync(new CommandDefinition(
            """
            INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth, created_at)
            VALUES (@Endpoint, @UserId, @P256dh, @Auth, @At)
            ON CONFLICT (endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth
            """,
            new { subscription.Endpoint, subscription.UserId, subscription.P256dh, subscription.Auth, At = time.GetUtcNow().ToUnixTimeMilliseconds() },
            transaction, cancellationToken: cancellation));
        await transaction.CommitAsync(cancellation);
    }

    public async Task<IReadOnlyList<PushSubscription>> ForUserAsync(string userId, CancellationToken cancellation = default)
    {
        await using var connection = await database.OpenAsync(cancellation);
        var rows = await connection.QueryAsync<Row>(new CommandDefinition(
            "SELECT user_id AS userId, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = @userId ORDER BY created_at",
            new { userId }, cancellationToken: cancellation));
        return [.. rows.Select(row => new PushSubscription(row.UserId, row.Endpoint, row.P256dh, row.Auth))];
    }

    public Task RemoveAsync(string endpoint, CancellationToken cancellation = default) =>
        ExecuteAsync("DELETE FROM push_subscriptions WHERE endpoint = @endpoint", new { endpoint }, cancellation);

    public Task RemoveUserAsync(string userId, CancellationToken cancellation = default) =>
        ExecuteAsync("DELETE FROM push_subscriptions WHERE user_id = @userId", new { userId }, cancellation);

    public async Task<bool> MarkReminderSentAsync(string key, DateTimeOffset at, CancellationToken cancellation = default)
    {
        await using var connection = await database.OpenAsync(cancellation);
        await using var transaction = await database.BeginWriteAsync(connection, cancellation);
        var added = await connection.ExecuteAsync(new CommandDefinition(
            "INSERT INTO sent_reminders (key, at) VALUES (@key, @at) ON CONFLICT (key) DO NOTHING",
            new { key, at = at.ToUnixTimeMilliseconds() }, transaction, cancellationToken: cancellation));
        await transaction.CommitAsync(cancellation);
        return added > 0;
    }

    public Task PruneSentRemindersAsync(DateTimeOffset before, CancellationToken cancellation = default) =>
        ExecuteAsync("DELETE FROM sent_reminders WHERE at < @before", new { before = before.ToUnixTimeMilliseconds() }, cancellation);

    private async Task ExecuteAsync(string sql, object parameters, CancellationToken cancellation)
    {
        await using var connection = await database.OpenAsync(cancellation);
        await using var transaction = await database.BeginWriteAsync(connection, cancellation);
        await connection.ExecuteAsync(new CommandDefinition(sql, parameters, transaction, cancellationToken: cancellation));
        await transaction.CommitAsync(cancellation);
    }

    private sealed record Row
    {
        public string UserId { get; init; } = "";
        public string Endpoint { get; init; } = "";
        public string P256dh { get; init; } = "";
        public string Auth { get; init; } = "";
    }
}
