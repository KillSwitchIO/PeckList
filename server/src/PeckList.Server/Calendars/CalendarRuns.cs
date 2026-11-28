using System.Threading.Channels;
using PeckList.CalDav;
using PeckList.CalDav.Dav;
using PeckList.Core.Accounts;
using PeckList.Core.Calendars;
using PeckList.Core.Configuration;
using PeckList.Core.Sync;
using PeckList.Google;

namespace PeckList.Server.Calendars;

/// <summary>
/// Calendar secrets encrypted with the settings page's key (PL-134, Secrets): the same key, kept the
/// same way (wrapped by <c>CONFIG_KEY</c> when set), so one rule covers every secret the server stores
/// for someone. Made once and kept, so two first uses cannot make two keys.
/// </summary>
public sealed class CalendarSecrets(ISecretStore secrets, ConfigCipher? configKey) : ICalendarSecrets
{
    private readonly SemaphoreSlim gate = new(1, 1);
    private ConfigCipher? cipher;

    public async Task<string> ProtectAsync(string secret, CancellationToken cancellation = default) =>
        (await CipherAsync(cancellation)).Encrypt(secret);

    public async Task<string> UnprotectAsync(string stored, CancellationToken cancellation = default) =>
        (await CipherAsync(cancellation)).Decrypt(stored, "a calendar secret");

    private async Task<ConfigCipher> CipherAsync(CancellationToken cancellation)
    {
        if (cipher is not null) return cipher;
        await gate.WaitAsync(cancellation);
        try
        {
            return cipher ??= await SettingsLoader.PageCipherAsync(secrets, configKey, cancellation);
        }
        finally
        {
            gate.Release();
        }
    }
}

/// <summary>
/// People whose tasks just changed, so their synced calendars hear within seconds rather than at the
/// next check, and links whose calendar just told the server it changed (a Google push).
/// </summary>
public sealed class CalendarNudges
{
    private readonly Channel<(bool Link, string Id)> nudged = Channel.CreateUnbounded<(bool, string)>(new UnboundedChannelOptions { SingleReader = true });

    /// <summary>Ask for a run of this person's synced calendars soon.</summary>
    public void Nudge(string userId) => nudged.Writer.TryWrite((false, userId));

    /// <summary>Ask for a run of one link soon, whatever its mode: its calendar changed.</summary>
    public void NudgeLink(string linkId) => nudged.Writer.TryWrite((true, linkId));

    /// <summary>Wait until someone or something is nudged.</summary>
    public ValueTask<bool> WaitAsync(CancellationToken cancellation) => nudged.Reader.WaitToReadAsync(cancellation);

    /// <summary>Everyone nudged since the last call.</summary>
    public HashSet<string> Drain() => DrainAll().People;

    /// <summary>Everyone and every link nudged since the last call.</summary>
    public (HashSet<string> People, HashSet<string> Links) DrainAll()
    {
        var people = new HashSet<string>(StringComparer.Ordinal);
        var links = new HashSet<string>(StringComparer.Ordinal);
        while (nudged.Reader.TryRead(out var each)) (each.Link ? links : people).Add(each.Id);
        return (people, links);
    }
}

/// <summary>
/// The change notifier, also nudging calendar runs: one place hears every change the server stores,
/// so a task edited on any device reaches the person's calendar soon. Changes the calendar sync made
/// itself (source <see cref="CalendarSync.Origin"/>) and notifications nudge nothing.
/// </summary>
public sealed class CalendarNudgingNotifier(InProcessChangeNotifier inner, CalendarNudges nudges) : IChangeNotifier
{
    public void Notify(string userId, ChangeEvent change)
    {
        inner.Notify(userId, change);
        if (change.Notice is null && change.Source != CalendarSync.Origin) nudges.Nudge(userId);
    }

    public IChangeSubscription? Subscribe(string userId, int most = int.MaxValue) => inner.Subscribe(userId, most);
}

