using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using PeckList.Core.Notifications;
using PeckList.Core.Sharing;
using PeckList.Core.Storage;

namespace PeckList.Core.Sync;

/// <summary>One entity on the wire: which collection it belongs to and its JSON.</summary>
public sealed record SyncEntity(string Collection, JsonObject Entity);

/// <param name="Epoch">
/// The life of the server's data the device last saw (audit C6). When the data has been restored
/// since, the server writes none of the device's changes and answers with the new epoch, so the
/// device starts over first. Older apps send none: they are taken as before.
/// </param>
/// <param name="Zone">
/// The device's own time zone, sent when it changed since the device last said (Device Time Zone
/// Design). The server keeps the latest per person, for what it works out for them when they picked
/// no zone and TZ is not set. Older apps send none.
/// </param>
public sealed record SyncRequest(int SchemaVersion, long? Cursor, IReadOnlyList<SyncEntity>? Changes, string? Epoch = null, string? Zone = null);

/// <param name="Cursor">Send it back next time.</param>
/// <param name="More">More changes wait: sync again straight away.</param>
/// <param name="Revoked">Ids the user lost access to; the client removes them (not a tombstone).</param>
/// <param name="Rejected">
/// Pushed changes the user may not make. The client takes the server's copy from
/// <paramref name="Corrections"/> instead of its own, or drops the entity when there is none.
/// </param>
/// <param name="Invalid">
/// Pushed changes the server could not take as they are (malformed, or stamped too far ahead of its
/// clock). Nothing of them was stored; the rest of the push was. The client keeps its copy and stops
/// sending it until it changes again.
/// </param>
/// <param name="ServerTime">The server's time, so a device can tell when its own clock is off.</param>
public sealed record SyncResponse(
    long Cursor,
    IReadOnlyList<SyncEntity> Changes,
    bool More,
    IReadOnlyList<string> Revoked,
    IReadOnlyList<string> Rejected,
    IReadOnlyList<SyncEntity> Corrections,
    string? Epoch = null,
    IReadOnlyList<SyncInvalid>? Invalid = null,
    string? ServerTime = null);

