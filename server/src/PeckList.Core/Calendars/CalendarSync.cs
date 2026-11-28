using System.Globalization;
using System.Text.Json.Nodes;
using PeckList.Core.Api;
using PeckList.Core.Sharing;
using PeckList.Core.Storage;
using PeckList.Core.Sync;
using PeckList.Core.Tasks;

namespace PeckList.Core.Calendars;

/// <summary>What one run of a link did, for logs and tests.</summary>
/// <param name="Refused">Task changes the server's sharing rules refused.</param>
/// <param name="EventsRefused">Event writes the calendar service refused (a birthday, someone else's invite); the run went on.</param>
/// <param name="FirstRefusal">The first of those, as <see cref="CalendarProblem.Describe"/> gives it, for the log.</param>
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
    string? Problem = null,
    string? Detail = null,
    int EventsRefused = 0,
    string? FirstRefusal = null);

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

    /// <summary>Told when a run cut short could not save what it had written (the server logs its type).</summary>
    public Action<Exception>? SalvageFailed { get; init; }

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
        // Kept only while the account is: a refresh that lands after a disconnect stores nothing.
        return new CalendarConnection(account.ServerUrl, account.Username, secret, async changed =>
            await calendars.UpdateAccountSecretAsync(account.Id, await secrets.ProtectAsync(changed, CancellationToken.None), CancellationToken.None));
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
        // The link as the run goes by it. Every write after a call is update-only and checks the link is
        // still there in this use, so a run that outlives a disconnect, or a change of use, writes nothing
        // back (Security, PL-134 live-sync M2).
        var ran = link;
        try
        {
            var connection = await ConnectionAsync(account, deadline.Token);
            var run = await RunAsync(link, provider, connection, deadline.Token);
            if (run.Conflicts > 0 && await calendars.LinkAsync(linkId, deadline.Token) is { Mode: not CalendarModes.Off } again)
            {
                ran = again;
                var second = await RunAsync(again, provider, connection, deadline.Token);
                run = Add(run, second) with { Conflicts = second.Conflicts };
            }
            if (await calendars.LinkAsync(linkId, cancellation) is { } done)
            {
                await calendars.UpdateLinkRunAsync(InUse(ran, done) with { SyncedAt = time.GetUtcNow(), Problem = run.Problem, Failures = 0, NextAttempt = null }, cancellation);
            }
            if (account.Problem is not null) await calendars.UpdateAccountStatusAsync(account.Id, CalendarAccount.Ok, null, cancellation);
            return run;
        }
        catch (CalendarProblem problem)
        {
            if (problem.Kind == CalendarProblemKind.Auth)
            {
                await calendars.UpdateAccountStatusAsync(account.Id, CalendarAccount.AuthFailed, problem.Code, cancellation);
            }
            await FailedAsync(ran, problem.Code, problem.RetryAfter, cancellation);
            return new CalendarRun(Problem: problem.Code, Detail: problem.Describe());
        }
        catch (OperationCanceledException) when (!cancellation.IsCancellationRequested)
        {
            // The deadline, or a time limit inside the adapter: either way the calendar was too slow.
            await FailedAsync(ran, TimedOut, null, cancellation);
            return new CalendarRun(Problem: TimedOut);
        }
        catch (Exception error) when (error is not OperationCanceledException)
        {
            // Not an answer the adapter meant: the link still waits before it is tried again, so a
            // calendar that trips a bug is not called every pass.
            await FailedAsync(ran, Failed, null, cancellation);
            throw;
        }
    }

    /// <summary>
    /// The link as stored now, with the mode and tag the run went by: <see cref="ICalendarStore.UpdateLinkRunAsync"/>
    /// writes it only while those still hold.
    /// </summary>
    private static CalendarLink InUse(CalendarLink ran, CalendarLink now) => now with { Mode = ran.Mode, TagId = ran.TagId };

    /// <summary>
    /// How many of the link's calendar events would become tasks if it synced now (the preview before
    /// "Sync with a tag"): a full listing, counted by the same rule a run imports by, with nothing
    /// written anywhere. Events PeckList already wrote for a task that is still here pair with it
    /// rather than becoming new tasks, so they are not counted.
    /// </summary>
    /// <exception cref="CalendarProblem">The service's answer, as a run would get it.</exception>
    public async Task<int> ImportCountAsync(CalendarLink link, CancellationToken cancellation = default)
    {
        var account = await calendars.AccountAsync(link.CalendarAccountId, cancellation)
            ?? throw new CalendarProblem(CalendarProblemKind.NotFound, "calendar_not_found", "the calendar account is gone");
        if (account.Status == CalendarAccount.AuthFailed)
            throw new CalendarProblem(CalendarProblemKind.Auth, account.Problem ?? "calendar_auth_failed", "the calendar account needs signing in again");
        var provider = Provider(account.Provider)
            ?? throw new CalendarProblem(CalendarProblemKind.Refused, "calendar_unavailable", "this server can't reach that kind of calendar");
        var connection = await ConnectionAsync(account, cancellation);
        var listing = await ChangesAsync(provider, connection, link with { SyncToken = null }, cancellation);
        var zone = await zoneOf(link.AccountId, cancellation);
        var today = ImportWindow.Today(time.GetUtcNow(), zone);
        var mine = await instance.GetAsync(cancellation);
        var count = 0;
        foreach (var remote in listing.Changed)
        {
            // A listing can be long and each event's rule is the calendar's to word: the preview's own
            // deadline holds between events.
            cancellation.ThrowIfCancellationRequested();
            if (!ImportWindow.Importable(remote, today, zone)) continue;
            if (remote.Data.Marker is { } marker)
            {
                // Another server's event is left to it; one of ours pairs with its task when the person
                // can see that task, as a run decides it. Otherwise a run makes a task of it, as here.
                if (marker.Instance != mine) continue;
                if (await entities.GetAsync(marker.TaskId, cancellation) is { Collection: "tasks" }
                    && sharing.Index.Viewers(marker.TaskId).Contains(link.AccountId)) continue;
            }
            count++;
        }
        return count;
    }

    /// <summary>Records a failed run on the link: the problem, one more failure, and the wait before the next try.</summary>
    private async Task FailedAsync(CalendarLink ran, string problem, TimeSpan? retryAfter, CancellationToken cancellation)
    {
        if (await calendars.LinkAsync(ran.Id, cancellation) is not { } failed) return;
        var failures = failed.Failures + 1;
        await calendars.UpdateLinkRunAsync(InUse(ran, failed) with
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
        a.Conflicts + b.Conflicts, a.Refused + b.Refused, false, b.Problem ?? a.Problem, b.Detail ?? a.Detail,
        a.EventsRefused + b.EventsRefused, a.FirstRefusal ?? b.FirstRefusal);

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
            try
            {
                return await provider.ChangesAsync(connection, link.RemoteId, link.SyncToken, cancellation);
            }
            catch (CalendarProblem problem) when (problem.Kind == CalendarProblemKind.SyncTokenExpired && link.SyncToken is not null)
            {
                return await provider.ChangesAsync(connection, link.RemoteId, null, cancellation);
            }
        }
        catch (CalendarProblem problem)
        {
            throw problem.At(CalendarCalls.List);
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
        if (await calendars.SaveRunItemsAsync(link, [.. put.Where(item => !gone.Contains(item.EventId))], [.. gone], cancellation))
        {
            await calendars.UpdateLinkRunAsync(link with { SyncToken = changes.SyncToken }, cancellation);
        }
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
        private readonly Dictionary<string, string?> claimed = new(StringComparer.Ordinal);
        private readonly List<JsonObject> taskWrites = [];
        private string tag = "";
        private string owner = "";
        private string zone = "UTC";
        private DateOnly today;
        private EventMarker? markerBase;
        private string? landingList;
        private string? lastOrder;
        private int created, updated, deleted, tasksCreated, tasksChanged, tasksTrashed, conflicts, refused, eventsRefused;
        private string? firstRefusal;

        private enum Written { Done, Conflict, Refused }

        /// <summary>
        /// One event write. A stale etag is a conflict (merged on the next run); a refusal of this one
        /// event (a birthday, someone else's invite) is counted and the run goes on. Anything else
        /// (the sign-in, the network, the calendar gone) still fails the run.
        /// </summary>
        private async Task<(T? Value, Written Outcome)> WriteAsync<T>(string call, string? eventId, Func<Task<T>> body) where T : class
        {
            try
            {
                var value = await Safely(call, eventId, body);
                return (value, value is null ? Written.Conflict : Written.Done);
            }
            catch (CalendarProblem problem) when (problem.Kind == CalendarProblemKind.Refused)
            {
                eventsRefused++;
                firstRefusal ??= problem.Describe();
                return (null, Written.Refused);
            }
        }

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
            today = ImportWindow.Today(engine.time.GetUtcNow(), zone);
            markerBase = new EventMarker(await engine.instance.GetAsync(cancellation), "");
            foreach (var item in await engine.calendars.ItemsAsync(link.Id, cancellation))
            {
                items[item.EventId] = item;
                if (item.TaskId is not null) byTask[item.TaskId] = item;
            }
            var cursor = await ReadTaskChangesAsync(cancellation);
            await LoadDocsAsync(cancellation);

            try
            {
                // The calendar's side first, so a task re-paired by its marker is not sent again as new.
                var remoteDeleted = new HashSet<string>(changes.Deleted, StringComparer.Ordinal);
                foreach (var remote in changes.Changed.Where(each => each.Cancelled && each.SeriesId is null)) remoteDeleted.Add(remote.Id);
                if (changes.Reset)
                {
                    var listed = changes.Changed.Select(each => each.Id).ToHashSet(StringComparer.Ordinal);
                    foreach (var id in items.Keys.Where(id => !listed.Contains(id))) remoteDeleted.Add(id);
                }
                foreach (var id in remoteDeleted) RemoteDeleted(id);
                ClaimSharedMarkers(changes.Changed.Where(each => !remoteDeleted.Contains(each.Id)));
                foreach (var remote in changes.Changed.Where(each => !remoteDeleted.Contains(each.Id)))
                {
                    // Skipped events are decided without a wait, so the run's deadline is checked here too.
                    cancellation.ThrowIfCancellationRequested();
                    await RemoteChangedAsync(remote, cancellation);
                }
                foreach (var id in StaleOverrides(items.Values, changes, remoteDeleted, provider.Capabilities.SeriesListsOverrides).ToList())
                {
                    removed.Add(id);
                    put.Remove(id);
                }

                // Then the tasks that changed.
                foreach (var (id, _) in docs.Where(each => !handled.Contains(each.Key)).ToList()) await TaskChangedAsync(id, cancellation);

                await WriteTasksAsync(cancellation);
            }
            catch (Exception) when (put.Count > 0 || removed.Count > 0 || taskWrites.Count > 0)
            {
                // Cut short (the deadline, the server stopping, the service failing part-way): what was
                // already written at the calendar is kept, so the next run pairs those events instead
                // of writing them again. The token and cursor stay as they were, so it reads it all again.
                await SalvageAsync();
                throw;
            }
            // The token and cursor only with the items they go with: a link gone or started over keeps neither.
            if (await engine.calendars.SaveRunItemsAsync(link, [.. put.Values], [.. removed.Where(id => !put.ContainsKey(id))], cancellation))
            {
                await engine.calendars.UpdateLinkRunAsync(link with { SyncToken = changes.SyncToken, TaskCursor = cursor }, cancellation);
            }
            return new CalendarRun(created, updated, deleted, tasksCreated, tasksChanged, tasksTrashed, conflicts, refused,
                EventsRefused: eventsRefused, FirstRefusal: firstRefusal);
        }

        /// <summary>
        /// A run that ends early saves the tasks it made and the pairs it wrote, on no cancellation of its
        /// own: the calendar already has them. If even that fails, the failure that ended the run is the
        /// one reported; the next full listing finds PeckList's markers and pairs what it can.
        /// </summary>
        private async Task SalvageAsync()
        {
            try
            {
                await WriteTasksAsync(CancellationToken.None);
                await engine.calendars.SaveRunItemsAsync(link, [.. put.Values], [.. removed.Where(id => !put.ContainsKey(id))], CancellationToken.None);
            }
            catch (Exception salvage) when (salvage is not OutOfMemoryException)
            {
                // Not thrown: see the summary. Told, by type only, so a salvage that fails is seen.
                engine.SalvageFailed?.Invoke(salvage);
            }
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

        /// <summary>
        /// Unpaired events that share one task's marker (found again after a restart: a series cut short
        /// with its task restored, beside the task's own event). One pairs, whatever the listing order;
        /// the rest stay the calendar's. Paired in read order, the task could take the old series, and
        /// its rename or delete would then reach that series (QA F12); left unpaired, the task would get
        /// another event (QA F13). A task that is missing or not on this calendar is left to the marker path.
        /// </summary>
        private void ClaimSharedMarkers(IEnumerable<RemoteEvent> listed)
        {
            var shared = listed
                .Where(each => each.SeriesId is null && !items.ContainsKey(each.Id))
                .Select(each => (Event: each, TaskId: Ours(each.Data.Marker)))
                .Where(each => each.TaskId is not null && !byTask.ContainsKey(each.TaskId))
                .GroupBy(each => each.TaskId!, StringComparer.Ordinal)
                .Where(group => group.Skip(1).Any());
            foreach (var group in shared)
            {
                var doc = docs.GetValueOrDefault(group.Key);
                if (!InScope(group.Key, doc)) continue;
                var mine = CalendarMapping.EventOf(doc!, MarkerFor(group.Key), zone)!;
                var day = DateOnly.ParseExact(CalendarMapping.Day(mine.Start), "yyyy-MM-dd", CultureInfo.InvariantCulture);
                var live = group.Select(each => each.Event).Where(each => !ImportWindow.EndsBefore(each.Data, day)).ToList();
                bool Same(EventData data) => CalendarJson.SameWhen(mine, data) || CalendarJson.SameWhen(mine, CalendarMapping.AsTaskHolds(data, zone));
                // Its own event is the one written from the task, so it is the task's dates (1), or the
                // task ticked on along it, COUNT included (2), or, moved while the calendar was off,
                // the one event that repeats as the task does (3). A series cut on the calendar has
                // an end the task doesn't, and one ended before the task's day never pairs (QA F12-F14).
                var sameRule = live.Where(each => CalendarMapping.SameSeries(mine.RRule, each.Data.RRule)).ToList();
                // A series cut by COUNT keeps the task's rule but for its count, and a ticked task's count
                // falls: the task can then be the old series exactly (QA F15). Two such events of one
                // rule, either counted, can't be told apart, so neither pairs. Counted over all of them,
                // ended too: the task's own counted event can end before the task's day, moved on
                // while the calendar was off, leaving only the old series in play (QA F16).
                var counted = group
                    .Select(each => Recurrence.Parse(each.Event.Data.RRule))
                    .OfType<Recurrence>()
                    .GroupBy(rule => (rule with { Count = null, Skip = null }).Format(), StringComparer.Ordinal)
                    .Any(sameBase => sameBase.Skip(1).Any() && sameBase.Any(rule => rule.Count is not null));
                var pick = counted ? null
                    : live.FirstOrDefault(each => Same(each.Data))
                    ?? live.FirstOrDefault(each => each.Data.RRule is not null && Same(ImportWindow.Onward(each.Data, day)))
                    ?? (sameRule.Count == 1 ? sameRule[0] : null);
                claimed[group.Key] = pick?.Id;
                // None to pair: no event is surely its own, and pairing the wrong one would let the
                // task's delete take a series. Left unpaired, and given no new event (see Shadowed).
                if (pick is null) handled.Add(group.Key);
            }
        }

        private HashSet<string>? shadowed;

        /// <summary>
        /// Whether two or more events kept unpaired carry this task's marker: left so when none could be
        /// told to be its own (above). The task then gets no new event, on this run or a later edit, as
        /// one of them is its own already (QA F13, F14). One such event is the usual series cut short
        /// before its task, and a restored task still gets its own event beside it.
        /// </summary>
        private bool Shadowed(string taskId)
        {
            if (shadowed is null)
            {
                var instance = markerBase!.Instance;
                shadowed = items.Values
                    .Where(each => each.TaskId is null && each.SnapshotJson.Contains(instance, StringComparison.Ordinal))
                    .Select(each => Ours(CalendarJson.ReadData(each.SnapshotJson)?.Marker))
                    .OfType<string>()
                    .GroupBy(each => each, StringComparer.Ordinal)
                    .Where(group => group.Skip(1).Any())
                    .Select(group => group.Key)
                    .ToHashSet(StringComparer.Ordinal);
            }
            return shadowed.Contains(taskId);
        }

        /// <summary>The task id of a marker this server wrote, or null.</summary>
        private string? Ours(EventMarker? marker) => marker is { } found && found.Instance == markerBase!.Instance ? found.TaskId : null;

        private EventMarker MarkerFor(string taskId) => markerBase! with { TaskId = taskId };

        private bool Live(JsonObject? doc) => doc is not null && doc["deletedAt"] is null;

        // Read with a kind check: any writer of a shared task can store any JSON here, and a cast that
        // throws would fail this person's every run (Security N6).
        private bool Tagged(JsonObject doc) =>
            doc["tags"] is JsonObject set && set[tag] is JsonObject element && element["in"] is JsonValue on && on.TryGetValue<bool>(out var isIn) && isIn;

        /// <summary>Whether a task is closed (done or won't do); a status that isn't text counts as open.</summary>
        private static bool Closed(JsonObject doc) =>
            doc["status"] is JsonValue value && value.TryGetValue<string>(out var status) && status != "open";

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
                    else await DeleteEventAsync(remote, taskId, cancellation);
                }
                else if (remote.Data.Marker is null && ImportWindow.Importable(remote, today, zone))
                {
                    // Left to the calendar before (outside the window), and changed into it since: a past
                    // event moved to next week. One that never got a marker is the only kind looked at again.
                    await TaskFromEventAsync(remote, cancellation);
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
                if (claimed.TryGetValue(marked, out var only) && only != remote.Id)
                {
                    // Another event with this marker is the task's, or none is (QA F12): this one stays the calendar's.
                    Keep(remote, null, remote.Data);
                    return;
                }
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
                    // Its task is here but not on this calendar now: in Trash (as a series cut short
                    // before its task leaves it), untagged, undated, or the link's tag changed. Found by
                    // its marker alone (a restart, a new tag or mode), the event stays the calendar's,
                    // never deleted or written (Security N8, QA F9, F10): deleting could take a whole
                    // series and its past, and a CalDAV calendar has no trash.
                    Keep(remote, null, remote.Data);
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
            if (!ImportWindow.Importable(remote, today, zone))
            {
                // Before today, or not the person's to own (decision 8): the calendar's, with nothing
                // written to it. Kept, so later runs pass it by unless it changes into the window.
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
                else await DeleteEventAsync(stored with { Etag = item.Etag }, taskId, cancellation);
                return;
            }
            // A closed task (the copy ticking a repeating task leaves, or one ticked before it was
            // tagged) makes no new event: ticking never changes the calendar (decision 1).
            if (!InScope(taskId, doc) || Closed(doc!) || Shadowed(taskId)) return;
            var data = CalendarMapping.EventOf(doc!, MarkerFor(taskId), zone)!;
            var (made, outcome) = await WriteAsync(CalendarCalls.Create, null, () => provider.CreateEventAsync(connection, link.RemoteId, data, cancellation));
            // Refused: the task stays, unpaired; its next change tries again.
            if (outcome == Written.Refused) return;
            if (made is null)
            {
                conflicts++;
                return;
            }
            created++;
            Keep(made, taskId, Holds(made, data));
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
            // A pair found by its marker alone has no snapshot: the calendar's series is the basis.
            var series = agreed ?? theirs;
            var movedOn = series is { RRule: not null }
                && !CalendarJson.SameWhen(mine, series)
                && CalendarMapping.SameSeries(series.RRule, mine.RRule)
                && CalendarMapping.IsOccurrence(series, CalendarMapping.Day(mine.Start))
                // As written or as a task holds it: a series with no end gets one in the task (a day,
                // or 30 minutes), and that is not a change of shape.
                && (SameShape(mine, series) || SameShape(mine, CalendarMapping.AsTaskHolds(series, zone)));
            // The task changed only if it differs from the snapshot both as written and as a task holds
            // it: a task made from an event can't hold every event exactly (an end in another zone, a
            // rule's wording), and reading that loss as an edit would write it back over the event.
            var taskWhen = (agreed is null || (!CalendarJson.SameWhen(mine, agreed) && !CalendarJson.SameWhen(mine, CalendarMapping.AsTaskHolds(agreed, zone)))) && !movedOn;
            var remoteWhen = agreed is null || !CalendarJson.SameWhen(theirs, agreed);

            var summary = Pick(mine.Summary, theirs.Summary, agreed?.Summary, () => taskAt(["title"]), remote.UpdatedAt);
            // Compared as a task holds them: a description longer than notes may be is not a change on our side.
            var description = Pick(mine.Description, Clip(theirs.Description), agreed is null ? null : Clip(agreed.Description), () => taskAt(["notes"]), remote.UpdatedAt);
            Side when;
            if (CalendarJson.SameWhen(mine, theirs) || CalendarJson.SameWhen(mine, CalendarMapping.AsTaskHolds(theirs, zone)) || (!taskWhen && !remoteWhen)) when = Side.Same;
            else if (taskWhen && !remoteWhen) when = Side.Task;
            else if (remoteWhen && !taskWhen) when = Side.Calendar;
            // A pair found by its marker alone never moves the calendar's event: its dates are the
            // calendar's (QA F9: a later occurrence became the series' start).
            else if (agreed is null) when = Side.Calendar;
            else when = taskAt(["schedule", "due", "recurrence"]) > remote.UpdatedAt ? Side.Task : Side.Calendar;

            var day = DateOnly.ParseExact(CalendarMapping.Day(mine.Start), "yyyy-MM-dd", CultureInfo.InvariantCulture);
            if (when == Side.Calendar && agreed is null && ImportWindow.EndsBefore(theirs, day))
            {
                // Found by its marker alone, a series that ended before the task's day is the calendar's
                // and the task is left as it is: one restored from Trash after its series was cut
                // short has an event of its own to pair with (QA F11).
                Keep(remote, null, remote.Data);
                return;
            }
            if (when == Side.Calendar && ImportWindow.EndsBefore(theirs, day))
            {
                // The calendar removed the task's occurrence and all after it ("delete this and all
                // following", a lower COUNT): as for any event deleted there, the task goes to Trash,
                // where it can be restored (spec: Deleting). The series stays the calendar's and is no
                // longer paired, so nothing done to the task reaches it (QA F7, F8).
                byTask.Remove(taskId);
                Keep(remote, null, remote.Data);
                taskWrites.Add(engine.Changed(doc, new JsonObject { ["deletedAt"] = engine.clock.Now() }));
                tasksTrashed++;
                return;
            }

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
                // A series changed on the calendar (its time, a left-out date) keeps the task on its
                // occurrence from the task's own day on: the next one, or the one it was ticked to,
                // never back at the series' first (QA F5). The series itself stays as the calendar has it.
                incoming = CalendarMapping.TaskFieldsOf(ImportWindow.Onward(theirs, day), zone);
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
                var (result, outcome) = await WriteAsync(CalendarCalls.Update, remote.Id, () => provider.UpdateEventAsync(connection, link.RemoteId, remote, merged, cancellation));
                if (outcome == Written.Refused)
                {
                    // The calendar won't take changes to this event: the pair goes, so it isn't asked
                    // again every run. The event stays the calendar's and the task stays as it is.
                    byTask.Remove(taskId);
                    Keep(remote, null, remote.Data);
                    return;
                }
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
            Keep(written, taskId, ReferenceEquals(written, remote) ? merged : Holds(written, merged));
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

        private async Task DeleteEventAsync(RemoteEvent remote, string? taskId, CancellationToken cancellation)
        {
            var (_, outcome) = await WriteAsync(CalendarCalls.Delete, remote.Id, async () =>
            {
                try
                {
                    await provider.DeleteEventAsync(connection, link.RemoteId, remote.Id, remote.Etag, cancellation);
                }
                catch (CalendarProblem problem) when (problem.Kind == CalendarProblemKind.NotFound)
                {
                    // Already gone (Google answers 410 for an event deleted meanwhile): what was wanted.
                }
                return new object();
            });
            if (outcome == Written.Refused)
            {
                // The calendar keeps this event: it stays, the calendar's, and isn't asked again every run.
                if (taskId is not null) byTask.Remove(taskId);
                Keep(remote, null, remote.Data);
                return;
            }
            if (outcome == Written.Conflict)
            {
                conflicts++;
                return;
            }
            deleted++;
            removed.Add(remote.Id);
            put.Remove(remote.Id);
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
            // The event learns its task first, so a new link pairs it instead of copying it. A calendar
            // that won't take the marker (a birthday, someone else's invite) keeps the event as its own,
            // and no task is made for it.
            var marked = remote.Data with { Marker = MarkerFor(id) };
            var (written, outcome) = await WriteAsync(CalendarCalls.Update, remote.Id, () => provider.UpdateEventAsync(connection, link.RemoteId, remote, marked, cancellation));
            if (outcome == Written.Refused)
            {
                Keep(remote, null, remote.Data);
                return;
            }
            lastOrder = OrderKeys.After(lastOrder);
            // A series that began before today starts on its occurrence from today on (decision 8).
            taskWrites.Add(engine.NewTask(id, owner, CalendarMapping.TaskFieldsOf(ImportWindow.Onward(remote.Data, today), zone), listId, lastOrder, tag));
            tasksCreated++;
            handled.Add(id);
            if (written is null)
            {
                conflicts++;
                Keep(remote, id, remote.Data);
                return;
            }
            Keep(written, id, Holds(written, marked));
        }

        /// <summary>Where tasks from this calendar land (looked up once a run), and the order after its last task.</summary>
        private async Task<string?> LandingListAsync(CancellationToken cancellation)
        {
            if (landingList is not null) return landingList;
            (landingList, lastOrder) = await engine.LandingAsync(owner, link.ListId, cancellation);
            return landingList;
        }

        /// <summary>
        /// The snapshot after a write: what the calendar now holds, not what was sent. A writer adds
        /// what an event lacked (an end for one with none), and a snapshot without it would read that
        /// as an edit on the calendar next run, sending a task on a later occurrence back to the
        /// series' first date (QA F4).
        /// </summary>
        private static EventData Holds(RemoteEvent written, EventData sent) => written.Data with { Marker = sent.Marker };

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

    /// <summary>
    /// A port call that may meet a stale etag: null on <see cref="CalendarProblemKind.Conflict"/> (merged
    /// on the next run), the rest thrown naming <paramref name="name"/> and <paramref name="eventId"/>.
    /// </summary>
    private static async Task<T?> Safely<T>(string name, string? eventId, Func<Task<T>> call) where T : class
    {
        try
        {
            return await call();
        }
        catch (CalendarProblem problem) when (problem.Kind is CalendarProblemKind.Conflict or CalendarProblemKind.NotFound)
        {
            return null;
        }
        catch (CalendarProblem problem)
        {
            throw problem.At(name, eventId);
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
