using Dapper;
using Punchlist.Core.Stats;

namespace Punchlist.Storage.Sql;

/// <summary>
/// The stats' facts straight from SQL: only the few JSON fields counted are read out of each
/// document (no titles), live entities only.
/// </summary>
public sealed class SqlStatsSource(SqlDatabase database) : IStatsSource
{
    public async Task<long> VersionAsync(CancellationToken cancellation = default)
    {
        await using var connection = await database.OpenAsync(cancellation);
        return Convert.ToInt64(await connection.ExecuteScalarAsync(new CommandDefinition(
            "SELECT value FROM counters WHERE name = 'seq'", cancellationToken: cancellation)));
    }

    public async Task<IReadOnlyList<TaskFacts>> TasksAsync(CancellationToken cancellation = default)
    {
        await using var connection = await database.OpenAsync(cancellation);
        var rows = await connection.QueryAsync<TaskRow>(new CommandDefinition(
            $"""
            SELECT owner_id AS ownerId, {database.JsonText("createdBy")} AS createdBy, {database.JsonText("status")} AS status,
                {database.JsonText("completedAt")} AS completedAt
            FROM entities WHERE collection = 'tasks' AND deleted = @no
            """,
            new { no = false }, cancellationToken: cancellation));
        return [.. rows.Select(row => new TaskFacts(row.OwnerId, row.CreatedBy, row.Status, row.CompletedAt))];
    }

    // A class, not the record: SQLite reports a NULL first value as bytes, which breaks constructor matching.
    private sealed class TaskRow
    {
        public string OwnerId { get; set; } = "";
        public string? CreatedBy { get; set; }
        public string? Status { get; set; }
        public string? CompletedAt { get; set; }
    }

    public async Task<IReadOnlyList<ListFacts>> ListsAsync(CancellationToken cancellation = default)
    {
        await using var connection = await database.OpenAsync(cancellation);
        var rows = await connection.QueryAsync<(string OwnerId, string? Visibility, string? Inbox)>(new CommandDefinition(
            $"""
            SELECT owner_id, {database.JsonText("visibility")}, {database.JsonText("isInbox")}
            FROM entities WHERE collection = 'lists' AND deleted = @no
            """,
            new { no = false }, cancellationToken: cancellation));
        // SQLite hands JSON true out as 1, PostgreSQL as "true".
        return [.. rows.Select(row => new ListFacts(row.OwnerId, row.Visibility, row.Inbox is "1" or "true"))];
    }

    public async Task<IReadOnlyDictionary<string, long>> StorageAsync(CancellationToken cancellation = default)
    {
        await using var connection = await database.OpenAsync(cancellation);
        var rows = await connection.QueryAsync<(string Owner, long Bytes)>(new CommandDefinition(
            $"SELECT owner_id, CAST(SUM(LENGTH({database.DocColumn})) AS BIGINT) FROM entities GROUP BY owner_id",
            cancellationToken: cancellation));
        return rows.ToDictionary(row => row.Owner, row => row.Bytes);
    }

    public async Task<IReadOnlyList<Activity>> ActivityAsync(DateTimeOffset devicesSince, CancellationToken cancellation = default)
    {
        await using var connection = await database.OpenAsync(cancellation);
        var last = await connection.QueryAsync<(string Actor, long At)>(new CommandDefinition(
            "SELECT actor_id, MAX(at) FROM audit_entries WHERE actor_id IS NOT NULL GROUP BY actor_id", cancellationToken: cancellation));
        var devices = (await connection.QueryAsync<(string Actor, long Count)>(new CommandDefinition(
            """
            SELECT actor_id, COUNT(DISTINCT device) FROM audit_entries
            WHERE kind = 'access' AND route = '/api/sync' AND actor_id IS NOT NULL AND by_id IS NULL AND device IS NOT NULL AND at >= @since
            GROUP BY actor_id
            """,
            new { since = devicesSince.ToUnixTimeMilliseconds() }, cancellationToken: cancellation))).ToDictionary(row => row.Actor, row => (int)row.Count);
        return [.. last.Select(row => new Activity(row.Actor, DateTimeOffset.FromUnixTimeMilliseconds(row.At), devices.GetValueOrDefault(row.Actor)))];
    }
}
