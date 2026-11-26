using System.Globalization;
using System.Text.Json.Nodes;
using PeckList.Core.Api;
using PeckList.Core.Sharing;
using PeckList.Core.Storage;
using PeckList.Core.Sync;

namespace PeckList.Core.Calendars;

/// <summary>What one run of a link did, for logs and tests.</summary>
public sealed record CalendarRun(
    int EventsCreated = 0,
    int EventsUpdated = 0,
    int EventsDeleted = 0,
    int TasksCreated = 0,
    int TasksChanged = 0,
    int TasksTrashed = 0,
    int Conflicts = 0,
    int Refused = 0,
    bool Skipped = false,
    string? Problem = null);

/// <summary>
/// The two-way calendar sync (spec: PL-134). One run of a link reads the calendar's changes by sync
/// token and the person's task changes from the entity store's change feed, merges them field by field
/// (latest edit wins), and writes both sides: events with If-Match etags, tasks through the
/// <see cref="SyncService"/> as the person, so the server's permission rules hold for calendar edits too.
/// </summary>
/// <remarks>
/// <para>Each item keeps what both sides agreed on at the last run (its snapshot). A side whose mapped
/// value differs from it changed since; when both changed the same part, the later edit wins: the task
/// field's HLC time against the event's <see cref="RemoteEvent.UpdatedAt"/>. The parts are the title,
/// the notes, and the times with the repeat rule.</para>
/// <para>Completing a task hides it in PeckList and never touches the calendar (decision 1); a repeating
/// task that moves on to the next occurrence of its series leaves the series alone. Deleting deletes
/// on the other side, and a task deleted from the calendar goes to Trash. Every event PeckList writes
/// carries an <see cref="EventMarker"/>, so a link made again pairs its events with their tasks.</para>
/// <para>Runs of one person never overlap; the caller (the background service) queues them.</para>
/// </remarks>
public sealed class CalendarSync(
    ICalendarStore calendars,
    IEnumerable<ICalendarProvider> providers,
    ICalendarSecrets secrets,
    IEntityStore entities,
    SyncService sync,
    SharingState sharing,
    ServerClock clock,
    CalendarInstance instance,
    TimeProvider time,
    Func<string, CancellationToken, Task<string>> zoneOf)
{
    /// <summary>The origin of tasks made from calendar events.</summary>
    public const string Origin = "calendar";

    /// <summary>The longest a failing link waits before its next try.</summary>
    public static readonly TimeSpan MaxBackoff = TimeSpan.FromHours(6);

    /// <summary>The problem recorded on a link whose run took longer than <see cref="RunDeadline"/>.</summary>
    public const string TimedOut = "calendar_timed_out";

    /// <summary>The problem recorded on a link whose run failed in a way no adapter meant (a bug, not the calendar's answer).</summary>
    public const string Failed = "calendar_failed";

    /// <summary>
    /// The longest one run of a link may take, all its calls together. Runs go one at a time on the
    /// server, so a calendar service that answers slowly, or never, must not hold up everyone else's.
    /// </summary>
    public TimeSpan RunDeadline { get; init; } = TimeSpan.FromMinutes(5);

    private readonly Dictionary<string, ICalendarProvider> byKind = providers.ToDictionary(each => each.Kind, StringComparer.Ordinal);

    // Fields, so the run (a nested class) reaches them; members shadow the parameters below.
    private readonly ICalendarStore calendars = calendars;
    private readonly ICalendarSecrets secrets = secrets;
    private readonly IEntityStore entities = entities;
    private readonly SyncService sync = sync;
    private readonly SharingState sharing = sharing;
    private readonly ServerClock clock = clock;
    private readonly CalendarInstance instance = instance;
    private readonly TimeProvider time = time;
    private readonly Func<string, CancellationToken, Task<string>> zoneOf = zoneOf;

    /// <summary>The provider for an account's kind, or null when this server has none.</summary>
    public ICalendarProvider? Provider(string kind) => byKind.GetValueOrDefault(kind);

    /// <summary>
    /// The connection for a stored account, its secret decrypted for the call. A refreshed secret the
    /// adapter hands back is stored encrypted.
    /// </summary>
    public async Task<CalendarConnection> ConnectionAsync(CalendarAccount account, CancellationToken cancellation)
    {
        var secret = await secrets.UnprotectAsync(account.Secret, cancellation);
        return new CalendarConnection(account.ServerUrl, account.Username, secret, async changed =>
        {
            if (await calendars.AccountAsync(account.Id, CancellationToken.None) is { } current)
            {
                await calendars.SaveAccountAsync(current with { Secret = await secrets.ProtectAsync(changed, CancellationToken.None) }, CancellationToken.None);
            }
        });
    }

    /// <summary>
    /// One run of a link, recording the outcome on it: on success its token, cursor and time; on a
    /// failure the problem, a longer wait, and for a refused sign-in the account stopped. A stale etag
    /// met on the way runs it once more, so the change that raced it is merged now. A run past
    /// <see cref="RunDeadline"/> is cancelled and recorded as <see cref="TimedOut"/>; any other
    /// exception is recorded as <see cref="Failed"/>, with the same backoff, and thrown on for the
    /// caller to log.
    /// </summary>
    public async Task<CalendarRun> SyncLinkAsync(string linkId, CancellationToken cancellation = default)
    {
        var link = await calendars.LinkAsync(linkId, cancellation);
        if (link is null || link.Mode == CalendarModes.Off) return new CalendarRun(Skipped: true);
        var account = await calendars.AccountAsync(link.CalendarAccountId, cancellation);
        if (account is null || account.Status == CalendarAccount.AuthFailed || Provider(account.Provider) is not { } provider)
        {
            return new CalendarRun(Skipped: true);
        }
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellation);
        deadline.CancelAfter(RunDeadline);
        try
        {
            var connection = await ConnectionAsync(account, deadline.Token);
            var run = await RunAsync(link, provider, connection, deadline.Token);
            if (run.Conflicts > 0 && await calendars.LinkAsync(linkId, deadline.Token) is { Mode: not CalendarModes.Off } again)
            {
                var second = await RunAsync(again, provider, connection, deadline.Token);
                run = Add(run, second) with { Conflicts = second.Conflicts };
            }
            if (await calendars.LinkAsync(linkId, cancellation) is { } done)
            {
                await calendars.SaveLinkAsync(done with { SyncedAt = time.GetUtcNow(), Problem = run.Problem, Failures = 0, NextAttempt = null }, cancellation);
            }
            if (account.Problem is not null) await calendars.SaveAccountAsync(account with { Status = CalendarAccount.Ok, Problem = null }, cancellation);
            return run;
        }
        catch (CalendarProblem problem)
        {
            if (problem.Kind == CalendarProblemKind.Auth)
            {
                await calendars.SaveAccountAsync(account with { Status = CalendarAccount.AuthFailed, Problem = problem.Code }, cancellation);
            }
            await FailedAsync(linkId, problem.Code, problem.RetryAfter, cancellation);
            return new CalendarRun(Problem: problem.Code);
        }
        catch (OperationCanceledException) when (!cancellation.IsCancellationRequested)
        {
            // The deadline, or a time limit inside the adapter: either way the calendar was too slow.
            await FailedAsync(linkId, TimedOut, null, cancellation);
            return new CalendarRun(Problem: TimedOut);
        }
        catch (Exception error) when (error is not OperationCanceledException)
        {
            // Not an answer the adapter meant: the link still waits before it is tried again, so a
            // calendar that trips a bug is not called every pass.
            await FailedAsync(linkId, Failed, null, cancellation);
            throw;
        }
    }

    /// <summary>Records a failed run on the link: the problem, one more failure, and the wait before the next try.</summary>
    private async Task FailedAsync(string linkId, string problem, TimeSpan? retryAfter, CancellationToken cancellation)
    {
        if (await calendars.LinkAsync(linkId, cancellation) is not { } failed) return;
        var failures = failed.Failures + 1;
        await calendars.SaveLinkAsync(failed with
        {
            Problem = problem,
            Failures = failures,
            NextAttempt = time.GetUtcNow() + Backoff(failures, retryAfter),
        }, cancellation);
    }

    /// <summary>How long a link waits after <paramref name="failures"/> failed runs in a row: doubling from a minute, at most <see cref="MaxBackoff"/>, never less than the service asked.</summary>
    public static TimeSpan Backoff(int failures, TimeSpan? retryAfter = null)
    {
        var doubling = TimeSpan.FromMinutes(Math.Pow(2, Math.Min(failures - 1, 12)));
        var wait = doubling < MaxBackoff ? doubling : MaxBackoff;
        return retryAfter is { } asked && asked > wait ? asked : wait;
    }

    private static CalendarRun Add(CalendarRun a, CalendarRun b) => new(
        a.EventsCreated + b.EventsCreated, a.EventsUpdated + b.EventsUpdated, a.EventsDeleted + b.EventsDeleted,
        a.TasksCreated + b.TasksCreated, a.TasksChanged + b.TasksChanged, a.TasksTrashed + b.TasksTrashed,
        a.Conflicts + b.Conflicts, a.Refused + b.Refused, false, b.Problem ?? a.Problem);

    private async Task<CalendarRun> RunAsync(CalendarLink link, ICalendarProvider provider, CalendarConnection connection, CancellationToken cancellation)
    {
        var changes = await ChangesAsync(provider, connection, link, cancellation);
        return link.Mode == CalendarModes.Sync
            ? await new Run(this, link, provider, connection, changes).GoAsync(cancellation)
            : await ShowAsync(link, provider, changes, cancellation);
    }

    /// <summary>The calendar's changes since the link's token; an expired token gets a full listing.</summary>
    private static async Task<RemoteChanges> ChangesAsync(ICalendarProvider provider, CalendarConnection connection, CalendarLink link, CancellationToken cancellation)
    {
        try
        {
            return await provider.ChangesAsync(connection, link.RemoteId, link.SyncToken, cancellation);
        }
        catch (CalendarProblem problem) when (problem.Kind == CalendarProblemKind.SyncTokenExpired && link.SyncToken is not null)
        {
            return await provider.ChangesAsync(connection, link.RemoteId, null, cancellation);
        }
    }

    /// <summary>Show mode: keep the calendar's events, hidden marks and all, for the events API.</summary>
    private async Task<CalendarRun> ShowAsync(CalendarLink link, ICalendarProvider provider, RemoteChanges changes, CancellationToken cancellation)
    {
        var items = (await calendars.ItemsAsync(link.Id, cancellation)).ToDictionary(each => each.EventId, StringComparer.Ordinal);
        var put = new List<CalendarItem>();
        var removed = new List<string>(changes.Deleted.Where(items.ContainsKey));
        var listed = new HashSet<string>(StringComparer.Ordinal);
        foreach (var remote in changes.Changed)
        {
            listed.Add(remote.Id);
            if (remote.Cancelled && remote.SeriesId is null)
            {
                if (items.ContainsKey(remote.Id)) removed.Add(remote.Id);
                continue;
            }
            put.Add(new CalendarItem(link.Id, remote.Id, null, remote.Etag, CalendarJson.Write(remote), CalendarJson.Write(remote.Data),
                items.GetValueOrDefault(remote.Id)?.HiddenJson, time.GetUtcNow()));
        }
        if (changes.Reset) removed.AddRange(items.Keys.Where(id => !listed.Contains(id)));
        removed.AddRange(StaleOverrides(items.Values, changes, removed.ToHashSet(StringComparer.Ordinal), provider.Capabilities.SeriesListsOverrides));
        var gone = removed.ToHashSet(StringComparer.Ordinal);
        await calendars.SaveItemsAsync(link.Id, [.. put.Where(item => !gone.Contains(item.EventId))], [.. gone], cancellation);
        await calendars.SaveLinkAsync(link with { SyncToken = changes.SyncToken }, cancellation);
        return new CalendarRun();
    }

    /// <summary>One sync-mode run of one link.</summary>
    private sealed class Run(CalendarSync engine, CalendarLink link, ICalendarProvider provider, CalendarConnection connection, RemoteChanges changes)
    {
        private readonly Dictionary<string, CalendarItem> items = new(StringComparer.Ordinal);
        private readonly Dictionary<string, CalendarItem> byTask = new(StringComparer.Ordinal);
        private readonly Dictionary<string, CalendarItem> put = new(StringComparer.Ordinal);
        private readonly HashSet<string> removed = new(StringComparer.Ordinal);
        private readonly HashSet<string> handled = new(StringComparer.Ordinal);
        private readonly Dictionary<string, JsonObject?> docs = new(StringComparer.Ordinal);
        private readonly HashSet<string> revoked = new(StringComparer.Ordinal);
        private readonly HashSet<string> missing = new(StringComparer.Ordinal);
        private readonly List<JsonObject> taskWrites = [];
        private string tag = "";
        private string owner = "";
        private string zone = "UTC";
        private EventMarker? markerBase;
        private string? landingList;
        private string? lastOrder;
        private int created, updated, deleted, tasksCreated, tasksChanged, tasksTrashed, conflicts, refused;

        public async Task<CalendarRun> GoAsync(CancellationToken cancellation)
        {
            owner = link.AccountId;
            tag = link.TagId ?? throw new InvalidOperationException("a synced calendar needs a tag");
            await engine.sharing.Loaded.WaitAsync(cancellation);
            if (engine.sharing.Index.LiveDocOf(tag, "tags") is null || !engine.sharing.Index.Viewers(tag).Contains(owner))
            {
                // The tag is gone: nothing can sync until the person picks another.
                return new CalendarRun(Problem: "unknown_tag");
            }
            zone = await engine.zoneOf(owner, cancellation);
            markerBase = new EventMarker(await engine.instance.GetAsync(cancellation), "");
            foreach (var item in await engine.calendars.ItemsAsync(link.Id, cancellation))
            {
                items[item.EventId] = item;
                if (item.TaskId is not null) byTask[item.TaskId] = item;
            }
            var cursor = await ReadTaskChangesAsync(cancellation);
            await LoadDocsAsync(cancellation);

            // The calendar's side first, so a task re-paired by its marker is not sent again as new.
            var remoteDeleted = new HashSet<string>(changes.Deleted, StringComparer.Ordinal);
            foreach (var remote in changes.Changed.Where(each => each.Cancelled && each.SeriesId is null)) remoteDeleted.Add(remote.Id);
            if (changes.Reset)
            {
                var listed = changes.Changed.Select(each => each.Id).ToHashSet(StringComparer.Ordinal);
                foreach (var id in items.Keys.Where(id => !listed.Contains(id))) remoteDeleted.Add(id);
            }
            foreach (var id in remoteDeleted) RemoteDeleted(id);
            foreach (var remote in changes.Changed.Where(each => !remoteDeleted.Contains(each.Id))) await RemoteChangedAsync(remote, cancellation);
            foreach (var id in StaleOverrides(items.Values, changes, remoteDeleted, provider.Capabilities.SeriesListsOverrides).ToList())
            {
                removed.Add(id);
                put.Remove(id);
            }

            // Then the tasks that changed.
            foreach (var (id, _) in docs.Where(each => !handled.Contains(each.Key)).ToList()) await TaskChangedAsync(id, cancellation);

            await WriteTasksAsync(cancellation);
            await engine.calendars.SaveItemsAsync(link.Id, [.. put.Values], [.. removed.Where(id => !put.ContainsKey(id))], cancellation);
            await engine.calendars.SaveLinkAsync(link with { SyncToken = changes.SyncToken, TaskCursor = cursor }, cancellation);
            return new CalendarRun(created, updated, deleted, tasksCreated, tasksChanged, tasksTrashed, conflicts, refused);
        }

        /// <summary>The person's task changes since the link's cursor: the latest copy of each, and ids they lost sight of.</summary>
        private async Task<long> ReadTaskChangesAsync(CancellationToken cancellation)
        {
            var cursor = link.TaskCursor;
            while (true)
            {
                var page = await engine.entities.ChangesAsync(owner, cursor, SyncService.PageSize, cancellation);
                foreach (var entity in page.Entities.Where(each => each.Collection == "tasks"))
                {
                    docs[entity.Id] = entity.Doc;
                    revoked.Remove(entity.Id);
                }
                foreach (var id in page.Revoked)
                {
                    revoked.Add(id);
                    docs[id] = null;
                }
                cursor = page.Cursor;
                if (!page.More) return cursor;
            }
        }

        /// <summary>The tasks the calendar's changes touch that the feed did not bring.</summary>
        private async Task LoadDocsAsync(CancellationToken cancellation)
        {
            var wanted = new HashSet<string>(StringComparer.Ordinal);
            foreach (var remote in changes.Changed)
            {
                if (items.GetValueOrDefault(remote.Id)?.TaskId is { } paired) wanted.Add(paired);
                if (Ours(remote.Data.Marker) is { } marked) wanted.Add(marked);
            }
            foreach (var id in changes.Deleted) if (items.GetValueOrDefault(id)?.TaskId is { } paired) wanted.Add(paired);
            if (changes.Reset) foreach (var item in items.Values) if (item.TaskId is not null) wanted.Add(item.TaskId);
            wanted.ExceptWith(docs.Keys);
            if (wanted.Count == 0) return;
            var found = (await engine.entities.GetManyAsync(wanted, cancellation)).ToDictionary(each => each.Id, StringComparer.Ordinal);
            foreach (var id in wanted)
            {
                // Loaded, not changed: kept out of the task pass unless something else touches it.
                docs[id] = Seen(id, found.GetValueOrDefault(id));
                handled.Add(id);
            }
        }

        /// <summary>The task id of a marker this server wrote, or null.</summary>
        private string? Ours(EventMarker? marker) => marker is { } found && found.Instance == markerBase!.Instance ? found.TaskId : null;

        private EventMarker MarkerFor(string taskId) => markerBase! with { TaskId = taskId };

        private bool Live(JsonObject? doc) => doc is not null && doc["deletedAt"] is null;

        private bool Tagged(JsonObject doc) => doc["tags"] is JsonObject set && set[tag] is JsonObject element && (bool?)element["in"] == true;

        /// <summary>Whether a task belongs on this calendar now: live, visible, tagged, dated.</summary>
        private bool InScope(string id, JsonObject? doc) =>
            Live(doc) && !revoked.Contains(id) && Tagged(doc!) && CalendarMapping.EventOf(doc!, MarkerFor(id), zone) is not null;

        private void RemoteDeleted(string eventId)
        {
            if (!items.TryGetValue(eventId, out var item)) return;
            removed.Add(eventId);
            if (item.TaskId is not { } taskId) return;
            handled.Add(taskId);
            byTask.Remove(taskId);
            if (docs.GetValueOrDefault(taskId) is { } doc && Live(doc) && !revoked.Contains(taskId))
            {
                // Deleted on the calendar: to Trash, where it can be restored (spec: Deleting).
                taskWrites.Add(engine.Changed(doc, new JsonObject { ["deletedAt"] = engine.clock.Now() }));
                tasksTrashed++;
            }
        }

        private async Task RemoteChangedAsync(RemoteEvent remote, CancellationToken cancellation)
        {
            if (items.TryGetValue(remote.Id, out var item))
            {
                if (item.TaskId is { } taskId)
                {
                    handled.Add(taskId);
                    var doc = docs.GetValueOrDefault(taskId) ?? await LoadAsync(taskId, cancellation);
                    if (InScope(taskId, doc)) await MergeAsync(taskId, doc!, remote, CalendarJson.ReadData(item.SnapshotJson), cancellation);
                    else if (missing.Contains(taskId))
                    {
                        // Its task never landed (refused) or is not here: the pair goes, the person's event stays.
                        byTask.Remove(taskId);
                        Keep(remote, null, remote.Data);
                    }
                    else await DeleteEventAsync(remote.Id, remote.Etag, taskId, cancellation);
                }
                else
                {
                    Keep(remote, null, remote.Data);
                }
                return;
            }
            if (remote.SeriesId is not null)
            {
                // One occurrence moved on the calendar: kept, not mapped this batch (Q2).
                Keep(remote, null, remote.Data);
                return;
            }
            if (Ours(remote.Data.Marker) is { } marked)
            {
                if (byTask.ContainsKey(marked))
                {
                    // A second event for a task already paired (a copy): the pair stands, the copy stays the calendar's.
                    Keep(remote, null, remote.Data);
                    return;
                }
                handled.Add(marked);
                var doc = docs.GetValueOrDefault(marked) ?? await LoadAsync(marked, cancellation);
                if (InScope(marked, doc))
                {
                    // PeckList's own event, from before a restore or a reconnect: paired again, no copy made.
                    await MergeAsync(marked, doc!, remote, null, cancellation);
                    return;
                }
                if (doc is not null)
                {
                    // Its task was deleted, untagged or undated meanwhile: the event goes as it would have.
                    await DeleteEventAsync(remote.Id, remote.Etag, null, cancellation);
                    return;
                }
                // Its task is not here at all (an older backup): made again below, like any new event.
            }
            else if (remote.Data.Marker is not null)
            {
                // Another PeckList server's event (a test copy beside the real one): left to that server.
                Keep(remote, null, remote.Data);
                return;
            }
            await TaskFromEventAsync(remote, cancellation);
        }

        private async Task<JsonObject?> LoadAsync(string taskId, CancellationToken cancellation)
        {
            var doc = Seen(taskId, await engine.entities.GetAsync(taskId, cancellation));
            docs[taskId] = doc;
            return doc;
        }

        /// <summary>
        /// A task as this person may see it. One they cannot see counts as lost sight of (its event
        /// goes); one that is not there at all is noted as missing, which is no proof it was deleted.
        /// </summary>
        private JsonObject? Seen(string id, StoredEntity? entity)
        {
            if (entity is not { Collection: "tasks" })
            {
                missing.Add(id);
                return null;
            }
            if (!engine.sharing.Index.Viewers(id).Contains(owner))
            {
                revoked.Add(id);
                return null;
            }
            return entity.Doc;
        }

        private async Task TaskChangedAsync(string taskId, CancellationToken cancellation)
        {
            handled.Add(taskId);
            var doc = docs[taskId];
            if (byTask.TryGetValue(taskId, out var item))
            {
                var stored = CalendarJson.ReadEvent(item.EventJson);
                if (InScope(taskId, doc)) await MergeAsync(taskId, doc!, stored, CalendarJson.ReadData(item.SnapshotJson), cancellation);
                else await DeleteEventAsync(item.EventId, item.Etag, taskId, cancellation);
                return;
            }
            if (!InScope(taskId, doc)) return;
            var data = CalendarMapping.EventOf(doc!, MarkerFor(taskId), zone)!;
            var made = await engine.Safely(() => provider.CreateEventAsync(connection, link.RemoteId, data, cancellation));
            if (made is null)
            {
                conflicts++;
                return;
            }
            created++;
            Keep(made, taskId, data);
        }

        /// <summary>
        /// Merge a paired task and event part by part. <paramref name="agreed"/> is the snapshot, or null
        /// for a pair just found by its marker (both sides then count as changed, and the later wins).
        /// </summary>
        private async Task MergeAsync(string taskId, JsonObject doc, RemoteEvent remote, EventData? agreed, CancellationToken cancellation)
        {
            var mine = CalendarMapping.EventOf(doc, MarkerFor(taskId), zone)!;
            var theirs = remote.Data;
            var taskAt = (Func<string[], DateTimeOffset>)(fields => engine.FieldTime(doc, fields));

            // A repeating task that moved on to its series' next occurrence was completed, not moved.
            var movedOn = agreed is { RRule: not null }
                && !CalendarJson.SameWhen(mine, agreed)
                && CalendarMapping.SameSeries(agreed.RRule, mine.RRule)
                && CalendarMapping.IsOccurrence(agreed, CalendarMapping.Day(mine.Start))
                && SameShape(mine, agreed);
            var taskWhen = (agreed is null || !CalendarJson.SameWhen(mine, agreed)) && !movedOn;
            var remoteWhen = agreed is null || !CalendarJson.SameWhen(theirs, agreed);

            var summary = Pick(mine.Summary, theirs.Summary, agreed?.Summary, () => taskAt(["title"]), remote.UpdatedAt);
            // Compared as a task holds them: a description longer than notes may be is not a change on our side.
            var description = Pick(mine.Description, Clip(theirs.Description), agreed is null ? null : Clip(agreed.Description), () => taskAt(["notes"]), remote.UpdatedAt);
            Side when;
            if (CalendarJson.SameWhen(mine, theirs) || (!taskWhen && !remoteWhen)) when = Side.Same;
            else if (taskWhen && !remoteWhen) when = Side.Task;
            else if (remoteWhen && !taskWhen) when = Side.Calendar;
            else when = taskAt(["schedule", "due", "recurrence"]) > remote.UpdatedAt ? Side.Task : Side.Calendar;

            var merged = theirs with
            {
                Summary = summary == Side.Task ? mine.Summary : theirs.Summary,
                Description = description == Side.Task ? mine.Description : theirs.Description,
                Marker = MarkerFor(taskId),
            };
            if (when == Side.Task) merged = merged with { Start = mine.Start, End = mine.End, RRule = mine.RRule, ExDates = mine.ExDates };

            var fields = new JsonObject();
            var incoming = CalendarMapping.TaskFieldsOf(theirs, zone);
            if (summary == Side.Calendar) fields["title"] = incoming["title"]?.DeepClone();
            if (description == Side.Calendar) fields["notes"] = incoming["notes"]?.DeepClone();
            if (when == Side.Calendar)
            {
                fields["schedule"] = incoming["schedule"]?.DeepClone();
                // The rule only when the calendar's rule differs: a task repeating from completion has
                // none on the calendar, and moving its event must not end its repeat.
                if (mine.RRule != theirs.RRule || !(mine.ExDates ?? []).SequenceEqual(theirs.ExDates ?? []))
                {
                    fields["recurrence"] = incoming["recurrence"]?.DeepClone();
                }
            }

            var written = remote;
            if (!CalendarJson.Same(merged, theirs))
            {
                var result = await engine.Safely(() => provider.UpdateEventAsync(connection, link.RemoteId, remote, merged, cancellation));
                if (result is null)
                {
                    // Changed again on the calendar since it was read: merged on the run that follows.
                    conflicts++;
                    return;
                }
                written = result;
                updated++;
            }
            if (fields.Count > 0)
            {
                taskWrites.Add(engine.Changed(doc, fields));
                tasksChanged++;
            }
            Keep(written, taskId, merged);
        }

        /// <summary>Same time of day, zone and length: only the day moved.</summary>
        private static bool SameShape(EventData a, EventData b) =>
            a.Start.Value[10..] == b.Start.Value[10..] && a.Start.TimeZone == b.Start.TimeZone && Length(a) == Length(b);

        private static TimeSpan? Length(EventData data) =>
            data.End is { } end ? Moment(end.Value) - Moment(data.Start.Value) : null;

        private static DateTime Moment(string value) => value.Length == 10
            ? DateTime.ParseExact(value, "yyyy-MM-dd", CultureInfo.InvariantCulture)
            : DateTime.ParseExact(value, ["yyyy-MM-dd'T'HH:mm", "yyyy-MM-dd'T'HH:mm:ss"], CultureInfo.InvariantCulture, DateTimeStyles.None);

        private static string Clip(string text) => text.Length > CalendarMapping.MaxNotes ? text[..CalendarMapping.MaxNotes] : text;

        private enum Side { Same, Task, Calendar }

        private static Side Pick(string mine, string theirs, string? agreed, Func<DateTimeOffset> taskAt, DateTimeOffset remoteAt)
        {
            if (mine == theirs) return Side.Same;
            var taskChanged = agreed is null || mine != agreed;
            var remoteChanged = agreed is null || theirs != agreed;
            if (taskChanged && !remoteChanged) return Side.Task;
            if (remoteChanged && !taskChanged) return Side.Calendar;
            return taskAt() > remoteAt ? Side.Task : Side.Calendar;
        }

        private async Task DeleteEventAsync(string eventId, string etag, string? taskId, CancellationToken cancellation)
        {
            var gone = await engine.Safely(async () =>
            {
                await provider.DeleteEventAsync(connection, link.RemoteId, eventId, etag, cancellation);
                return true;
            });
            if (!gone)
            {
                conflicts++;
                return;
            }
            deleted++;
            removed.Add(eventId);
            put.Remove(eventId);
            if (taskId is not null) byTask.Remove(taskId);
        }

        /// <summary>A new event on the calendar becomes a task with the link's tag, in the link's list.</summary>
        private async Task TaskFromEventAsync(RemoteEvent remote, CancellationToken cancellation)
        {
            var listId = await LandingListAsync(cancellation);
            if (listId is null)
            {
                Keep(remote, null, remote.Data);
                return;
            }
            var id = Ids.NewUlid(engine.time);
            lastOrder = OrderKeys.After(lastOrder);
            taskWrites.Add(engine.NewTask(id, owner, CalendarMapping.TaskFieldsOf(remote.Data, zone), listId, lastOrder, tag));
            tasksCreated++;
            handled.Add(id);
            // The event learns its task, so a new link pairs it instead of copying it.
            var marked = remote.Data with { Marker = MarkerFor(id) };
            var written = await engine.Safely(() => provider.UpdateEventAsync(connection, link.RemoteId, remote, marked, cancellation));
            if (written is null)
            {
                conflicts++;
                Keep(remote, id, remote.Data);
                return;
            }
            Keep(written, id, marked);
        }

        /// <summary>Where tasks from this calendar land (looked up once a run), and the order after its last task.</summary>
        private async Task<string?> LandingListAsync(CancellationToken cancellation)
        {
            if (landingList is not null) return landingList;
            (landingList, lastOrder) = await engine.LandingAsync(owner, link.ListId, cancellation);
            return landingList;
        }

        private void Keep(RemoteEvent remote, string? taskId, EventData agreed)
        {
            var item = new CalendarItem(link.Id, remote.Id, taskId, remote.Etag, CalendarJson.Write(remote), CalendarJson.Write(agreed),
                items.GetValueOrDefault(remote.Id)?.HiddenJson, engine.time.GetUtcNow());
            put[remote.Id] = item;
            removed.Remove(remote.Id);
            if (taskId is not null) byTask[taskId] = item;
        }

        /// <summary>The task changes, as the person, so the server's rules apply; refused ones are counted, not retried.</summary>
        private async Task WriteTasksAsync(CancellationToken cancellation)
        {
            if (taskWrites.Count == 0) return;
            var response = await engine.sync.SyncAsync(
                owner,
                new SyncRequest(WorkspaceSchema.CurrentVersion, long.MaxValue, [.. taskWrites.Select(doc => new SyncEntity("tasks", doc))]),
                // Marked as the calendar's, so the change it makes does not ask for another run.
                source: Origin,
                cancellation);
            refused += response.Rejected.Count + (response.Invalid?.Count ?? 0);
        }
    }

    /// <summary>
    /// "Make it a task" (decision 2): a task with the event's text and time in the person's inbox,
    /// untagged and not linked, written as the person. Null when they have no inbox or may not write it.
    /// </summary>
    public async Task<string?> MakeTaskAsync(string owner, EventData data, CancellationToken cancellation = default)
    {
        await sharing.Loaded.WaitAsync(cancellation);
        var (listId, last) = await LandingAsync(owner, null, cancellation);
        if (listId is null) return null;
        var id = Ids.NewUlid(time);
        var task = NewTask(id, owner, CalendarMapping.TaskFieldsOf(data, await zoneOf(owner, cancellation)), listId, OrderKeys.After(last), null);
        var response = await sync.SyncAsync(owner, new SyncRequest(WorkspaceSchema.CurrentVersion, long.MaxValue, [new SyncEntity("tasks", task)]), source: null, cancellation);
        return response.Rejected.Count + (response.Invalid?.Count ?? 0) == 0 ? id : null;
    }

    /// <summary>
    /// The list new tasks land in: <paramref name="listId"/> while the person may still add to it,
    /// otherwise their inbox; and the order key of its last top-level task.
    /// </summary>
    private async Task<(string? ListId, string? LastOrder)> LandingAsync(string owner, string? listId, CancellationToken cancellation)
    {
        var index = sharing.Index;
        string? landing;
        if (listId is not null && index.LiveDocOf(listId, "lists") is not null && index.ListRole(owner, listId) is "owner" or "editor")
        {
            landing = listId;
        }
        else
        {
            var lists = await entities.GetManyAsync(await entities.VisibleIdsAsync(owner, "lists", false, cancellation), cancellation);
            landing = lists.Where(each => each.OwnerId == owner && (bool?)each.Doc["isInbox"] == true)
                .Select(each => each.Id).Order(StringComparer.Ordinal).FirstOrDefault();
        }
        if (landing is null) return (null, null);
        var tasks = await entities.GetManyAsync(await entities.VisibleIdsAsync(owner, "tasks", false, cancellation), cancellation);
        var last = OrderKeys.Last(tasks.Where(each => (string?)each.Doc["listId"] == landing && each.Doc["parentId"] is null)
            .Select(each => (string?)each.Doc["order"]));
        return (landing, last);
    }

    /// <summary>A whole new task from an event's fields (<see cref="CalendarMapping.TaskFieldsOf"/>), tagged when <paramref name="tag"/> is given.</summary>
    private JsonObject NewTask(string id, string owner, JsonObject incoming, string listId, string order, string? tag)
    {
        var stamp = clock.Next();
        var fields = new JsonObject
        {
            ["title"] = incoming["title"]?.DeepClone(),
            ["notes"] = incoming["notes"]?.DeepClone(),
            ["listId"] = listId,
            ["sectionId"] = null,
            ["parentId"] = null,
            ["order"] = order,
            ["status"] = "open",
            ["completedAt"] = null,
            ["completedBy"] = null,
            ["priority"] = 0,
            ["schedule"] = incoming["schedule"]?.DeepClone(),
            ["due"] = null,
            ["tags"] = tag is null ? new JsonObject() : new JsonObject { [tag] = new JsonObject { ["in"] = true, ["hlc"] = stamp } },
            ["assignees"] = new JsonObject(),
            ["blockedBy"] = new JsonObject(),
            ["recurrence"] = incoming["recurrence"]?.DeepClone(),
            ["progress"] = 0,
        };
        return ServerEntities.New(id, owner, Origin, clock.Now(), stamp, fields);
    }

    /// <summary>
    /// Stored overrides that are gone without being named: those of a deleted series, and, where a changed
    /// series lists all its overrides, those it no longer lists (an occurrence put back in its place).
    /// </summary>
    private static IEnumerable<string> StaleOverrides(IEnumerable<CalendarItem> items, RemoteChanges changes, IReadOnlySet<string> deletedSeries, bool seriesListsOverrides)
    {
        var listed = changes.Changed.Select(each => each.Id).ToHashSet(StringComparer.Ordinal);
        var changedSeries = seriesListsOverrides
            ? changes.Changed.Where(each => each.SeriesId is null).Select(each => each.Id).ToHashSet(StringComparer.Ordinal)
            : [];
        foreach (var item in items.Where(each => each.TaskId is null))
        {
            if (CalendarJson.ReadEvent(item.EventJson).SeriesId is not { } series) continue;
            if (deletedSeries.Contains(series) || (changedSeries.Contains(series) && !listed.Contains(item.EventId))) yield return item.EventId;
        }
    }

    /// <summary>A port call that may meet a stale etag: null on <see cref="CalendarProblemKind.Conflict"/> (merged on the next run), the rest thrown.</summary>
    private async Task<T?> Safely<T>(Func<Task<T>> call) where T : class
    {
        try
        {
            return await call();
        }
        catch (CalendarProblem problem) when (problem.Kind is CalendarProblemKind.Conflict or CalendarProblemKind.NotFound)
        {
            return null;
        }
    }

    private async Task<bool> Safely(Func<Task<bool>> call)
    {
        try
        {
            return await call();
        }
        catch (CalendarProblem problem) when (problem.Kind is CalendarProblemKind.Conflict)
        {
            return false;
        }
    }

    /// <summary>The whole task with <paramref name="fields"/> changed, stamped after every stamp they had, so the calendar's change wins.</summary>
    private JsonObject Changed(JsonObject doc, JsonObject fields)
    {
        var stamp = clock.Next();
        var clocks = doc["_hlc"] as JsonObject;
        foreach (var (field, _) in fields)
        {
            var old = (string?)clocks?[field];
            if (Hlc.IsValid(old) && Hlc.Compare(stamp, old) <= 0) stamp = Hlc.After(old!, ServerClock.Node);
        }
        return ServerEntities.Changed(doc, stamp, fields);
    }

    /// <summary>When the latest of these task fields was edited, from their HLC stamps.</summary>
    private DateTimeOffset FieldTime(JsonObject doc, string[] fields)
    {
        var latest = DateTimeOffset.MinValue;
        if (doc["_hlc"] is not JsonObject clocks) return latest;
        foreach (var field in fields)
        {
            if ((string?)clocks[field] is { } stamp && Hlc.IsValid(stamp) && Hlc.WallTime(stamp) > latest) latest = Hlc.WallTime(stamp);
        }
        return latest;
    }
}
