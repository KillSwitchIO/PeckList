using Dapper;
using PeckList.Core.Push;

namespace PeckList.Storage.Sql;

/// <summary>
/// Web Push subscriptions in <c>push_subscriptions</c>, sent reminders in <c>sent_reminders</c>, reported zones in
/// <c>device_zones</c>, snoozes in <c>reminder_snoozes</c>.
/// </summary>
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

    public async Task RemoveUserAsync(string userId, CancellationToken cancellation = default)
    {
        await ExecuteAsync("DELETE FROM push_subscriptions WHERE user_id = @userId", new { userId }, cancellation);
        await ExecuteAsync("DELETE FROM device_zones WHERE user_id = @userId", new { userId }, cancellation);
        await ExecuteAsync("DELETE FROM reminder_snoozes WHERE user_id = @userId", new { userId }, cancellation);
    }

    public Task SetDeviceZoneAsync(string userId, string zone, CancellationToken cancellation = default) =>
        ExecuteAsync(
            """
            INSERT INTO device_zones (user_id, zone, reported_at) VALUES (@userId, @zone, @at)
            ON CONFLICT (user_id) DO UPDATE SET zone = excluded.zone, reported_at = excluded.reported_at
            """,
            new { userId, zone, at = time.GetUtcNow().ToUnixTimeMilliseconds() }, cancellation);

    public async Task<string?> DeviceZoneAsync(string userId, CancellationToken cancellation = default)
    {
        await using var connection = await database.OpenAsync(cancellation);
        return await connection.QuerySingleOrDefaultAsync<string?>(new CommandDefinition(
            "SELECT zone FROM device_zones WHERE user_id = @userId", new { userId }, cancellationToken: cancellation));
    }

    public async Task<IReadOnlyDictionary<string, string>> DeviceZonesAsync(CancellationToken cancellation = default)
    {
        await using var connection = await database.OpenAsync(cancellation);
        var rows = await connection.QueryAsync<(string UserId, string Zone)>(new CommandDefinition(
            "SELECT user_id, zone FROM device_zones", cancellationToken: cancellation));
        return rows.ToDictionary(row => row.UserId, row => row.Zone, StringComparer.Ordinal);
    }

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

    public async Task PruneSentRemindersAsync(DateTimeOffset before, CancellationToken cancellation = default)
    {
        await ExecuteAsync("DELETE FROM sent_reminders WHERE at < @before", new { before = before.ToUnixTimeMilliseconds() }, cancellation);
        await ExecuteAsync("DELETE FROM reminder_snoozes WHERE at < @before", new { before = before.ToUnixTimeMilliseconds() }, cancellation);
    }

    public Task SnoozeAsync(string userId, string taskId, DateTimeOffset at, CancellationToken cancellation = default) =>
        ExecuteAsync(
            "INSERT INTO reminder_snoozes (user_id, task_id, at) VALUES (@userId, @taskId, @at) ON CONFLICT (user_id, task_id, at) DO NOTHING",
            new { userId, taskId, at = at.ToUnixTimeMilliseconds() }, cancellation);

    public async Task<IReadOnlyList<ReminderSnooze>> SnoozesAsync(
        DateTimeOffset from, DateTimeOffset to, string? userId = null, CancellationToken cancellation = default)
    {
        await using var connection = await database.OpenAsync(cancellation);
        var rows = await connection.QueryAsync<(string UserId, string TaskId, long At)>(new CommandDefinition(
            "SELECT user_id, task_id, at FROM reminder_snoozes WHERE at > @from AND at <= @to"
                + (userId is null ? "" : " AND user_id = @userId") + " ORDER BY at, user_id, task_id",
            new { from = from.ToUnixTimeMilliseconds(), to = to.ToUnixTimeMilliseconds(), userId }, cancellationToken: cancellation));
        return [.. rows.Select(row => new ReminderSnooze(row.UserId, row.TaskId, DateTimeOffset.FromUnixTimeMilliseconds(row.At)))];
    }

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
