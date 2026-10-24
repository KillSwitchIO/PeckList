using System.Data.Common;
using System.Runtime.CompilerServices;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using Dapper;
using Punchlist.Core.Storage;

namespace Punchlist.Storage.Sql;

/// <summary>
/// Entities in a SQL database: <c>entities(id, collection, owner_id, seq, hlc, deleted, doc)</c>,
/// <c>visibility(user_id, entity_id)</c> and a <c>counters</c> row holding the last seq.
/// </summary>
public sealed class SqlEntityStore(SqlDatabase database) : IEntityStore
{
    /// <summary>Keeps non-ASCII text readable in the stored JSON.</summary>
    public static readonly JsonSerializerOptions Json = new() { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping };

    /// <summary>How many ids go into one <c>IN (...)</c> (SQLite allows 999 parameters).</summary>
    private const int Chunk = 400;

    private string DocColumn => database.DocColumn;

    public async Task<long> CursorAsync(CancellationToken cancellation = default)
    {
        await using var connection = await database.OpenAsync(cancellation);
        return await connection.ExecuteScalarAsync<long>(
            new CommandDefinition("SELECT value FROM counters WHERE name = 'seq'", cancellationToken: cancellation));
    }

    public async Task<StoredEntity?> GetAsync(string id, CancellationToken cancellation = default)
    {
        await using var connection = await database.OpenAsync(cancellation);
        var row = await connection.QuerySingleOrDefaultAsync<Row>(new CommandDefinition(
            $"SELECT collection, id, owner_id AS ownerId, seq, {DocColumn} AS doc FROM entities WHERE id = @id",
            new { id },
            cancellationToken: cancellation));
        return row?.ToEntity();
    }

    public async Task<IReadOnlyList<StoredEntity>> WriteAsync(
        string ownerId,
        IReadOnlyList<IncomingEntity> incoming,
        Func<StoredEntity?, IncomingEntity, JsonObject?> resolve,
        Func<IReadOnlyList<StoredEntity>, VisibilityPlan>? plan = null,
        CancellationToken cancellation = default)
    {
        if (incoming.Count == 0) return [];
        await using var connection = await database.OpenAsync(cancellation);
        await using var transaction = await database.BeginWriteAsync(connection, cancellation);

        var existing = new Dictionary<string, StoredEntity>();
        foreach (var ids in incoming.Select(each => each.Id).Distinct().Chunk(Chunk))
        {
            var rows = await connection.QueryAsync<Row>(new CommandDefinition(
                $"SELECT collection, id, owner_id AS ownerId, seq, {DocColumn} AS doc FROM entities WHERE {database.IdInList}",
                new { ids },
                transaction,
                cancellationToken: cancellation));
            foreach (var row in rows) existing[row.Id] = row.ToEntity();
        }

        // Decide everything first, then take one block of seq numbers for what changed.
        var writes = new List<(IncomingEntity Incoming, string Owner, JsonObject Doc)>();
        foreach (var entity in incoming)
        {
            existing.TryGetValue(entity.Id, out var stored);
            var doc = resolve(stored, entity);
            if (doc is null) continue;
            var owner = entity.Owner ?? stored?.OwnerId ?? ownerId;
            var collection = stored?.Collection ?? entity.Collection;
            var written = new StoredEntity(collection, entity.Id, owner, 0, doc);
            // A later entry for the same id builds on this one.
            existing[entity.Id] = written;
            writes.Add((entity with { Collection = collection }, owner, doc));
        }
        if (writes.Count == 0)
        {
            await transaction.CommitAsync(cancellation);
            return [];
        }
        var last = await connection.ExecuteScalarAsync<long>(new CommandDefinition(
            "UPDATE counters SET value = value + @count WHERE name = 'seq' RETURNING value",
            new { count = writes.Count },
            transaction,
            cancellationToken: cancellation));
        var seq = last - writes.Count;

        var result = new List<StoredEntity>(writes.Count);
        foreach (var (entity, owner, doc) in writes)
        {
            seq++;
            await connection.ExecuteAsync(new CommandDefinition(
                $"""
                INSERT INTO entities (id, collection, owner_id, seq, hlc, deleted, doc)
                VALUES (@id, @collection, @owner, @seq, @hlc, @deleted, {database.DocParameter})
                ON CONFLICT (id) DO UPDATE SET
                    owner_id = excluded.owner_id, seq = excluded.seq, hlc = excluded.hlc,
                    deleted = excluded.deleted, doc = excluded.doc
                """,
                new
                {
                    id = entity.Id,
                    collection = entity.Collection,
                    owner,
                    seq,
                    hlc = LatestHlc(doc),
                    deleted = doc["deletedAt"] is not null,
                    doc = doc.ToJsonString(Json),
                },
                transaction,
                cancellationToken: cancellation));
            result.Add(new StoredEntity(entity.Collection, entity.Id, owner, seq, doc));
        }
        // Several writes to one id in a batch: report each id once, at its final state.
        var final = result.GroupBy(each => each.Id).Select(group => group.Last()).OrderBy(each => each.Seq).ToList();
        var access = plan?.Invoke(final)
            ?? new VisibilityPlan(final.Select(each => (each.OwnerId, each.Id)).ToList(), []);
        await ApplyPlanAsync(connection, transaction, access, final.Select(each => each.Id).ToHashSet(StringComparer.Ordinal), cancellation);
        await transaction.CommitAsync(cancellation);
        return final;
    }

