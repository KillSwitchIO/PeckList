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
            var owner = stored?.OwnerId ?? ownerId;
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
                    seq = excluded.seq, hlc = excluded.hlc, deleted = excluded.deleted, doc = excluded.doc
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
            await connection.ExecuteAsync(new CommandDefinition(
                "INSERT INTO visibility (user_id, entity_id) VALUES (@owner, @id) ON CONFLICT DO NOTHING",
                new { owner, id = entity.Id },
                transaction,
                cancellationToken: cancellation));
            result.Add(new StoredEntity(entity.Collection, entity.Id, owner, seq, doc));
        }
        await transaction.CommitAsync(cancellation);
        // Several writes to one id in a batch: report each id once, at its final state.
        return result.GroupBy(each => each.Id).Select(group => group.Last()).OrderBy(each => each.Seq).ToList();
    }

    public async Task<ChangePage> ChangesAsync(string userId, long after, int limit, CancellationToken cancellation = default)
    {
        ArgumentOutOfRangeException.ThrowIfLessThan(limit, 1);
        await using var connection = await database.OpenAsync(cancellation);
        var rows = (await connection.QueryAsync<Row>(new CommandDefinition(
            $"""
            SELECT e.collection, e.id, e.owner_id AS ownerId, e.seq, {Prefixed("e")} AS doc
            FROM entities e JOIN visibility v ON v.entity_id = e.id
            WHERE v.user_id = @userId AND e.seq > @after
            ORDER BY e.seq
            LIMIT @take
            """,
            new { userId, after, take = limit + 1 },
            cancellationToken: cancellation))).ToList();
        var more = rows.Count > limit;
        var page = rows.Take(limit).Select(row => row.ToEntity()).ToList();
        return new ChangePage(page, page.Count > 0 ? page[^1].Seq : after, more);
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

    private sealed record Row(string Collection, string Id, string OwnerId, long Seq, string Doc)
    {
        public StoredEntity ToEntity() =>
            new(Collection, Id, OwnerId, Seq, JsonNode.Parse(Doc) as JsonObject
                ?? throw new InvalidDataException($"entity {Id} is not a JSON object"));
    }
}
