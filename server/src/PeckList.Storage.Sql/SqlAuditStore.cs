using System.Text;
using Dapper;
using PeckList.Core.Audit;

namespace PeckList.Storage.Sql;

/// <summary>The access and event log in <c>audit_entries</c>; times as Unix milliseconds.</summary>
public sealed class SqlAuditStore(SqlDatabase database) : IAuditStore
{
    private const string Columns =
        "id, at, kind, type, outcome, actor_id AS actorId, actor_name AS actorName, by_id AS byId, by_name AS byName, " +
        "target_id AS targetId, target_name AS targetName, ip, device, method, route, status, duration_ms AS durationMs, " +
        "request_id AS requestId, detail";

    public async Task AppendAsync(IReadOnlyList<AuditEntry> entries, CancellationToken cancellation = default)
    {
        if (entries.Count == 0) return;
        await using var connection = await database.OpenAsync(cancellation);
        await using var transaction = await database.BeginWriteAsync(connection, cancellation);
        await connection.ExecuteAsync(new CommandDefinition(
            """
            INSERT INTO audit_entries (id, at, kind, type, outcome, actor_id, actor_name, by_id, by_name, target_id, target_name,
                ip, device, method, route, status, duration_ms, request_id, detail)
            VALUES (@Id, @At, @Kind, @Type, @Outcome, @ActorId, @ActorName, @ById, @ByName, @TargetId, @TargetName,
                @Ip, @Device, @Method, @Route, @Status, @DurationMs, @RequestId, @Detail)
            """,
            entries.Select(Row.From).ToList(), transaction, cancellationToken: cancellation));
        await transaction.CommitAsync(cancellation);
    }

    public async Task<AuditPage> QueryAsync(AuditQuery query, CancellationToken cancellation = default)
    {
        var where = new StringBuilder("kind = @Kind");
        var parameters = new DynamicParameters();
        parameters.Add("Kind", query.Kind);
        var like = database.CaseInsensitiveLike;
        if (!string.IsNullOrWhiteSpace(query.Text))
        {
            parameters.Add("Text", Contains(query.Text.Trim()));
            where.Append($" AND (type {like} @Text ESCAPE '\\' OR actor_name {like} @Text ESCAPE '\\' OR target_name {like} @Text ESCAPE '\\'" +
                $" OR by_name {like} @Text ESCAPE '\\' OR ip {like} @Text ESCAPE '\\' OR route {like} @Text ESCAPE '\\' OR detail {like} @Text ESCAPE '\\')");
        }
        if (!string.IsNullOrWhiteSpace(query.User))
        {
            // An id, or a username ignoring case: LIKE only for the case, so % and _ mean themselves.
            parameters.Add("User", query.User.Trim());
            parameters.Add("UserName", Escape(query.User.Trim()));
            where.Append($" AND (actor_id = @User OR target_id = @User OR by_id = @User"
                + $" OR actor_name {like} @UserName ESCAPE '\\' OR target_name {like} @UserName ESCAPE '\\' OR by_name {like} @UserName ESCAPE '\\')");
        }
        if (!string.IsNullOrWhiteSpace(query.Type))
        {
            var type = query.Type.Trim();
            if (type.EndsWith('.'))
            {
                parameters.Add("Type", Escape(type) + "%");
                where.Append(" AND type LIKE @Type ESCAPE '\\'");
            }
            else
            {
                parameters.Add("Type", type);
                where.Append(" AND type = @Type");
            }
        }
        if (!string.IsNullOrWhiteSpace(query.Outcome))
        {
            parameters.Add("Outcome", query.Outcome.Trim());
            where.Append(" AND outcome = @Outcome");
        }
        if (!string.IsNullOrWhiteSpace(query.Ip))
        {
            parameters.Add("Ip", query.Ip.Trim());
            where.Append(" AND ip = @Ip");
        }
        if (query.From is { } from)
        {
            parameters.Add("From", from.ToUnixTimeMilliseconds());
            where.Append(" AND at >= @From");
        }
        if (query.To is { } to)
        {
            parameters.Add("To", to.ToUnixTimeMilliseconds());
            where.Append(" AND at < @To");
        }
        var limit = Math.Clamp(query.Limit, 1, 100_000);
        parameters.Add("Limit", limit + 1);
        parameters.Add("Offset", Math.Max(0, query.Offset));
        var order = query.Ascending ? "ASC" : "DESC";
        await using var connection = await database.OpenAsync(cancellation);
        var rows = (await connection.QueryAsync<Row>(new CommandDefinition(
            $"SELECT {Columns} FROM audit_entries WHERE {where} ORDER BY at {order}, id {order} LIMIT @Limit OFFSET @Offset",
            parameters, cancellationToken: cancellation))).ToList();
        return new AuditPage([.. rows.Take(limit).Select(row => row.ToEntry())], rows.Count > limit);
    }

