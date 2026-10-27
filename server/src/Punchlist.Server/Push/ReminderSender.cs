using System.Globalization;
using System.Text.Json.Nodes;
using Punchlist.Core;
using Punchlist.Core.Notifications;
using Punchlist.Core.Push;
using Punchlist.Core.Sharing;

namespace Punchlist.Server.Push;

/// <summary>
/// Sends reminders from the server (spec: PL-061), so they arrive with the app closed: every half
/// minute it looks for reminders that came due, and each person gets each one once, as a
/// notification and a push. Times follow the person's time zone setting, else the server's.
/// </summary>
public sealed class ReminderSender(
    SharingState sharing,
    IPushStore store,
    INotificationStore notifications,
    IPushSender push,
    TimeProvider time,
    ILogger<ReminderSender> logger)
    : PeriodicService("Sending reminders", TimeSpan.Zero, Every, time, logger, LogLevel.Warning)
{
    public static readonly TimeSpan Every = TimeSpan.FromSeconds(30);

    /// <summary>On start, reminders due this long ago still go out (a restart or an update).</summary>
    public static readonly TimeSpan CatchUp = TimeSpan.FromMinutes(5);

    /// <summary>Where the last run got to; the next sends what came due since.</summary>
    private DateTimeOffset? since;

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
        var index = sharing.Index;
        var settings = index.LiveOf("settings")
            .Select(each => each.Doc)
            .Where(doc => doc["userId"] is JsonValue)
            .GroupBy(doc => (string)doc["userId"]!)
            .ToDictionary(group => group.Key, group => group.First(), StringComparer.Ordinal);
        foreach (var (taskId, _, task) in index.LiveOf("tasks"))
        {
            if (task["reminders"] is not JsonArray { Count: > 0 } || (string?)task["status"] != "open") continue;
            foreach (var userId in ServerReminders.Recipients(task, index))
            {
                var mine = settings.GetValueOrDefault(userId);
                var zone = ZoneOf(mine);
                foreach (var (at, first, constant) in ServerReminders.Instants(task, zone))
                {
                    if (at <= from || at > to) continue;
                    // Repeats share the first one's tag (each replaces the last), but go once each.
                    var tag = $"{taskId}@{first.ToUnixTimeMilliseconds()}";
                    var sent = at == first ? tag : $"{tag}#{at.ToUnixTimeMilliseconds()}";
                    if (!await store.MarkReminderSentAsync($"{userId}|{sent}", to, cancellation)) continue;
                    var payload = new PushPayload(TitleOf(task), $"Reminder for {Clock(first, zone, mine)}", tag, $"/today?task={taskId}", constant);
                    if (at != first)
                    {
                        await push.SendAsync(userId, payload, cancellation);
                        continue;
                    }
                    await notifications.AddAsync([new Notification
                    {
                        Id = Ids.NewUlid(Time),
                        UserId = userId,
                        Kind = NotificationKind.Reminder,
                        At = at,
                        TaskId = taskId,
                        ListId = (string?)task["listId"],
                    }], cancellation);
                    await push.SendAsync(userId, payload, cancellation);
                }
            }
        }
    }

    /// <summary>
    /// A person's reminders in (<paramref name="from"/>, <paramref name="to"/>], soonest first.
    /// <paramref name="deviceZone"/> stands in when they set no time zone.
    /// </summary>
    public static IReadOnlyList<Upcoming> UpcomingFor(SharingIndex index, string userId, DateTimeOffset from, DateTimeOffset to, string? deviceZone)
    {
        var mine = SettingsOf(index, userId);
        var zone = mine?["timeZone"] is JsonValue ? ZoneOf(mine)
            : deviceZone is not null && TimeZoneInfo.TryFindSystemTimeZoneById(deviceZone, out var device) ? device
            : TimeZoneInfo.Local;
        var found = new List<Upcoming>();
        foreach (var (taskId, _, task) in index.LiveOf("tasks"))
        {
            if (task["reminders"] is not JsonArray { Count: > 0 } || (string?)task["status"] != "open") continue;
            if (!ServerReminders.Recipients(task, index).Contains(userId)) continue;
            var title = TitleOf(task);
            var repeats = (string?)task["recurrence"] is { Length: > 0 };
            foreach (var (at, first, constant) in ServerReminders.Instants(task, zone))
            {
                if (at <= from || at > to) continue;
                var tag = $"{taskId}@{first.ToUnixTimeMilliseconds()}";
                var again = (int)((at - first) / ServerReminders.ConstantEvery);
                found.Add(new Upcoming(again == 0 ? tag : $"{tag}#{again}", title,
                    $"Reminder for {Clock(first, zone, mine)}", at, $"/today?task={taskId}", constant, repeats));
            }
        }
        return [.. found.OrderBy(each => each.At)];
    }

    /// <summary>A person's settings entity (time zone, clock format), if they have one.</summary>
    internal static JsonObject? SettingsOf(SharingIndex index, string userId) =>
        index.LiveOf("settings")
            .Select(each => each.Doc)
            .FirstOrDefault(doc => doc["userId"] is JsonValue owner && owner.TryGetValue<string>(out var id) && id == userId);

    private static string TitleOf(JsonObject task) => (string?)task["title"] is { Length: > 0 } named ? named : "Untitled task";

    internal static TimeZoneInfo ZoneOf(JsonObject? settings)
    {
        if (settings?["timeZone"] is JsonValue value && value.TryGetValue<string>(out var name)
            && TimeZoneInfo.TryFindSystemTimeZoneById(name, out var zone))
        {
            return zone;
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
