using System.Globalization;
using PeckList.Core.Calendars;

namespace PeckList.Calendars.Testing;

/// <summary>
/// A calendar service in memory (spec: PL-134, Shape: "a fake provider with seeded drift"): accounts
/// with passwords, calendars with etags, a change log behind its sync tokens, and push channels. It
/// passes the contract kit like a real adapter. The sync engine's tests also use it to play the other
/// side: drift (another client editing), expired tokens, failures, and the race between a read and a
/// write. Made-up data only.
/// </summary>
public sealed class FakeCalendarProvider : ICalendarProvider
{
    private readonly Lock gate = new();
    private readonly TimeProvider time;
    private readonly Dictionary<(string Url, string User), Account> accounts = [];
    private readonly Dictionary<string, (Account Account, Calendar Calendar)> calendars = new(StringComparer.Ordinal);
    private readonly Queue<Exception> failures = new();
    private readonly HashSet<string> hanging = new(StringComparer.Ordinal);
    private readonly Dictionary<string, CalendarProblem> refusing = new(StringComparer.Ordinal);
    private readonly HashSet<string> hangingWrites = new(StringComparer.Ordinal);
    private bool raceNextWrite;
    private int next;

    /// <param name="time">Where <see cref="RemoteEvent.UpdatedAt"/> and channel expiry come from.</param>
    /// <param name="push">Whether it opens push channels (Google) or not (CalDAV).</param>
    /// <param name="seriesListsOverrides">Whether a changed series comes with its overrides (CalDAV) or not (Google).</param>
    public FakeCalendarProvider(TimeProvider? time = null, bool push = true, bool seriesListsOverrides = false)
    {
        this.time = time ?? TimeProvider.System;
        Capabilities = new CalendarCapabilities(push, CreateCalendar: true, seriesListsOverrides);
    }

    /// <inheritdoc/>
    public string Kind => "fake";

    /// <inheritdoc/>
    public CalendarCapabilities Capabilities { get; }

    /// <summary>Calls made through the port, failed ones included (backoff tests count these).</summary>
    public int Calls { get; private set; }

    /// <summary>Push channels open now, with the callback and token each was opened with.</summary>
    public IReadOnlyList<(PushChannel Channel, Uri Callback, string Token)> Channels
    {
        get { lock (gate) return [.. accounts.Values.SelectMany(account => account.Channels)]; }
    }

    // ---- Setting up and playing the other side (not part of the port) ----

    /// <summary>An account to connect to, and the connection that signs in to it.</summary>
    public CalendarConnection AddAccount(string serverUrl = "https://calendar.example.com", string username = "sam", string password = "app-password")
    {
        lock (gate)
        {
            accounts[(serverUrl, username)] = new Account(password);
            return new CalendarConnection(serverUrl, username, password);
        }
    }

    /// <summary>The account's password changes on the service: connections with the old one get <see cref="CalendarProblemKind.Auth"/>.</summary>
    public void ChangePassword(CalendarConnection connection, string password)
    {
        lock (gate) Find(connection).Password = password;
    }

    /// <summary>A calendar in the account, as if made on the service. Returns its id.</summary>
    public string AddCalendar(CalendarConnection connection, string name = "Personal", bool readOnly = false, string? timeZone = null, string? color = null)
    {
        lock (gate) return Add(Find(connection), name, readOnly, timeZone, color).Id;
    }

    /// <summary>An event added by another client. <paramref name="raw"/> stands for what the fake does not map.</summary>
    /// <param name="foreign">Not the person's to own (an invitation from someone else, a birthday): never imported.</param>
    public RemoteEvent Seed(string calendarId, EventData data, string? raw = null, bool foreign = false)
    {
        lock (gate)
        {
            var calendar = CalendarOf(calendarId);
            var created = new RemoteEvent(NewId("ev"), NewEtag(), data, time.GetUtcNow(), Raw: raw, Foreign: foreign);
            Put(calendar, created);
            return created;
        }
    }

    /// <summary>An event with a location and an alarm, as the contract kit's "keeps what it does not map" case needs.</summary>
    public RemoteEvent SeedWithExtras(string calendarId, EventData data) => Seed(calendarId, data, ExtrasRaw);

