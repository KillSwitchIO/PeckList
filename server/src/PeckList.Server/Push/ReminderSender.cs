using System.Globalization;
using System.Text.Json.Nodes;
using PeckList.Core;
using PeckList.Core.Configuration;
using PeckList.Core.Notifications;
using PeckList.Core.Push;
using PeckList.Core.Sharing;
using PeckList.Core.Sync;

namespace PeckList.Server.Push;

/// <summary>
/// Sends reminders from the server (spec: PL-061), so they arrive with the app closed: every half
/// minute it looks for reminders that came due, and each person gets each one once, as a
/// notification and a push. Times follow the person's zone (<see cref="ZoneOf"/>).
/// </summary>
public sealed class ReminderSender(
    SharingState sharing,
    IPushStore store,
    ServerSettings server,
    INotificationStore notifications,
    IPushSender push,
    TimeProvider time,
    ILogger<ReminderSender> logger,
    Core.Sync.IChangeNotifier notifier)
    : PeriodicService("Sending reminders", TimeSpan.Zero, Every, time, logger, LogLevel.Warning)
{
    public static readonly TimeSpan Every = TimeSpan.FromSeconds(30);

    /// <summary>On start, reminders due this long ago still go out (a restart or an update).</summary>
    public static readonly TimeSpan CatchUp = TimeSpan.FromMinutes(5);

    /// <summary>Where the last run got to; the next sends what came due since.</summary>
    private DateTimeOffset? since;

    /// <summary>Each person's zone at the last run, to see it move (a trip, a new pick).</summary>
    private readonly Dictionary<string, string> zonesBefore = new(StringComparer.Ordinal);

    /// <summary>Task and person pairs whose failure was logged as a warning; after that, only at Debug.</summary>
    private readonly HashSet<string> failuresLogged = new(StringComparer.Ordinal);

    /// <summary>
    /// A reminder as a person sees it, for the Android app to set ahead. <paramref name="Key"/> is the
    /// web app's key for it (web/src/core/reminders.ts): taskId@first, and #n on a constant
    /// reminder's repeats, so the app's alarm ids agree whichever side set them.
    /// </summary>
    public sealed record Upcoming(string Key, string Title, string Body, DateTimeOffset At, string Url, bool Constant, bool Repeats);

    protected override async Task RunAsync(CancellationToken stopping)
    {
        var now = Time.GetUtcNow();
        await SendDueAsync(since ?? now - CatchUp, now, stopping);
        await store.PruneSentRemindersAsync(now - TimeSpan.FromDays(7), stopping);
        since = now;
    }

    /// <summary>Reminders due in (<paramref name="from"/>, <paramref name="to"/>]: sent, and noted so they go once.</summary>
    public async Task SendDueAsync(DateTimeOffset from, DateTimeOffset to, CancellationToken cancellation = default)
    {
        // Reminders due while the index loads go out once it is in (the first run catches up).
        await sharing.Loaded.WaitAsync(cancellation);
        var index = sharing.Index;
        var settings = SettingsByUser(index);
        var devices = server.TimeZoneChosen ? new Dictionary<string, string>() : await store.DeviceZonesAsync(cancellation);
        var zones = new Dictionary<string, (TimeZoneInfo Now, TimeZoneInfo? Before)>(StringComparer.Ordinal);
        (TimeZoneInfo Now, TimeZoneInfo? Before) ZonesOf(string userId)
        {
            if (zones.TryGetValue(userId, out var known)) return known;
            var now = ZoneOf(settings.GetValueOrDefault(userId), devices.GetValueOrDefault(userId), server.TimeZoneChosen);
            var before = zonesBefore.TryGetValue(userId, out var name) && name != now.Id
                && TimeZoneInfo.TryFindSystemTimeZoneById(name, out var was) ? was : null;
            return zones[userId] = (now, before);
        }
        foreach (var (taskId, _, task) in index.LiveTasksWithReminders())
        {
            if (task["reminders"] is not JsonArray { Count: > 0 } || (string?)task["status"] != "open") continue;
            foreach (var userId in ServerReminders.Recipients(task, index))
            {
                // A failure with one person's reminders for a task does not hold up anyone else's.
                try
                {
                    var mine = settings.GetValueOrDefault(userId);
                    if (!NotificationSwitches.Allows(mine, NotificationKind.Reminder)) continue;
                    var (zone, before) = ZonesOf(userId);
                    // Both zones give the same reminders in the same order, so the i-th is the same one.
                    var instants = ServerReminders.Instants(task, zone).ToList();
                    var earlier = before is null ? null : ServerReminders.Instants(task, before).ToList();
                    for (var i = 0; i < instants.Count; i++)
                    {
                        var (at, first, _) = instants[i];
                        // When the zone moved later (flying east), a reminder can now be due before this run
                        // while in the old zone no run had sent it yet (its old time is in this run or after):
                        // it goes now rather than never. Its repeats keep their new times.
                        var overtaken = earlier is not null && at == first && at <= from && earlier[i].At > from;
                        if (!overtaken && (at <= from || at > to)) continue;
                        await SendAsync(taskId, task, userId, instants[i], zone, mine, to, cancellation);
                    }
                }
                catch (Exception error) when (error is not OperationCanceledException)
                {
                    Failed(error, taskId, userId);
                }
            }
        }
        // Snoozes (audit B3): each for the one person who snoozed, while the task is open and theirs.
        foreach (var snooze in await store.SnoozesAsync(from - ServerReminders.RepeatsLast, to, cancellation: cancellation))
        {
            if (index.LiveDocOf(snooze.TaskId, "tasks") is not { } task || (string?)task["status"] != "open") continue;
            if (!ServerReminders.Recipients(task, index).Contains(snooze.UserId)) continue;
            try
            {
                var mine = settings.GetValueOrDefault(snooze.UserId);
                if (!NotificationSwitches.Allows(mine, NotificationKind.Reminder)) continue;
                var (zone, _) = ZonesOf(snooze.UserId);
                foreach (var time in ServerReminders.Snoozed(task, snooze.At))
                {
                    if (time.At <= from || time.At > to) continue;
                    await SendAsync(snooze.TaskId, task, snooze.UserId, time, zone, mine, to, cancellation);
                }
            }
            catch (Exception error) when (error is not OperationCanceledException)
            {
                Failed(error, snooze.TaskId, snooze.UserId);
            }
        }
        foreach (var (userId, (zone, _)) in zones) zonesBefore[userId] = zone.Id;
    }

    /// <summary>One time a reminder fires, for one person: once, as a notification (the first time) and a push.</summary>
    private async Task SendAsync(
        string taskId, JsonObject task, string userId, ReminderTime time, TimeZoneInfo zone, JsonObject? mine, DateTimeOffset now,
        CancellationToken cancellation)
    {
        var (at, first, constant) = time;
        // Repeats share the first one's tag (each replaces the last), but go once each.
        var tag = $"{taskId}@{first.ToUnixTimeMilliseconds()}";
        var sent = at == first ? tag : $"{tag}#{at.ToUnixTimeMilliseconds()}";
        if (!await store.MarkReminderSentAsync($"{userId}|{sent}", now, cancellation)) return;
        var payload = new PushPayload(TitleOf(task), $"Reminder for {Clock(first, zone, mine)}", tag, $"/today?task={taskId}", constant);
        if (at == first)
        {
            var made = new Notification
            {
                Id = Ids.NewUlid(Time),
                UserId = userId,
                Kind = NotificationKind.Reminder,
                At = at,
                TaskId = taskId,
                ListId = (string?)task["listId"],
            };
            await notifications.AddAsync([made], cancellation);
            // Open streams hear at once: a Home Assistant automation can say the reminder aloud.
            Core.Sync.InProcessChangeNotifier.Notify(notifier, [made]);
        }
        await push.SendAsync(userId, payload, cancellation);
    }

    /// <summary>Each run tries again, so a lasting failure warns once and then only shows at Debug.</summary>
    private void Failed(Exception error, string taskId, string userId)
    {
        var level = failuresLogged.Add($"{taskId}|{userId}") ? LogLevel.Warning : LogLevel.Debug;
        Logger.Log(level, error, "Could not send the reminders of task {Task} for person {User}", taskId, userId);
    }

    /// <summary>
    /// A person's reminders in (<paramref name="from"/>, <paramref name="to"/>], soonest first, in
    /// their zone by <see cref="ZoneOf"/>, with <paramref name="deviceZone"/> as the device's.
    /// </summary>
    /// <paramref name="snoozes"/>: the person's snoozes (audit B3), which come as reminders do.
    public static IReadOnlyList<Upcoming> UpcomingFor(
        SharingIndex index, string userId, DateTimeOffset from, DateTimeOffset to, string? deviceZone, bool serverZoneChosen,
        IReadOnlyCollection<ReminderSnooze>? snoozes = null)
    {
        var mine = SettingsOf(index, userId);
        if (!NotificationSwitches.Allows(mine, NotificationKind.Reminder)) return [];
        var zone = ZoneOf(mine, deviceZone, serverZoneChosen);
        var found = new List<Upcoming>();
        foreach (var (taskId, _, task) in index.LiveTasksWithReminders())
        {
            if (task["reminders"] is not JsonArray { Count: > 0 } || (string?)task["status"] != "open") continue;
            if (!ServerReminders.Recipients(task, index).Contains(userId)) continue;
            Add(taskId, task, ServerReminders.Instants(task, zone));
        }
        foreach (var snooze in snoozes ?? [])
        {
            if (snooze.UserId != userId || index.LiveDocOf(snooze.TaskId, "tasks") is not { } task) continue;
            if ((string?)task["status"] != "open" || !ServerReminders.Recipients(task, index).Contains(userId)) continue;
            Add(snooze.TaskId, task, ServerReminders.Snoozed(task, snooze.At));
        }
        // A snooze at a time one of the task's reminders already has is that reminder.
        return [.. found.DistinctBy(each => each.Key).OrderBy(each => each.At)];

        void Add(string taskId, JsonObject task, IEnumerable<ReminderTime> times)
        {
            var title = TitleOf(task);
            var repeats = (string?)task["recurrence"] is { Length: > 0 };
            foreach (var (at, first, constant) in times)
            {
                if (at <= from || at > to) continue;
                var tag = $"{taskId}@{first.ToUnixTimeMilliseconds()}";
                var again = (int)((at - first) / ServerReminders.ConstantEvery);
                found.Add(new Upcoming(again == 0 ? tag : $"{tag}#{again}", title,
                    $"Reminder for {Clock(first, zone, mine)}", at, $"/today?task={taskId}", constant, repeats));
            }
        }
    }

    /// <summary>A person's settings entity (time zone, clock format), if they have one.</summary>
    internal static JsonObject? SettingsOf(SharingIndex index, string userId) => SettingsByUser(index).GetValueOrDefault(userId);

    /// <summary>
    /// Each person's settings: only an entity they wrote themselves that names them (one written by
    /// someone else cannot set their time zone, audit S3), and of two, the one changed last (C7: a
    /// device that joined before the account had settings leaves a second one).
    /// </summary>
    private static Dictionary<string, JsonObject> SettingsByUser(SharingIndex index) =>
        index.LiveOf("settings")
            .Where(each => each.Doc["userId"] is JsonValue named && named.TryGetValue<string>(out var id) && id == each.Owner)
            .GroupBy(each => each.Owner, StringComparer.Ordinal)
            .ToDictionary(
                group => group.Key,
                group => group.OrderByDescending(each => LastChange(each.Doc), Comparer<string?>.Create(Hlc.Compare)).ThenBy(each => each.Id, StringComparer.Ordinal).First().Doc,
                StringComparer.Ordinal);

    private static string? LastChange(JsonObject doc) =>
        doc["_hlc"] is JsonObject clocks
            ? clocks.Select(pair => (string?)pair.Value).Where(Hlc.IsValid).Max(Comparer<string?>.Create(Hlc.Compare))
            : null;

    private static string TitleOf(JsonObject task) => (string?)task["title"] is { Length: > 0 } named ? named : "Untitled task";

    /// <summary>
    /// The zone the server works in for a person, in the apps' order (Device Time Zone Design): their
    /// pick under Settings, else the server's when the operator set TZ, else the zone their apps last
    /// reported (<paramref name="deviceZone"/>), else the server's own. A name the server does not know
    /// falls to the next.
    /// </summary>
    internal static TimeZoneInfo ZoneOf(JsonObject? settings, string? deviceZone, bool serverZoneChosen)
    {
        if (settings?["timeZone"] is JsonValue value && value.TryGetValue<string>(out var name)
            && TimeZoneInfo.TryFindSystemTimeZoneById(name, out var picked))
        {
            return picked;
        }
        if (!serverZoneChosen && deviceZone is not null && TimeZoneInfo.TryFindSystemTimeZoneById(deviceZone, out var device))
        {
            return device;
        }
        return TimeZoneInfo.Local;
    }

    /// <summary>The time as the person's clock shows it: "9:30 AM", or "09:30" on a 24-hour clock.</summary>
    private static string Clock(DateTimeOffset at, TimeZoneInfo zone, JsonObject? settings)
    {
        var local = TimeZoneInfo.ConvertTime(at, zone);
        return (string?)settings?["clockFormat"] == "24h"
            ? local.ToString("HH:mm", CultureInfo.InvariantCulture)
            : local.ToString("h:mm tt", CultureInfo.InvariantCulture);
    }
}