/// <summary>
/// Runs the calendar sync in the background (PL-134): every link in use at its interval
/// (<c>CALENDAR_SYNC_MINUTES</c>), a person's synced links soon after their tasks change, and a link
/// at once when its owner asks. One run at a time on the server, so runs of one person never overlap;
/// a link that failed waits out its backoff. Nothing runs while <c>CALENDAR_SYNC</c> is off.
/// </summary>
public sealed class CalendarRuns(
    CalendarSync engine, ICalendarStore calendars, LiveSettings live, CalendarNudges nudges, CalendarChannels channels, TimeProvider time,
    ILogger<CalendarRuns> logger)
    : BackgroundService
{
    /// <summary>How long after a nudge the run starts, so a burst of edits makes one run.</summary>
    public static readonly TimeSpan Settle = TimeSpan.FromSeconds(10);

    private static readonly TimeSpan Tick = TimeSpan.FromSeconds(30);

    private readonly SemaphoreSlim gate = new(1, 1);
    // Not single-reader: RunDueAsync drains it too, and tests call that beside the background loop.
    private readonly Channel<string> asked = Channel.CreateUnbounded<string>();
    private readonly System.Collections.Concurrent.ConcurrentDictionary<string, byte> waiting = new(StringComparer.Ordinal);
    private volatile string? running;
    private readonly Dictionary<string, Queue<DateTimeOffset>> queuedBy = new(StringComparer.Ordinal);

    /// <summary>Whether a run of the link is queued or going now: the app shows "Syncing..." and reads the link again.</summary>
    public bool IsSyncing(string linkId) => waiting.ContainsKey(linkId) || running == linkId;

    /// <summary>
    /// Queues a run of one link and returns at once ("Sync now", a mode just chosen): the run is not
    /// tied to the request, so a person leaving the page or a client timing out cuts nothing short. It
    /// runs on the server's lifetime with the engine's run deadline, ahead of the next due pass. A link
    /// still waiting out a failure's backoff is not queued, as <see cref="RunNowAsync"/> explains.
    /// </summary>
    /// <remarks>
    /// Each person queues at most <see cref="CalendarEndpoints.SyncsPerWindow"/> runs a
    /// <see cref="CalendarEndpoints.SyncNowWindow"/>, all their links and every route together, so
    /// changing a calendar's use over and over can't keep the one run lane busy or spend a provider's
    /// shared quota (Security, PL-134 live-sync M1). Past that nothing is queued: a link just started
    /// over has never synced, so the next due pass takes it anyway.
    /// </remarks>
    /// <returns>Whether a run was queued (or one already was).</returns>
    public async Task<bool> QueueAsync(string linkId, CancellationToken cancellation)
    {
        if (await calendars.LinkAsync(linkId, cancellation) is not { } link) return false;
        if (link.NextAttempt is { } wait && wait > time.GetUtcNow()) return false;
        if (waiting.ContainsKey(linkId)) return true;
        if (!TakeQueueTurn(link.AccountId)) return false;
        if (waiting.TryAdd(linkId, 0)) asked.Writer.TryWrite(linkId);
        return true;
    }

    /// <summary>One of the person's queued runs for this window, if they have one left.</summary>
    private bool TakeQueueTurn(string person)
    {
        var now = time.GetUtcNow();
        lock (queuedBy)
        {
            if (!queuedBy.TryGetValue(person, out var times)) queuedBy[person] = times = new Queue<DateTimeOffset>();
            while (times.Count > 0 && now - times.Peek() >= CalendarEndpoints.SyncNowWindow) times.Dequeue();
            if (times.Count >= CalendarEndpoints.SyncsPerWindow) return false;
            times.Enqueue(now);
            return true;
        }
    }

    /// <summary>Queued links, one at a time, ahead of anything due; at most <paramref name="most"/> of them.</summary>
    private async Task RunAskedAsync(CancellationToken stopping, int most = int.MaxValue)
    {
        for (var ran = 0; ran < most && asked.Reader.TryRead(out var linkId); ran++)
        {
            running = linkId;
            waiting.TryRemove(linkId, out _);
            try
            {
                if (live.Current.CalendarSync) await RunNowAsync(linkId, stopping);
            }
            finally
            {
                running = null;
            }
        }
    }

    /// <summary>
    /// One link now, waiting for any run already going ("Sync now", a mode just chosen). A link still
    /// waiting out a failure's backoff is not run, however it is asked for: runs go one at a time, so
    /// a calendar that hangs must not be called again by hand while everyone else's sync waits.
    /// </summary>
    public async Task<CalendarRun> RunNowAsync(string linkId, CancellationToken cancellation)
    {
        if (await BackingOffAsync(linkId, cancellation) is { } waiting) return waiting;
        await gate.WaitAsync(cancellation);
        try
        {
            // Checked again: the run ahead in the queue may have been this link's.
            return await BackingOffAsync(linkId, cancellation) ?? await RunLoggedAsync(linkId, cancellation);
        }
        finally
        {
            gate.Release();
        }
    }

    protected override async Task ExecuteAsync(CancellationToken stopping)
    {
        while (!stopping.IsCancellationRequested)
        {
            var nudged = nudges.WaitAsync(stopping).AsTask();
            var ticked = Task.Delay(Tick, time, stopping);
            var queued = asked.Reader.WaitToReadAsync(stopping).AsTask();
            // WhenAny never throws: a cancelled wait just ends it.
            await Task.WhenAny(nudged, ticked, queued);
            if (stopping.IsCancellationRequested) return;
            // A run someone asked for starts now; nudges settle first, so a burst of edits makes one run.
            if (nudged.IsCompletedSuccessfully && !queued.IsCompletedSuccessfully)
            {
                await Task.Delay(Settle, time, stopping).ConfigureAwait(ConfigureAwaitOptions.SuppressThrowing);
            }
            var (people, links) = nudges.DrainAll();
            try
            {
                await RunAskedAsync(stopping);
                if (!live.Current.CalendarSync || stopping.IsCancellationRequested) continue;
                await RunDueAsync(people, links, stopping);
            }
            catch (Exception error) when (!stopping.IsCancellationRequested)
            {
                logger.LogError(error, "Calendar sync pass failed; trying again shortly");
            }
        }
    }

    /// <summary>Every link that is due: nudged synced links, and any link whose interval has passed; none still backing off.</summary>
    public Task RunDueAsync(IReadOnlySet<string> nudged, CancellationToken cancellation) => RunDueAsync(nudged, new HashSet<string>(), cancellation);

    /// <summary>
    /// Every link that is due: links whose calendar pushed a change, synced links of nudged people, and
    /// any link whose interval has passed; none still backing off.
    /// </summary>
    public async Task RunDueAsync(IReadOnlySet<string> nudged, IReadOnlySet<string> pushed, CancellationToken cancellation)
    {
        var now = time.GetUtcNow();
        var every = TimeSpan.FromMinutes(live.Current.CalendarSyncMinutes);
        foreach (var link in await calendars.ActiveLinksAsync(cancellation))
        {
            // Someone waiting on "Syncing..." goes ahead of the rest of a long pass, one asked run
            // between due links, so the lane is shared.
            await RunAskedAsync(cancellation, most: 1);
            if (link.NextAttempt is { } wait && wait > now) continue;
            var due = pushed.Contains(link.Id)
                || (link.Mode == CalendarModes.Sync && nudged.Contains(link.AccountId))
                || link.SyncedAt is not { } synced
                || now - synced >= every;
            if (due) await RunNowAsync(link.Id, cancellation);
        }
    }

    /// <summary>A skipped run carrying the link's problem while its backoff lasts; null when it may run.</summary>
    private async Task<CalendarRun?> BackingOffAsync(string linkId, CancellationToken cancellation) =>
        await calendars.LinkAsync(linkId, cancellation) is { NextAttempt: { } wait } link && wait > time.GetUtcNow()
            ? new CalendarRun(Skipped: true, Problem: link.Problem)
            : null;

    private async Task<CalendarRun> RunLoggedAsync(string linkId, CancellationToken cancellation)
    {
        try
        {
            var run = await engine.SyncLinkAsync(linkId, cancellation);
            // The detail is the code, the service's status and reason, the call and the event id: never event text.
            if (run.Problem is { } problem) logger.LogWarning("Calendar link {Link} could not sync: {Problem}", linkId, run.Detail ?? problem);
            else if (run.Refused > 0) logger.LogInformation("Calendar link {Link}: {Refused} task changes refused by sharing rules", linkId, run.Refused);
            // Events the calendar keeps to itself (birthdays, others' invites): counted, the run went on.
            if (run.EventsRefused > 0)
            {
                logger.LogWarning("Calendar link {Link}: the calendar refused {Count} event changes; they stay the calendar's. First: {First}",
                    linkId, run.EventsRefused, run.FirstRefusal);
            }
            // A calendar that synced and can push keeps a channel open, so its changes come within seconds.
            if (run.Problem is null && !run.Skipped) await channels.KeepAsync(linkId, cancellation);
            return run;
        }
        catch (Exception error) when (!cancellation.IsCancellationRequested)
        {
            // A bug, not the calendar's answer. The engine has recorded it on the link with a backoff.
            // The message stays out of the log: parsing errors quote their input, which came from the
            // calendar server. The type and the stack are enough to find it.
            logger.LogError("Calendar link {Link} failed: {Error}{NewLine}{Stack}", linkId, error.GetType().FullName, Environment.NewLine, error.StackTrace);
            return new CalendarRun(Problem: CalendarSync.Failed);
        }
    }
}