    public async Task ApplyVisibilityAsync(VisibilityPlan plan, CancellationToken cancellation = default)
    {
        if (plan.Grants.Count == 0 && plan.Revokes.Count == 0) return;
        await using var connection = await database.OpenAsync(cancellation);
        await using var transaction = await database.BeginWriteAsync(connection, cancellation);
        await ApplyPlanAsync(connection, transaction, plan, new HashSet<string>(), cancellation);
        await transaction.CommitAsync(cancellation);
    }

    /// <summary>
    /// Grants and revocations. One for an entity written in this same batch rides on the entity's
    /// own seq; any other takes a seq of its own, so it lands in the feed in order. Ones that
    /// change nothing (already visible, never visible) are skipped.
    /// </summary>
    private static async Task ApplyPlanAsync(
        DbConnection connection,
        DbTransaction transaction,
        VisibilityPlan plan,
        IReadOnlySet<string> written,
        CancellationToken cancellation)
    {
        async Task<bool> Visible(string userId, string entityId) =>
            await connection.ExecuteScalarAsync<long>(new CommandDefinition(
                "SELECT COUNT(*) FROM visibility WHERE user_id = @userId AND entity_id = @entityId",
                new { userId, entityId }, transaction, cancellationToken: cancellation)) > 0;

        var revokes = new List<(string, string)>();
        foreach (var (userId, entityId) in plan.Revokes.Distinct())
        {
            if (await Visible(userId, entityId)) revokes.Add((userId, entityId));
        }
        var grants = new List<(string UserId, string EntityId, bool Own)>();
        foreach (var (userId, entityId) in plan.Grants.Distinct())
        {
            if (!await Visible(userId, entityId)) grants.Add((userId, entityId, written.Contains(entityId)));
        }
        var count = revokes.Count + grants.Count(grant => !grant.Own);
        var seq = 0L;
        if (count > 0)
        {
            var last = await connection.ExecuteScalarAsync<long>(new CommandDefinition(
                "UPDATE counters SET value = value + @count WHERE name = 'seq' RETURNING value",
                new { count }, transaction, cancellationToken: cancellation));
            seq = last - count;
        }
        foreach (var (userId, entityId) in revokes)
        {
            seq++;
            await connection.ExecuteAsync(new CommandDefinition(
                "DELETE FROM visibility WHERE user_id = @userId AND entity_id = @entityId",
                new { userId, entityId }, transaction, cancellationToken: cancellation));
            await connection.ExecuteAsync(new CommandDefinition(
                """
                INSERT INTO revocations (user_id, entity_id, seq) VALUES (@userId, @entityId, @seq)
                ON CONFLICT (user_id, entity_id) DO UPDATE SET seq = excluded.seq
                """,
                new { userId, entityId, seq }, transaction, cancellationToken: cancellation));
        }
        foreach (var (userId, entityId, own) in grants)
        {
            // Written in this batch: its own new seq already puts it in the feed.
            var granted = own ? 0 : ++seq;
            await connection.ExecuteAsync(new CommandDefinition(
                "INSERT INTO visibility (user_id, entity_id, granted_seq) VALUES (@userId, @entityId, @granted)",
                new { userId, entityId, granted }, transaction, cancellationToken: cancellation));
            await connection.ExecuteAsync(new CommandDefinition(
                "DELETE FROM revocations WHERE user_id = @userId AND entity_id = @entityId",
                new { userId, entityId }, transaction, cancellationToken: cancellation));
        }
    }

    public async Task<ChangePage> ChangesAsync(string userId, long after, int limit, CancellationToken cancellation = default)
    {
        ArgumentOutOfRangeException.ThrowIfLessThan(limit, 1);
        await using var connection = await database.OpenAsync(cancellation);
        // Entities changed after the cursor, or granted to this user after it (feed position: the
        // later of the two), and revocations after it; merged in seq order.
        var position = database.Greatest("e.seq", "v.granted_seq");
        // Plain columns (a computed one has no type in SQLite); the feed position is the later one.
        var rows = (await connection.QueryAsync<FeedRow>(new CommandDefinition(
            $"""
            SELECT e.collection, e.id, e.owner_id AS ownerId, e.seq, v.granted_seq AS grantedSeq, {Prefixed("e")} AS doc
            FROM entities e JOIN visibility v ON v.entity_id = e.id
            WHERE v.user_id = @userId AND (e.seq > @after OR v.granted_seq > @after)
            ORDER BY {position}
            LIMIT @take
            """,
            new { userId, after, take = limit + 1 },
            cancellationToken: cancellation))).Select(row =>
            {
                var at = Math.Max(row.Seq, row.GrantedSeq);
                return (Seq: at, Entity: (StoredEntity?)(new Row(row.Collection, row.Id, row.OwnerId, at, row.Doc).ToEntity()), Revoked: (string?)null);
            });
        var revoked = (await connection.QueryAsync<(string EntityId, long Seq)>(new CommandDefinition(
            "SELECT entity_id, seq FROM revocations WHERE user_id = @userId AND seq > @after ORDER BY seq LIMIT @take",
            new { userId, after, take = limit + 1 },
            cancellationToken: cancellation))).Select(row => (row.Seq, Entity: (StoredEntity?)null, Revoked: (string?)row.EntityId));
        var merged = rows.Concat(revoked).OrderBy(item => item.Seq).ToList();
        var page = merged.Take(limit).ToList();
        return new ChangePage(
            page.Where(item => item.Entity is not null).Select(item => item.Entity!).ToList(),
            page.Count > 0 ? page[^1].Seq : after,
            merged.Count > limit,
            page.Where(item => item.Revoked is not null).Select(item => item.Revoked!).ToList());
    }

