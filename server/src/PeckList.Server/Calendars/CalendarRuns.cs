using System.Threading.Channels;
using PeckList.CalDav;
using PeckList.CalDav.Dav;
using PeckList.Core.Accounts;
using PeckList.Core.Calendars;
using PeckList.Core.Configuration;
using PeckList.Core.Sync;

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

/// <summary>People whose tasks just changed, so their synced calendars hear within seconds rather than at the next check.</summary>
public sealed class CalendarNudges
{
    private readonly Channel<string> people = Channel.CreateUnbounded<string>(new UnboundedChannelOptions { SingleReader = true });

    /// <summary>Ask for a run of this person's synced calendars soon.</summary>
    public void Nudge(string userId) => people.Writer.TryWrite(userId);

    /// <summary>Wait until someone is nudged.</summary>
    public ValueTask<bool> WaitAsync(CancellationToken cancellation) => people.Reader.WaitToReadAsync(cancellation);

    /// <summary>Everyone nudged since the last call.</summary>
    public HashSet<string> Drain()
    {
        var drained = new HashSet<string>(StringComparer.Ordinal);
        while (people.Reader.TryRead(out var person)) drained.Add(person);
        return drained;
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
    CalendarSync engine, ICalendarStore calendars, LiveSettings live, CalendarNudges nudges, TimeProvider time, ILogger<CalendarRuns> logger)
    : BackgroundService
{
    /// <summary>How long after a nudge the run starts, so a burst of edits makes one run.</summary>
    public static readonly TimeSpan Settle = TimeSpan.FromSeconds(10);

    private static readonly TimeSpan Tick = TimeSpan.FromSeconds(30);

    private readonly SemaphoreSlim gate = new(1, 1);

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
            // WhenAny never throws: a cancelled wait just ends it.
            await Task.WhenAny(nudged, ticked);
            if (stopping.IsCancellationRequested) return;
            if (nudged.IsCompletedSuccessfully) await Task.Delay(Settle, time, stopping).ConfigureAwait(ConfigureAwaitOptions.SuppressThrowing);
            var people = nudges.Drain();
            if (!live.Current.CalendarSync || stopping.IsCancellationRequested) continue;
            try
            {
                await RunDueAsync(people, stopping);
            }
            catch (Exception error) when (!stopping.IsCancellationRequested)
            {
                logger.LogError(error, "Calendar sync pass failed; trying again shortly");
            }
        }
    }

    /// <summary>Every link that is due: nudged synced links, and any link whose interval has passed; none still backing off.</summary>
    public async Task RunDueAsync(IReadOnlySet<string> nudged, CancellationToken cancellation)
    {
        var now = time.GetUtcNow();
        var every = TimeSpan.FromMinutes(live.Current.CalendarSyncMinutes);
        foreach (var link in await calendars.ActiveLinksAsync(cancellation))
        {
            if (link.NextAttempt is { } wait && wait > now) continue;
            var due = (link.Mode == CalendarModes.Sync && nudged.Contains(link.AccountId))
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
            if (run.Problem is { } problem) logger.LogWarning("Calendar link {Link} could not sync: {Problem}", linkId, problem);
            else if (run.Refused > 0) logger.LogInformation("Calendar link {Link}: {Refused} task changes refused by sharing rules", linkId, run.Refused);
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
            }));
        services.AddSingleton<CalendarRuns>();
        services.AddHostedService(provider => provider.GetRequiredService<CalendarRuns>());
        return services;
    }
}