/// <summary>Wires calendar sync into the server.</summary>
public static class CalendarSetup
{
    /// <summary>The engine, its store, secrets and providers, the nudging notifier and the background runs.</summary>
    public static IServiceCollection AddCalendars(this IServiceCollection services, ConfigCipher? configKey)
    {
        services.AddSingleton<ICalendarStore, global::PeckList.Storage.Sql.SqlCalendarStore>();
        services.AddSingleton<ICalendarSecrets>(provider => new CalendarSecrets(provider.GetRequiredService<ISecretStore>(), configKey));
        services.AddSingleton<CalendarInstance>();
        services.AddSingleton<CalendarNudges>();
        services.AddSingleton<InProcessChangeNotifier>();
        services.AddSingleton<IChangeNotifier>(provider => new CalendarNudgingNotifier(
            provider.GetRequiredService<InProcessChangeNotifier>(), provider.GetRequiredService<CalendarNudges>()));
        // CalDAV, through its own HttpClient only: the network policy refuses private and local
        // addresses unless CALENDAR_CALDAV_PRIVATE_NETWORK is on, read live on each new connection.
        services.AddSingleton<ICalendarProvider>(provider =>
        {
            var live = provider.GetRequiredService<LiveSettings>();
            var policy = new CalDavNetworkPolicy(() => live.Current.CalendarCalDavPrivateNetwork);
            return new CalDavCalendarProvider(CalDavCalendarProvider.CreateHttpClient(policy), provider.GetRequiredService<TimeProvider>());
        });
        // Google: the built-in PeckList client, or an admin's own read live (CALENDAR_GOOGLE_CLIENT_*).
        services.AddSingleton<IGoogleClients>(provider => new ServerGoogleClients(provider.GetRequiredService<LiveSettings>(), GoogleDefaults.BuiltIn()));
        services.AddSingleton(provider => new GoogleCalendarProvider(
            GoogleCalendarProvider.CreateHttpClient(), provider.GetRequiredService<IGoogleClients>(), provider.GetRequiredService<TimeProvider>()));
        services.AddSingleton<ICalendarProvider>(provider => provider.GetRequiredService<GoogleCalendarProvider>());
        services.AddSingleton<GoogleConnect>();
        services.AddSingleton<CalendarChannels>();
        services.AddSingleton(provider => new CalendarSync(
            provider.GetRequiredService<ICalendarStore>(),
            provider.GetServices<ICalendarProvider>(),
            provider.GetRequiredService<ICalendarSecrets>(),
            provider.GetRequiredService<Core.Storage.IEntityStore>(),
            provider.GetRequiredService<SyncService>(),
            provider.GetRequiredService<Core.Sharing.SharingState>(),
            provider.GetRequiredService<ServerClock>(),
            provider.GetRequiredService<CalendarInstance>(),
            provider.GetRequiredService<TimeProvider>(),
            async (userId, cancellation) =>
            {
                var zone = await Push.DeviceZones.ZoneForAsync(
                    provider.GetRequiredService<Core.Sharing.SharingState>().Index, userId,
                    provider.GetRequiredService<Core.Push.IPushStore>(), provider.GetRequiredService<ServerSettings>(), cancellation);
                if (zone.HasIanaId) return zone.Id;
                return TimeZoneInfo.TryConvertWindowsIdToIanaId(zone.Id, out var iana) ? iana : "UTC";
            })
        {
            // The type only: messages can quote what a calendar server sent (as RunLoggedAsync).
            SalvageFailed = error => provider.GetRequiredService<ILogger<CalendarSync>>().LogWarning(
                "A calendar run cut short could not save what it had written: {Error}", error.GetType().FullName),
        });
        services.AddSingleton<CalendarRuns>();
        services.AddHostedService(provider => provider.GetRequiredService<CalendarRuns>());
        return services;
    }
}