    public async IAsyncEnumerable<StoredEntity> AllAsync([EnumeratorCancellation] CancellationToken cancellation = default)
    {
        await using var connection = await database.OpenAsync(cancellation);
        var rows = connection.QueryUnbufferedAsync<Row>(
            $"SELECT collection, id, owner_id AS ownerId, seq, {DocColumn} AS doc FROM entities ORDER BY seq");
        await foreach (var row in rows.WithCancellation(cancellation))
        {
            yield return row.ToEntity();
        }
    }

    public async IAsyncEnumerable<(string UserId, string EntityId)> VisibilityAsync(
        [EnumeratorCancellation] CancellationToken cancellation = default)
    {
        await using var connection = await database.OpenAsync(cancellation);
        var rows = connection.QueryUnbufferedAsync<(string, string)>(
            "SELECT user_id, entity_id FROM visibility ORDER BY user_id, entity_id");
        // (Revocations are not exported: a restored server re-derives access and devices resync.)
        await foreach (var row in rows.WithCancellation(cancellation))
        {
            yield return row;
        }
    }

    public async Task RestoreAsync(
        IReadOnlyList<StoredEntity> entities,
        IReadOnlyList<(string UserId, string EntityId)> visibility,
        long cursor,
        CancellationToken cancellation = default)
    {
        await using var connection = await database.OpenAsync(cancellation);
        await using var transaction = await database.BeginWriteAsync(connection, cancellation);
        if (await connection.ExecuteScalarAsync<long>(new CommandDefinition(
                "SELECT COUNT(*) FROM entities", transaction: transaction, cancellationToken: cancellation)) > 0)
        {
            throw new InvalidOperationException("the database already holds entities");
        }
        foreach (var entity in entities)
        {
            await connection.ExecuteAsync(new CommandDefinition(
                $"""
                INSERT INTO entities (id, collection, owner_id, seq, hlc, deleted, doc)
                VALUES (@id, @collection, @owner, @seq, @hlc, @deleted, {database.DocParameter})
                """,
                new
                {
                    id = entity.Id,
                    collection = entity.Collection,
                    owner = entity.OwnerId,
                    seq = entity.Seq,
                    hlc = LatestHlc(entity.Doc),
                    deleted = entity.Doc["deletedAt"] is not null,
                    doc = entity.Doc.ToJsonString(Json),
                },
                transaction,
                cancellationToken: cancellation));
        }
        foreach (var (userId, entityId) in visibility)
        {
            await connection.ExecuteAsync(new CommandDefinition(
                "INSERT INTO visibility (user_id, entity_id) VALUES (@userId, @entityId)",
                new { userId, entityId },
                transaction,
                cancellationToken: cancellation));
        }
        await connection.ExecuteAsync(new CommandDefinition(
            "UPDATE counters SET value = @cursor WHERE name = 'seq'", new { cursor }, transaction, cancellationToken: cancellation));
        await transaction.CommitAsync(cancellation);
    }

    private string Prefixed(string alias) => DocColumn.Replace("doc", $"{alias}.doc", StringComparison.Ordinal);

    /// <summary>The newest HLC among the entity's fields (kept in a column for inspection).</summary>
    private static string LatestHlc(JsonObject doc)
    {
        var latest = "";
        if (doc["_hlc"] is JsonObject clocks)
        {
            foreach (var (_, value) in clocks)
            {
                var hlc = (string?)value ?? "";
                if (string.CompareOrdinal(hlc, latest) > 0) latest = hlc;
            }
        }
        return latest;
    }

    private sealed record FeedRow(string Collection, string Id, string OwnerId, long Seq, long GrantedSeq, string Doc);

    private sealed record Row(string Collection, string Id, string OwnerId, long Seq, string Doc)
    {
        public StoredEntity ToEntity() =>
            new(Collection, Id, OwnerId, Seq, JsonNode.Parse(Doc) as JsonObject
                ?? throw new InvalidDataException($"entity {Id} is not a JSON object"));
    }
}