    /// <summary>Whether an event still has the location and alarm <see cref="SeedWithExtras"/> gave it.</summary>
    public static bool HasExtras(RemoteEvent remote) => remote.Raw == ExtrasRaw;

    private const string ExtrasRaw = """{"location":"Room 4","alarm":"-PT15M"}""";

    /// <summary>One occurrence of a repeating event moved or cancelled by another client.</summary>
    public RemoteEvent AddOverride(string calendarId, string seriesId, CalendarTime originalStart, EventData data, bool cancelled = false)
    {
        lock (gate)
        {
            var calendar = CalendarOf(calendarId);
            if (!calendar.Events.ContainsKey(seriesId)) throw new ArgumentException($"no event {seriesId}");
            var created = new RemoteEvent($"{seriesId}@{originalStart.Value}", NewEtag(), data, time.GetUtcNow(), seriesId, originalStart, cancelled);
            Put(calendar, created);
            return created;
        }
    }

    /// <summary>Another client changes an event.</summary>
    public RemoteEvent Edit(string calendarId, string eventId, Func<EventData, EventData> change)
    {
        lock (gate)
        {
            var calendar = CalendarOf(calendarId);
            var stored = calendar.Events.GetValueOrDefault(eventId) ?? throw new ArgumentException($"no event {eventId}");
            var edited = stored with { Data = change(stored.Data), Etag = NewEtag(), UpdatedAt = time.GetUtcNow() };
            Put(calendar, edited);
            return edited;
        }
    }

    /// <summary>
    /// Another client puts one occurrence back where its series has it: the override goes without being
    /// announced, as on CalDAV, where it was part of the series' resource. Only the series changes.
    /// </summary>
    public void UnmoveOccurrence(string calendarId, string overrideId)
    {
        lock (gate)
        {
            var calendar = CalendarOf(calendarId);
            var single = calendar.Events.GetValueOrDefault(overrideId) ?? throw new ArgumentException($"no override {overrideId}");
            calendar.Events.Remove(overrideId);
            var series = calendar.Events[single.SeriesId!];
            Put(calendar, series with { Etag = NewEtag(), UpdatedAt = time.GetUtcNow() });
        }
    }

    /// <summary>Another client deletes an event (and its overrides).</summary>
    public void Remove(string calendarId, string eventId)
    {
        lock (gate) Delete(CalendarOf(calendarId), eventId);
    }

    /// <summary>The event as the service holds it now, or null.</summary>
    public RemoteEvent? Event(string calendarId, string eventId)
    {
        lock (gate) return CalendarOf(calendarId).Events.GetValueOrDefault(eventId);
    }

    /// <summary>Every event in the calendar now, by id.</summary>
    public IReadOnlyList<RemoteEvent> Events(string calendarId)
    {
        lock (gate) return [.. CalendarOf(calendarId).Events.Values.OrderBy(each => each.Id, StringComparer.Ordinal)];
    }

    /// <summary>The service forgets its change log: every sync token handed out so far is refused.</summary>
    public void ExpireTokens(string calendarId)
    {
        lock (gate) CalendarOf(calendarId).Generation++;
    }

    /// <summary>
    /// The next <paramref name="times"/> calls through the port throw <paramref name="failure"/>: a
    /// <see cref="CalendarProblem"/> as an adapter means it, or anything else as an adapter's bug.
    /// </summary>
    public void FailNext(Exception failure, int times = 1)
    {
        lock (gate) for (var count = 0; count < times; count++) failures.Enqueue(failure);
    }

    /// <summary>
    /// The service refuses every change to one event (as Google refuses changes to a birthday): updates
    /// and deletes of it throw <paramref name="problem"/>, by default a 400 with Google's words.
    /// </summary>
    public void RefuseWrites(string eventId, CalendarProblem? problem = null)
    {
        lock (gate) refusing[eventId] = problem ?? new CalendarProblem(CalendarProblemKind.Refused, "calendar_refused", "Google answered 400 (eventTypeRestriction)");
    }

