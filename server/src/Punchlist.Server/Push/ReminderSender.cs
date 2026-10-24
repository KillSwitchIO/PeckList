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
    ILogger<ReminderSender> logger) : BackgroundService
{
    public static readonly TimeSpan Every = TimeSpan.FromSeconds(30);

    /// <summary>On start, reminders due this long ago still go out (a restart or an update).</summary>
    public static readonly TimeSpan CatchUp = TimeSpan.FromMinutes(5);

    protected override async Task ExecuteAsync(CancellationToken stopping)
    {
        var since = time.GetUtcNow() - CatchUp;
        while (!stopping.IsCancellationRequested)
        {
            var now = time.GetUtcNow();
            try
            {
                await SendDueAsync(since, now, stopping);
                await store.PruneSentRemindersAsync(now - TimeSpan.FromDays(7), stopping);
                since = now;
            }
            catch (Exception error) when (error is not OperationCanceledException)
            {
                logger.LogWarning(error, "Sending reminders failed; trying again shortly");
            }
            await Task.Delay(Every, time, stopping);
        }
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
                foreach (var at in ServerReminders.Instants(task, zone))
                {
                    if (at <= from || at > to) continue;
                    var tag = $"{taskId}@{at.ToUnixTimeMilliseconds()}";
                    if (!await store.MarkReminderSentAsync($"{userId}|{tag}", to, cancellation)) continue;
                    await notifications.AddAsync([new Notification
                    {
                        Id = Ids.NewUlid(time),
                        UserId = userId,
                        Kind = NotificationKind.Reminder,
                        At = at,
                        TaskId = taskId,
                        ListId = (string?)task["listId"],
                    }], cancellation);
                    var title = (string?)task["title"] is { Length: > 0 } named ? named : "Untitled task";
                    await push.SendAsync(userId, new PushPayload(title, $"Reminder for {Clock(at, zone, mine)}", tag, $"/today?task={taskId}"), cancellation);
                }
            }
        }
    }

    private static TimeZoneInfo ZoneOf(JsonObject? settings)
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
