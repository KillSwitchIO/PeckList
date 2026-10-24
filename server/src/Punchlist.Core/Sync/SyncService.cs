using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Punchlist.Core.Notifications;
using Punchlist.Core.Sharing;
using Punchlist.Core.Storage;

namespace Punchlist.Core.Sync;

/// <summary>One entity on the wire: which collection it belongs to and its JSON.</summary>
public sealed record SyncEntity(string Collection, JsonObject Entity);

public sealed record SyncRequest(int SchemaVersion, long? Cursor, IReadOnlyList<SyncEntity>? Changes);

/// <param name="Cursor">Send it back next time.</param>
/// <param name="More">More changes wait: sync again straight away.</param>
/// <param name="Revoked">Ids the user lost access to; the client removes them (not a tombstone).</param>
/// <param name="Rejected">
/// Pushed changes the user may not make. The client takes the server's copy from
/// <paramref name="Corrections"/> instead of its own, or drops the entity when there is none.
/// </param>
public sealed record SyncResponse(
    long Cursor,
    IReadOnlyList<SyncEntity> Changes,
    bool More,
    IReadOnlyList<string> Revoked,
    IReadOnlyList<string> Rejected,
    IReadOnlyList<SyncEntity> Corrections,
    string? Epoch = null);

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
public sealed partial class SyncService(
    IEntityStore store,
    TimeProvider time,
    IChangeNotifier notifier,
    SharingState sharing,
    ISharingChangeSink? sharingChanges = null,
    INotificationSink? notifications = null,
    ServerClock? clock = null)
{
    public const int MaxChanges = 5000;
    public const int PageSize = 500;

    /// <summary>A client clock further ahead than this would win every merge for days; refuse it.</summary>
    public static readonly TimeSpan MaxClockDrift = TimeSpan.FromHours(24);

    [GeneratedRegex("^[0-9A-Za-z_-]{1,64}$")]
    private static partial Regex IdPattern();

    /// <param name="source">The pushing device, passed on to the user's other devices' change events.</param>
    public async Task<SyncResponse> SyncAsync(string userId, SyncRequest request, string? source = null, CancellationToken cancellation = default)
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

        var rejected = new List<string>();
        var corrections = new List<SyncEntity>();
        var shared = new List<SharingChange>();
        var notable = new List<NotableChange>();
        if (incoming.Count > 0)
        {
            await sharing.Gate.WaitAsync(cancellation);
            try
            {
                var before = sharing.Index;
                var after = before.Clone();
                var written = await store.WriteAsync(
                    userId,
                    incoming,
                    (stored, arrived) =>
                    {
                        var merged = Resolve(userId, stored, arrived, before, after, rejected);
                        if (merged is not null && SharingChanges.Watched(arrived.Collection))
                        {
                            shared.Add(new SharingChange(arrived.Collection, arrived.Id, stored?.Doc, merged));
                        }
                        if (merged is not null && NotificationRules.Watched(arrived.Collection))
                        {
                            notable.Add(new NotableChange(arrived.Collection, arrived.Id, stored?.Doc, merged));
                        }
                        return merged;
                    },
                    plan: entities => SharingState.Plan(before, after, entities),
                    cancellation: cancellation);
                sharing.Index = after;
                foreach (var id in rejected.Distinct())
                {
                    if (after.Viewers(id).Contains(userId) && await store.GetAsync(id, cancellation) is { } current)
                    {
                        corrections.Add(new SyncEntity(current.Collection, current.Doc));
                    }
                }
                if (written.Count > 0)
                {
                    // Everyone who sees a written entity hears about it; their own devices too.
                    var seq = written[^1].Seq;
                    var people = written.SelectMany(entity => after.Viewers(entity.Id).Concat(before.Viewers(entity.Id)))
                        .Append(userId).ToHashSet(StringComparer.Ordinal);
                    foreach (var person in people) notifier.Notify(person, new ChangeEvent(seq, person == userId ? source : null));
                }
            }
            finally
            {
                sharing.Gate.Release();
            }
            if (shared.Count > 0 && sharingChanges is not null) await sharingChanges.ChangedAsync(userId, shared, cancellation);
            if (notable.Count > 0 && notifications is not null) await notifications.ChangedAsync(userId, notable, cancellation);
        }
        var page = await store.ChangesAsync(userId, Math.Max(request.Cursor ?? 0, 0), PageSize, cancellation);
        return new SyncResponse(
            page.Cursor,
            page.Entities.Select(each => new SyncEntity(each.Collection, each.Doc)).ToList(),
            page.More,
            page.Revoked,
            rejected.Distinct().ToList(),
            corrections);
    }

    /// <summary>
    /// Changes the server makes itself (a profile, a friendship accepted from a link): merged like
    /// any change, with no permission check, access updated and everyone concerned told.
    /// </summary>
    public async Task<IReadOnlyList<StoredEntity>> WriteAsServerAsync(
        string ownerId, IReadOnlyList<IncomingEntity> entities, CancellationToken cancellation = default)
    {
        await sharing.Gate.WaitAsync(cancellation);
        try
        {
            var before = sharing.Index;
            var after = before.Clone();
            var written = await store.WriteAsync(
                ownerId,
                entities,
                (stored, arrived) =>
                {
                    var setFields = WorkspaceSchema.ElementSetFields(arrived.Collection);
                    var merged = stored is null
                        ? arrived.Doc
                        : Merge.Entity(stored.Doc, Supersede(stored.Doc, arrived.Doc, setFields), setFields);
                    if (stored is not null && JsonNode.DeepEquals(merged, stored.Doc)) return null;
                    after.Apply(new StoredEntity(arrived.Collection, arrived.Id, arrived.Owner ?? stored?.OwnerId ?? ownerId, 0, merged));
                    return merged;
                },
                plan: written => SharingState.Plan(before, after, written),
                cancellation: cancellation);
            sharing.Index = after;
            if (written.Count > 0)
            {
                var seq = written[^1].Seq;
                foreach (var person in written.SelectMany(entity => after.Viewers(entity.Id)).ToHashSet(StringComparer.Ordinal))
                {
                    notifier.Notify(person, new ChangeEvent(seq, null));
                }
            }
            return written;
        }
        finally
        {
            sharing.Gate.Release();
        }
    }

    /// <summary>
    /// The server's own change made to win over what it is applied to: a field (or set element) it
    /// writes whose stored stamp is not older gets the stamp just after it. The server decided
    /// having seen the stored copy, so its change comes after it, as a hybrid clock would order it
    /// (stamps stored before a restart were never observed by <see cref="ServerClock"/>).
    /// </summary>
    internal static JsonObject Supersede(JsonObject stored, JsonObject arrived, IReadOnlyCollection<string> setFields)
    {
        var result = (JsonObject)arrived.DeepClone();
        if (result["_hlc"] is JsonObject clocks && stored["_hlc"] is JsonObject old)
        {
            foreach (var (field, value) in clocks.ToList())
            {
                var mine = (string?)value;
                var theirs = (string?)old[field];
                if (Hlc.IsValid(mine) && Hlc.IsValid(theirs) && Hlc.Compare(mine, theirs) <= 0)
                {
                    clocks[field] = Hlc.After(theirs!, ServerClock.Node);
                }
            }
        }
        foreach (var field in setFields)
        {
            if (result[field] is not JsonObject set || stored[field] is not JsonObject oldSet) continue;
            foreach (var (element, state) in set.ToList())
            {
                if (state is not JsonObject item || oldSet[element] is not JsonObject oldItem) continue;
                var mine = (string?)item["hlc"];
                var theirs = (string?)oldItem["hlc"];
                if (Hlc.IsValid(mine) && Hlc.IsValid(theirs) && Hlc.Compare(mine, theirs) <= 0)
                {
                    item["hlc"] = Hlc.After(theirs!, ServerClock.Node);
                }
            }
        }
        return result;
    }

    /// <summary>
    /// What to store for one pushed entity, or null to leave things as they are. The change is tried
    /// on <paramref name="after"/> (so later entities in the same push see it, e.g. tasks in a list
    /// made in the same push); a change the user may not make is undone there and reported.
    /// </summary>
    private static JsonObject? Resolve(
        string userId, StoredEntity? stored, IncomingEntity arrived, SharingIndex before, SharingIndex after, List<string> rejected)
    {
        if (stored is not null && stored.Collection != arrived.Collection)
        {
            rejected.Add(arrived.Id);
            return null;
        }
        var merged = stored is null
            ? arrived.Doc
            : Merge.Entity(stored.Doc, arrived.Doc, WorkspaceSchema.ElementSetFields(arrived.Collection));
        // Nothing new: keep the seq, so the change feed does not grow on every sync.
        if (stored is not null && JsonNode.DeepEquals(merged, stored.Doc)) return null;

        var candidate = new StoredEntity(arrived.Collection, arrived.Id, stored?.OwnerId ?? userId, 0, merged);
        after.Apply(candidate);
        if (after.MayWrite(userId, stored, candidate, before)) return merged;
        if (stored is null) after.Remove(arrived.Id);
        else after.Apply(stored);
        rejected.Add(arrived.Id);
        return null;
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
            // The server's own later changes must sort after what devices send, however fast their clocks.
            clock?.Observe(hlc);
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