    /// <summary>The service stops answering partway through a run: an update of this event waits until cancelled. <paramref name="hang"/> false lets it answer again.</summary>
    public void HangWrites(string eventId, bool hang = true)
    {
        lock (gate)
        {
            if (hang) hangingWrites.Add(eventId);
            else hangingWrites.Remove(eventId);
        }
    }

    /// <summary>The service stops answering for a calendar: reading its changes waits until cancelled.</summary>
    public void Hang(string calendarId)
    {
        lock (gate) hanging.Add(calendarId);
    }

    /// <summary>
    /// The next read of a calendar's changes waits until the returned source is set: a result lets it
    /// answer as usual, an exception makes it fail with that. <see cref="Held"/> completes once it waits.
    /// </summary>
    public TaskCompletionSource Hold(string calendarId)
    {
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        lock (gate)
        {
            held[calendarId] = release;
            Held = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        }
        return release;
    }

    /// <summary>Completes when a read held by <see cref="Hold"/> starts waiting.</summary>
    public TaskCompletionSource Held { get; private set; } = new();

    private readonly Dictionary<string, TaskCompletionSource> held = new(StringComparer.Ordinal);

    /// <summary>
    /// Another client writes the event between the engine's read and its next update or delete, so
    /// that write meets a stale etag (412).
    /// </summary>
    public void RaceNextWrite()
    {
        lock (gate) raceNextWrite = true;
    }

    /// <summary>
    /// Random edits by another client, from a seed so a failure replays: titles changed, events moved
    /// by a few days (keeping their shape), deleted and added. Overrides are left alone. Returns what
    /// it did, one line a step, for the test's output.
    /// </summary>
    public IReadOnlyList<string> Drift(string calendarId, int seed, int steps)
    {
        var random = new Random(seed);
        var done = new List<string>();
        lock (gate)
        {
            var calendar = CalendarOf(calendarId);
            for (var step = 0; step < steps; step++)
            {
                var series = calendar.Events.Values.Where(each => each.SeriesId is null).OrderBy(each => each.Id, StringComparer.Ordinal).ToList();
                var action = series.Count == 0 ? 3 : random.Next(4);
                if (action == 3)
                {
                    var day = new DateOnly(2026, 12, 1).AddDays(random.Next(28));
                    var data = random.Next(2) == 0
                        ? new EventData($"Drift added {step}", "", CalendarTime.Date(Day(day)), CalendarTime.Date(Day(day.AddDays(1))))
                        : new EventData($"Drift added {step}", "", CalendarTime.Local($"{Day(day)}T09:00", "Europe/London"), CalendarTime.Local($"{Day(day)}T09:30", "Europe/London"));
                    var created = new RemoteEvent(NewId("ev"), NewEtag(), data, time.GetUtcNow());
                    Put(calendar, created);
                    done.Add($"add {created.Id}");
                    continue;
                }
                var target = series[random.Next(series.Count)];
                switch (action)
                {
                    case 0:
                        Put(calendar, target with { Data = target.Data with { Summary = $"Drift {step}" }, Etag = NewEtag(), UpdatedAt = time.GetUtcNow() });
                        done.Add($"retitle {target.Id}");
                        break;
                    case 1:
                        var days = random.Next(1, 4) * (random.Next(2) == 0 ? -1 : 1);
                        var moved = target.Data with { Start = Shift(target.Data.Start, days), End = target.Data.End is { } end ? Shift(end, days) : null };
                        Put(calendar, target with { Data = moved, Etag = NewEtag(), UpdatedAt = time.GetUtcNow() });
                        done.Add($"move {target.Id} {days:+0;-0} days");
                        break;
                    default:
                        Delete(calendar, target.Id);
                        done.Add($"delete {target.Id}");
                        break;
                }
            }
        }
        return done;
    }

    // ---- The port ----

    /// <inheritdoc/>
    public Task<IReadOnlyList<RemoteCalendar>> CalendarsAsync(CalendarConnection connection, CancellationToken cancellation)
    {
        lock (gate)
        {
            var account = Enter(connection);
            return Task.FromResult<IReadOnlyList<RemoteCalendar>>([.. account.Calendars.Select(Describe)]);
        }
    }

