using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Punchlist.Core.Storage;

namespace Punchlist.Core.Sync;

/// <summary>One entity on the wire: which collection it belongs to and its JSON.</summary>
public sealed record SyncEntity(string Collection, JsonObject Entity);

public sealed record SyncRequest(int SchemaVersion, long? Cursor, IReadOnlyList<SyncEntity>? Changes);

/// <param name="Cursor">Send it back next time.</param>
/// <param name="More">More changes wait: sync again straight away.</param>
/// <param name="Revoked">Ids the user lost access to; the client removes them (not a tombstone).</param>
public sealed record SyncResponse(long Cursor, IReadOnlyList<SyncEntity> Changes, bool More, IReadOnlyList<string> Revoked);

/// <summary>Why a sync was refused; <see cref="Code"/> is what the client switches on.</summary>
public sealed class SyncRejected(string code, string message, int? serverSchemaVersion = null) : Exception(message)
{
    public string Code { get; } = code;
    public int? ServerSchemaVersion { get; } = serverSchemaVersion;
}

/// <summary>
/// <c>/api/sync</c> (spec: Data Model &amp; Sync): merge what a client pushes into the store with the
/// same rules as the client, then hand back everything newer than its cursor that it may see.
/// </summary>
public sealed partial class SyncService(IEntityStore store, TimeProvider time)
{
    public const int MaxChanges = 5000;
    public const int PageSize = 500;

    /// <summary>A client clock further ahead than this would win every merge for days; refuse it.</summary>
    public static readonly TimeSpan MaxClockDrift = TimeSpan.FromHours(24);

    [GeneratedRegex("^[0-9A-Za-z_-]{1,64}$")]
    private static partial Regex IdPattern();

    public async Task<SyncResponse> SyncAsync(string userId, SyncRequest request, CancellationToken cancellation = default)
    {
        if (request.SchemaVersion != WorkspaceSchema.CurrentVersion)
        {
            throw new SyncRejected("schema_mismatch",
                $"this server speaks schema {WorkspaceSchema.CurrentVersion}, the client {request.SchemaVersion}",
                WorkspaceSchema.CurrentVersion);
        }
        var changes = request.Changes ?? [];
        if (changes.Count > MaxChanges) throw new SyncRejected("too_many_changes", $"send at most {MaxChanges} changes at a time");
        var incoming = changes.Select(Validate).ToList();

        if (incoming.Count > 0)
        {
            await store.WriteAsync(userId, incoming, (stored, arrived) => Resolve(userId, stored, arrived), cancellation);
        }
        var page = await store.ChangesAsync(userId, Math.Max(request.Cursor ?? 0, 0), PageSize, cancellation);
        return new SyncResponse(
            page.Cursor,
            page.Entities.Select(each => new SyncEntity(each.Collection, each.Doc)).ToList(),
            page.More,
            []);
    }

    /// <summary>What to store for one pushed entity, or null to leave things as they are.</summary>
    private static JsonObject? Resolve(string userId, StoredEntity? stored, IncomingEntity arrived)
    {
        if (stored is null) return arrived.Doc;
        // Someone else's entity, or an id reused in another collection: not this user's to change
        // (until sharing, 0.5). Silently skipped: saying so would reveal that the id exists.
        if (stored.OwnerId != userId || stored.Collection != arrived.Collection) return null;
        var merged = Merge.Entity(stored.Doc, arrived.Doc, WorkspaceSchema.ElementSetFields(arrived.Collection));
        // Nothing new: keep the seq, so the change feed does not grow on every sync.
        return JsonNode.DeepEquals(merged, stored.Doc) ? null : merged;
    }

    private IncomingEntity Validate(SyncEntity change, int index)
    {
        string Where() => $"changes[{index}]";
        if (!WorkspaceSchema.Collections.Contains(change.Collection))
        {
            throw new SyncRejected("invalid_change", $"{Where()}: unknown collection '{change.Collection}'");
        }
        var entity = change.Entity ?? throw new SyncRejected("invalid_change", $"{Where()}: no entity");
        if (entity["id"] is not JsonValue idValue || !idValue.TryGetValue<string>(out var id) || !IdPattern().IsMatch(id))
        {
            throw new SyncRejected("invalid_change", $"{Where()}: missing or malformed id");
        }
        if (entity["_hlc"] is not JsonObject clocks)
        {
            throw new SyncRejected("invalid_change", $"{Where()} ({id}): missing _hlc");
        }
        var latest = time.GetUtcNow() + MaxClockDrift;
        void Check(JsonNode? value, string field)
        {
            var hlc = value is JsonValue v && v.TryGetValue<string>(out var text) ? text : null;
            if (!Hlc.IsValid(hlc)) throw new SyncRejected("invalid_change", $"{Where()} ({id}): bad clock for {field}");
            if (Hlc.WallTime(hlc!) > latest)
            {
                throw new SyncRejected("clock_drift", $"{Where()} ({id}): {field} is stamped {hlc}, more than a day ahead of the server");
            }
        }
        foreach (var (field, value) in clocks) Check(value, field);
        foreach (var field in WorkspaceSchema.ElementSetFields(change.Collection))
        {
            if (entity[field] is null) continue;
            if (entity[field] is not JsonObject set) throw new SyncRejected("invalid_change", $"{Where()} ({id}): {field} is not a set");
            foreach (var (element, state) in set)
            {
                if (state is not JsonObject { } item || item["in"] is not JsonValue) throw new SyncRejected("invalid_change", $"{Where()} ({id}): bad {field} element {element}");
                Check(item["hlc"], $"{field}.{element}");
            }
        }
        return new IncomingEntity(change.Collection, entity);
    }
}