/// <summary>
/// One pushed change the server set aside: where it was in the push, its id when it has one, and
/// why (<c>invalid_change</c> or <c>clock_drift</c>, the codes a whole request used to fail with).
/// </summary>
public sealed record SyncInvalid(int Index, string? Id, string Code, string Reason);

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
    ServerClock? clock = null,
    History.ITaskHistorySink? history = null,
    IEntityValidator? entities = null)
{
    public const int MaxChanges = 5000;
    // About 3.8 MB of JSON at a real workspace's ~2 KB a task, ~0.4 MB compressed: a first sync of
    // 4,500 tasks is 3 round trips instead of 9 (R-FB-94).
    public const int PageSize = 2000;

    /// <summary>A change stamped further ahead than this would win every merge for hours; set it aside.</summary>
    public static readonly TimeSpan MaxClockDrift = TimeSpan.FromHours(1);

    [GeneratedRegex("^[0-9A-Za-z_-]{1,64}$")]
    private static partial Regex IdPattern();

    /// <param name="source">The pushing device, passed on to the user's other devices' change events.</param>
    public async Task<SyncResponse> SyncAsync(string userId, SyncRequest request, string? source = null, CancellationToken cancellation = default)
    {
        // Nothing reads or writes sharing before the index has loaded (the server listens meanwhile).
        await sharing.Loaded.WaitAsync(cancellation);
        if (request.SchemaVersion != WorkspaceSchema.CurrentVersion)
        {
            throw new SyncRejected("schema_mismatch",
                $"this server speaks schema {WorkspaceSchema.CurrentVersion}, the client {request.SchemaVersion}",
                WorkspaceSchema.CurrentVersion);
        }
        var changes = request.Changes ?? [];
        if (changes.Count > MaxChanges) throw new SyncRejected("too_many_changes", $"send at most {MaxChanges} changes at a time");
        // Each change on its own: one bad change must not hold back the rest of the push (or every
        // push after it, as the device sends the same batch again).
        var invalid = new List<SyncInvalid>();
        var incoming = new List<IncomingEntity>();
        for (var index = 0; index < changes.Count; index++)
        {
            try
            {
                incoming.Add(Validate(changes[index], index));
            }
            catch (SyncRejected error)
            {
                invalid.Add(new SyncInvalid(index, IdOf(changes[index]), error.Code, error.Message));
            }
        }

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
                        var merged = Resolve(userId, stored, arrived, before, after, rejected, time.GetUtcNow());
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
            // Each task's history (R-FB-105).
            if (history is not null && notable.Any(change => change.Collection == "tasks"))
            {
                await history.ChangedAsync(userId, [.. notable.Where(change => change.Collection == "tasks")], cancellation);
            }
        }
        var page = await store.ChangesAsync(userId, Math.Max(request.Cursor ?? 0, 0), PageSize, cancellation);
        return new SyncResponse(
            page.Cursor,
            page.Entities.Select(each => new SyncEntity(each.Collection, each.Doc)).ToList(),
            page.More,
            page.Revoked,
            rejected.Distinct().ToList(),
            corrections,
            Invalid: invalid,
            ServerTime: clock?.Now() ?? time.GetUtcNow().UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", System.Globalization.CultureInfo.InvariantCulture));
    }

    /// <summary>
    /// PostgreSQL cannot store a NUL character in text (M6). It is taken out of every value it is in,
    /// and each field it was taken from is stamped just after the device's own stamp: the stripped
    /// text then wins on every device, the sending one included, instead of that device keeping its
    /// own copy at the same clock, while an edit stamped after the device's still wins over it.
    /// </summary>
    private void StripNul(JsonObject entity, JsonObject clocks)
    {
        foreach (var (field, value) in entity.ToList())
        {
            if (field is "id" or "_hlc" || !HoldsNul(value)) continue;
            entity[field] = Stripped(value);
            if (clocks[field] is JsonValue stamp && stamp.TryGetValue<string>(out var old)) clocks[field] = Hlc.After(old, ServerClock.Node);
        }
    }

    private static bool HoldsNul(JsonNode? node) => node switch
    {
        JsonObject map => map.Any(each => HoldsNul(each.Value)),
        JsonArray list => list.Any(HoldsNul),
        JsonValue value => value.TryGetValue<string>(out var text) && text.Contains('\0'),
        _ => false,
    };

    private static bool NamesHoldNul(JsonNode? node) => node switch
    {
        JsonObject map => map.Any(each => each.Key.Contains('\0') || NamesHoldNul(each.Value)),
        JsonArray list => list.Any(NamesHoldNul),
        _ => false,
    };

    private static JsonNode? Stripped(JsonNode? node) => node switch
    {
        JsonObject map => new JsonObject(map.Select(each => KeyValuePair.Create(each.Key, Stripped(each.Value)))),
        JsonArray list => new JsonArray([.. list.Select(Stripped)]),
        JsonValue value when value.TryGetValue<string>(out var text) => JsonValue.Create(text.Replace("\0", "")),
        _ => node?.DeepClone(),
    };

    private static string? IdOf(SyncEntity change) =>
        change.Entity?["id"] is JsonValue value && value.TryGetValue<string>(out var id) ? id : null;

    /// <summary>
    /// Changes the server makes itself (a profile, a friendship accepted from a link): merged like
    /// any change, with no permission check, access updated and everyone concerned told.
    /// </summary>
    public async Task<IReadOnlyList<StoredEntity>> WriteAsServerAsync(
        string ownerId, IReadOnlyList<IncomingEntity> entities, CancellationToken cancellation = default)
    {
        await sharing.Loaded.WaitAsync(cancellation);
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
    /// A removal of access beats a stamp from the future (audit U4). Devices may stamp up to an hour
    /// ahead of the server, so a planted stamp could outlast an honest removal made at the true time:
    /// an assignment taken off a task, or a friendship, list or group membership ended. When the
    /// stored stamp it would lose to is ahead of the server's clock, the removal gets the stamp just
    /// after it. Anything else merges by its stamps as before, and the change must still be allowed.
    /// </summary>
    internal static JsonObject RemovalsWin(string collection, JsonObject stored, JsonObject arrived, DateTimeOffset now)
    {
        JsonObject? result = null;
        static bool? In(JsonObject item) => item["in"] is JsonValue value && value.TryGetValue<bool>(out var included) ? included : null;
        bool Planted(string? mine, string? theirs) =>
            Hlc.IsValid(mine) && Hlc.IsValid(theirs) && Hlc.WallTime(theirs!) > now && Hlc.Compare(mine, theirs) <= 0;
        if (collection == "tasks" && arrived["assignees"] is JsonObject set && stored["assignees"] is JsonObject oldSet)
        {
            foreach (var (element, state) in set)
            {
                if (state is not JsonObject item || In(item) != false) continue;
                if (oldSet[element] is not JsonObject oldItem || In(oldItem) != true) continue;
                var theirs = (string?)oldItem["hlc"];
                if (!Planted((string?)item["hlc"], theirs)) continue;
                result ??= (JsonObject)arrived.DeepClone();
                result["assignees"]![element]!["hlc"] = Hlc.After(theirs!, ServerClock.Node);
            }
        }
        if (collection is "friendships" or "listMembers" or "groupMembers"
            && arrived["deletedAt"] is JsonValue && stored["deletedAt"] is null
            && arrived["_hlc"] is JsonObject clocks && stored["_hlc"] is JsonObject oldClocks
            && Planted((string?)clocks["deletedAt"], (string?)oldClocks["deletedAt"]))
        {
            result ??= (JsonObject)arrived.DeepClone();
            result["_hlc"]!["deletedAt"] = Hlc.After((string)oldClocks["deletedAt"]!, ServerClock.Node);
        }
        return result ?? arrived;
    }

    /// <summary>
    /// What to store for one pushed entity, or null to leave things as they are. The change is tried
    /// on <paramref name="after"/> (so later entities in the same push see it, e.g. tasks in a list
    /// made in the same push); a change the user may not make is undone there and reported.
    /// </summary>
    private static JsonObject? Resolve(
        string userId, StoredEntity? stored, IncomingEntity arrived, SharingIndex before, SharingIndex after, List<string> rejected,
        DateTimeOffset now)
    {
        if (stored is not null && stored.Collection != arrived.Collection)
        {
            rejected.Add(arrived.Id);
            return null;
        }
        var merged = stored is null
            ? arrived.Doc
            : Merge.Entity(stored.Doc, RemovalsWin(arrived.Collection, stored.Doc, arrived.Doc, now), WorkspaceSchema.ElementSetFields(arrived.Collection));
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
                throw new SyncRejected("clock_drift", $"{Where()} ({id}): {field} is stamped {hlc}, more than an hour ahead of the server");
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
        // Text that is not valid Unicode (half an emoji, cut in two by an import) cannot be stored:
        // this change alone is refused, not the whole push (R-FB-94).
        try
        {
            entity.ToJsonString();
        }
        catch (InvalidOperationException)
        {
            throw new SyncRejected("invalid_text", $"{Where()} ({id}): text that is not valid Unicode");
        }
        if (NamesHoldNul(entity)) throw new SyncRejected("invalid_text", $"{Where()} ({id}): a name with a NUL character");
        // A set keeps its stamps in each element, so a stripped element could not be restamped.
        if (WorkspaceSchema.ElementSetFields(change.Collection).Any(field => HoldsNul(entity[field])))
        {
            throw new SyncRejected("invalid_text", $"{Where()} ({id}): a set holding a NUL character");
        }
        StripNul(entity, clocks);
        // Its shape and size (audit S4): junk is refused here, not stored and synced to every viewer.
        if (entities?.Problem(change.Collection, entity) is { } problem)
        {
            throw new SyncRejected("invalid_change", $"{Where()} ({id}): {problem}");
        }
        return new IncomingEntity(change.Collection, entity);
    }
}