    /// <inheritdoc/>
    public Task<RemoteCalendar> CreateCalendarAsync(CalendarConnection connection, string name, CancellationToken cancellation)
    {
        lock (gate) return Task.FromResult(Describe(Add(Enter(connection), name, readOnly: false, timeZone: null, color: null)));
    }

    /// <inheritdoc/>
    public async Task<RemoteChanges> ChangesAsync(CalendarConnection connection, string calendarId, string? syncToken, CancellationToken cancellation)
    {
        bool hangs;
        TaskCompletionSource? release;
        lock (gate)
        {
            hangs = hanging.Contains(calendarId);
            if (held.Remove(calendarId, out release)) Held.TrySetResult();
        }
        if (hangs) await Task.Delay(Timeout.Infinite, cancellation);
        if (release is not null) await release.Task.WaitAsync(cancellation);
        var changes = await ChangesNowAsync(connection, calendarId, syncToken);
        AfterListing?.Invoke();
        return changes;
    }

    /// <summary>Called once a listing is made, before it is answered: a deadline that passes just then.</summary>
    public Action? AfterListing { get; set; }

    /// <summary>Full listings in reverse id order: a server's order is its own, and a run must not depend on it.</summary>
    public bool ListsInReverse { get; set; }

    private Task<RemoteChanges> ChangesNowAsync(CalendarConnection connection, string calendarId, string? syncToken)
    {
        lock (gate)
        {
            var calendar = Owned(Enter(connection), calendarId);
            var token = Token(calendar);
            if (syncToken is null)
            {
                var listed = calendar.Events.Values.OrderBy(each => each.Id, StringComparer.Ordinal);
                return Task.FromResult(new RemoteChanges([.. ListsInReverse ? listed.Reverse() : listed], [], token, Reset: true));
            }
            var parts = syncToken.Split('~');
            if (parts.Length != 3
                || parts[0] != calendar.Id
                || parts[1] != calendar.Generation.ToString(CultureInfo.InvariantCulture)
                || !long.TryParse(parts[2], NumberStyles.None, CultureInfo.InvariantCulture, out var after)
                || after > calendar.Seq)
            {
                throw new CalendarProblem(CalendarProblemKind.SyncTokenExpired, "calendar_sync_token_expired", "the sync token is not accepted");
            }
            var touched = calendar.Log.Where(entry => entry.Seq > after).Select(entry => entry.Id).Distinct(StringComparer.Ordinal).ToList();
            var changed = touched.Where(calendar.Events.ContainsKey).Select(id => calendar.Events[id]).ToList();
            var deleted = touched.Where(id => !calendar.Events.ContainsKey(id)).ToList();
            return Task.FromResult(new RemoteChanges(changed, deleted, token, Reset: false));
        }
    }

    /// <inheritdoc/>
    public Task<RemoteEvent> CreateEventAsync(CalendarConnection connection, string calendarId, EventData data, CancellationToken cancellation)
    {
        lock (gate)
        {
            var calendar = Writable(Owned(Enter(connection), calendarId));
            var created = new RemoteEvent(NewId("ev"), NewEtag(), Stored(data), time.GetUtcNow());
            Put(calendar, created);
            return Task.FromResult(created);
        }
    }

    /// <inheritdoc/>
    public async Task<RemoteEvent> UpdateEventAsync(CalendarConnection connection, string calendarId, RemoteEvent basis, EventData data, CancellationToken cancellation)
    {
        bool hangs;
        lock (gate) hangs = hangingWrites.Contains(basis.Id);
        if (hangs) await Task.Delay(Timeout.Infinite, cancellation);
        return await UpdateNowAsync(connection, calendarId, basis, data);
    }

    private Task<RemoteEvent> UpdateNowAsync(CalendarConnection connection, string calendarId, RemoteEvent basis, EventData data)
    {
        lock (gate)
        {
            var calendar = Writable(Owned(Enter(connection), calendarId));
            if (refusing.TryGetValue(basis.Id, out var refusal)) throw refusal;
            Race(calendar, basis.Id);
            var stored = calendar.Events.GetValueOrDefault(basis.Id)
                ?? throw new CalendarProblem(CalendarProblemKind.NotFound, "calendar_event_not_found", "the event is gone");
            if (stored.Etag != basis.Etag) throw Stale();
            // What the fake does not map (Raw) stays as the service holds it, as an adapter keeps it.
            var updated = stored with { Data = Stored(data), Etag = NewEtag(), UpdatedAt = time.GetUtcNow() };
            Put(calendar, updated);
            return Task.FromResult(updated);
        }
    }