    public async Task<IReadOnlyList<AuditEntry>> OlderAsync(string kind, DateTimeOffset before, int limit, CancellationToken cancellation = default)
    {
        await using var connection = await database.OpenAsync(cancellation);
        var rows = await connection.QueryAsync<Row>(new CommandDefinition(
            $"SELECT {Columns} FROM audit_entries WHERE kind = @kind AND at < @before ORDER BY at, id LIMIT @limit",
            new { kind, before = before.ToUnixTimeMilliseconds(), limit }, cancellationToken: cancellation));
        return [.. rows.Select(row => row.ToEntry())];
    }

    public async Task<int> PruneAsync(string kind, DateTimeOffset before, CancellationToken cancellation = default)
    {
        await using var connection = await database.OpenAsync(cancellation);
        return await connection.ExecuteAsync(new CommandDefinition(
            "DELETE FROM audit_entries WHERE kind = @kind AND at < @before",
            new { kind, before = before.ToUnixTimeMilliseconds() }, cancellationToken: cancellation));
    }

    private static string Escape(string text) => text.Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_");

    private static string Contains(string text) => "%" + Escape(text) + "%";

    private sealed record Row
    {
        public string Id { get; init; } = "";
        public long At { get; init; }
        public string Kind { get; init; } = "";
        public string Type { get; init; } = "";
        public string Outcome { get; init; } = "";
        public string? ActorId { get; init; }
        public string? ActorName { get; init; }
        public string? ById { get; init; }
        public string? ByName { get; init; }
        public string? TargetId { get; init; }
        public string? TargetName { get; init; }
        public string? Ip { get; init; }
        public string? Device { get; init; }
        public string? Method { get; init; }
        public string? Route { get; init; }
        public int? Status { get; init; }
        public int? DurationMs { get; init; }
        public string? RequestId { get; init; }
        public string? Detail { get; init; }

        public static Row From(AuditEntry entry) => new()
        {
            Id = entry.Id,
            At = entry.Time.ToUnixTimeMilliseconds(),
            Kind = entry.Kind,
            Type = entry.Type,
            Outcome = entry.Outcome,
            ActorId = entry.ActorId,
            ActorName = entry.ActorName,
            ById = entry.ImpersonatorId,
            ByName = entry.ImpersonatorName,
            TargetId = entry.TargetId,
            TargetName = entry.TargetName,
            Ip = entry.Ip,
            Device = entry.Device,
            Method = entry.Method,
            Route = entry.Route,
            Status = entry.Status,
            DurationMs = entry.DurationMs,
            RequestId = entry.RequestId,
            Detail = entry.Detail,
        };

        public AuditEntry ToEntry() => new()
        {
            Id = Id,
            Time = DateTimeOffset.FromUnixTimeMilliseconds(At),
            Kind = Kind,
            Type = Type,
            Outcome = Outcome,
            ActorId = ActorId,
            ActorName = ActorName,
            ImpersonatorId = ById,
            ImpersonatorName = ByName,
            TargetId = TargetId,
            TargetName = TargetName,
            Ip = Ip,
            Device = Device,
            Method = Method,
            Route = Route,
            Status = Status,
            DurationMs = DurationMs,
            RequestId = RequestId,
            Detail = Detail,
        };
    }
}