    /// <inheritdoc/>
    public Task DeleteEventAsync(CalendarConnection connection, string calendarId, string eventId, string etag, CancellationToken cancellation)
    {
        lock (gate)
        {
            var calendar = Writable(Owned(Enter(connection), calendarId));
            if (refusing.TryGetValue(eventId, out var refusal)) throw refusal;
            Race(calendar, eventId);
            if (calendar.Events.GetValueOrDefault(eventId) is not { } stored) return Task.CompletedTask;
            if (stored.Etag != etag) throw Stale();
            Delete(calendar, eventId);
            return Task.CompletedTask;
        }
    }

    /// <inheritdoc/>
    public Task<PushChannel?> WatchAsync(CalendarConnection connection, string calendarId, Uri callback, string channelToken, CancellationToken cancellation)
    {
        lock (gate)
        {
            var account = Enter(connection);
            var calendar = Owned(account, calendarId);
            if (!Capabilities.Push) return Task.FromResult<PushChannel?>(null);
            var channel = new PushChannel(NewId("ch"), $"res-{calendar.Id}", time.GetUtcNow().AddDays(7));
            account.Channels.Add((channel, callback, channelToken));
            return Task.FromResult<PushChannel?>(channel);
        }
    }

    /// <inheritdoc/>
    public Task StopWatchAsync(CalendarConnection connection, PushChannel channel, CancellationToken cancellation)
    {
        lock (gate)
        {
            Enter(connection).Channels.RemoveAll(each => each.Channel.Id == channel.Id);
            return Task.CompletedTask;
        }
    }

    // ---- Inside ----

    private sealed class Account(string password)
    {
        public string Password { get; set; } = password;
        public List<Calendar> Calendars { get; } = [];
        public List<(PushChannel Channel, Uri Callback, string Token)> Channels { get; } = [];
    }

    private sealed class Calendar(string id, string name, bool readOnly, string? timeZone, string? color)
    {
        public string Id { get; } = id;
        public string Name { get; } = name;
        public bool ReadOnly { get; } = readOnly;
        public string? TimeZone { get; } = timeZone;
        public string? Color { get; } = color;
        public Dictionary<string, RemoteEvent> Events { get; } = new(StringComparer.Ordinal);
        public List<(long Seq, string Id)> Log { get; } = [];
        public long Seq { get; set; }
        public int Generation { get; set; }
    }

    /// <summary>Every port call: count it, fail it when told to, then check the password.</summary>
    private Account Enter(CalendarConnection connection)
    {
        Calls++;
        if (failures.TryDequeue(out var failure)) throw failure;
        if (!accounts.TryGetValue((connection.ServerUrl, connection.Username ?? ""), out var account) || account.Password != connection.Secret)
        {
            throw new CalendarProblem(CalendarProblemKind.Auth, "calendar_auth_failed", "the calendar service refused the sign-in");
        }
        return account;
    }

    private Account Find(CalendarConnection connection) =>
        accounts.GetValueOrDefault((connection.ServerUrl, connection.Username ?? "")) ?? throw new ArgumentException("no such account");

    private Calendar Add(Account account, string name, bool readOnly, string? timeZone, string? color)
    {
        var calendar = new Calendar(NewId("cal"), name, readOnly, timeZone, color);
        account.Calendars.Add(calendar);
        calendars[calendar.Id] = (account, calendar);
        return calendar;
    }

    private Calendar CalendarOf(string calendarId) =>
        calendars.TryGetValue(calendarId, out var found) ? found.Calendar : throw new ArgumentException($"no calendar {calendarId}");

    private Calendar Owned(Account account, string calendarId) =>
        calendars.TryGetValue(calendarId, out var found) && found.Account == account
            ? found.Calendar
            : throw new CalendarProblem(CalendarProblemKind.NotFound, "calendar_not_found", "the calendar is gone");

    private static Calendar Writable(Calendar calendar) =>
        calendar.ReadOnly ? throw new CalendarProblem(CalendarProblemKind.Refused, "calendar_read_only", "the calendar is read-only") : calendar;

    private void Race(Calendar calendar, string eventId)
    {
        if (!raceNextWrite) return;
        raceNextWrite = false;
        if (calendar.Events.GetValueOrDefault(eventId) is { } stored) Put(calendar, stored with { Etag = NewEtag(), UpdatedAt = time.GetUtcNow() });
    }

    private static CalendarProblem Stale() =>
        new(CalendarProblemKind.Conflict, "calendar_event_changed", "the event changed since it was read");

    private static RemoteCalendar Describe(Calendar calendar) =>
        new(calendar.Id, calendar.Name, calendar.Color, calendar.ReadOnly, calendar.TimeZone);

    private static string Token(Calendar calendar) =>
        string.Create(CultureInfo.InvariantCulture, $"{calendar.Id}~{calendar.Generation}~{calendar.Seq}");

    private void Put(Calendar calendar, RemoteEvent remote)
    {
        calendar.Events[remote.Id] = remote;
        calendar.Log.Add((++calendar.Seq, remote.Id));
        if (!Capabilities.SeriesListsOverrides || remote.SeriesId is not null) return;
        // One resource: a changed series is listed with every override it has.
        foreach (var single in calendar.Events.Values.Where(each => each.SeriesId == remote.Id).ToList()) calendar.Log.Add((++calendar.Seq, single.Id));
    }

    private static void Delete(Calendar calendar, string eventId)
    {
        var gone = calendar.Events.Values.Where(each => each.Id == eventId || each.SeriesId == eventId).Select(each => each.Id).ToList();
        foreach (var id in gone)
        {
            calendar.Events.Remove(id);
            calendar.Log.Add((++calendar.Seq, id));
        }
    }

    /// <summary>
    /// As a service stores a write: no end becomes 30 minutes, or one day when all-day (decision 5,
    /// which the CalDAV and Google adapters apply when writing too).
    /// </summary>
    // As a CalDAV server holds an event: an end always, and text with line breaks as LF and no
    // control characters but tab (CalText.Escape).
    private static EventData Stored(EventData data) =>
        (data.End is not null ? data : data with { End = DefaultEnd(data.Start) }) with { Summary = Plain(data.Summary), Description = Plain(data.Description) };

    private static string Plain(string text) => CalendarMapping.Plain(System.Text.Json.Nodes.JsonValue.Create(text));

    private static CalendarTime DefaultEnd(CalendarTime start) => start.IsDate
        ? CalendarTime.Date(Day(DateOnly.ParseExact(start.Value, "yyyy-MM-dd", CultureInfo.InvariantCulture).AddDays(1)))
        : CalendarTime.Local(LocalText(LocalOf(start.Value).AddMinutes(30)), start.TimeZone);

    private static CalendarTime Shift(CalendarTime moment, int days) => moment.IsDate
        ? moment with { Value = Day(DateOnly.ParseExact(moment.Value, "yyyy-MM-dd", CultureInfo.InvariantCulture).AddDays(days)) }
        : moment with { Value = LocalText(LocalOf(moment.Value).AddDays(days)) };

    private static DateTime LocalOf(string value) =>
        DateTime.ParseExact(value, ["yyyy-MM-dd'T'HH:mm", "yyyy-MM-dd'T'HH:mm:ss"], CultureInfo.InvariantCulture, DateTimeStyles.None);

    private static string LocalText(DateTime local) =>
        local.ToString(local.Second == 0 ? "yyyy-MM-dd'T'HH:mm" : "yyyy-MM-dd'T'HH:mm:ss", CultureInfo.InvariantCulture);

    private static string Day(DateOnly day) => day.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    private string NewId(string prefix) => string.Create(CultureInfo.InvariantCulture, $"{prefix}-{++next}");

    private string NewEtag() => string.Create(CultureInfo.InvariantCulture, $"\"{++next}\"");
}
