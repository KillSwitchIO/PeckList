using System.Text.Json.Nodes;
using PeckList.Core.Push;
using PeckList.Core.Sharing;

namespace PeckList.Server.Push;

/// <summary>
/// The snooze rules, in one place for every way in (audit B3, 0.14.0): a reminder's button in the
/// apps (<c>/api/reminders/act</c>) and the task API's snooze route (PL-119, for Home Assistant and
/// the CLI). A snooze is the person's own: the task is not changed, it comes back for them alone,
/// and a new one of the same reminder replaces the last.
/// </summary>
public static class ReminderSnoozes
{
    /// <summary>How long Snooze puts a reminder off when nothing says (the app's SNOOZE_MINUTES).</summary>
    public const int DefaultMinutes = 10;

    /// <summary>The longest snooze: "tomorrow morning" from late at night is more than a day.</summary>
    public const int MaxMinutes = 7 * 24 * 60;

    /// <summary>
    /// The person's snoozes still to come or just come back (a constant reminder's repeats of it
    /// still running), as <c>/api/reminders/snoozes</c> lists them: only on
    /// tasks whose reminders are still theirs, where the snooze holds (open, a reminder left, the
    /// same occurrence), the latest of each reminder, and none a later snooze put off (come back and
    /// snoozed again).
    /// </summary>
    public static async Task<List<(ReminderSnooze Snooze, JsonObject Task)>> ComingAsync(
        string userId, SharingIndex index, IPushStore store, TimeZoneInfo zone, DateTimeOffset now, CancellationToken cancellation)
    {
        var snoozes = await store.SnoozesAsync(now - ServerReminders.RepeatsLast, now + ServerReminders.SnoozesAhead, userId, cancellation);
        var holding = new List<(ReminderSnooze Snooze, JsonObject Task)>();
        foreach (var each in snoozes)
        {
            if (index.LiveDocOf(each.TaskId, "tasks") is not { } task || !ServerReminders.SnoozeHolds(task, each, zone)
                || !ServerReminders.Recipients(task, index).Contains(userId)) continue;
            holding.Add((each, task));
        }
        var latest = ServerReminders.LatestPerReminder(holding, each => each.Snooze).ToList();
        var pressed = latest.GroupBy(each => each.Snooze.TaskId, StringComparer.Ordinal)
            .ToDictionary(group => group.Key, group => ServerReminders.Pressed(group.Select(each => each.Snooze)), StringComparer.Ordinal);
        return [.. latest.Where(each => !pressed[each.Snooze.TaskId].Contains(each.Snooze.At))];
    }

    /// <summary>
    /// Puts off, for <paramref name="userId"/>, the reminder of the task first due at
    /// <paramref name="first"/> (null: none named): a constant reminder's repeats of it stop
    /// (<see cref="StopRepeatsAsync"/>), and it comes again as <see cref="PutOffAsync"/> says.
    /// Answers when it comes again.
    /// </summary>
    public static async Task<DateTimeOffset> SnoozeAsync(
        IPushStore store, string userId, string taskId, JsonObject task, DateTimeOffset? first, int minutes,
        DateTimeOffset now, CancellationToken cancellation)
    {
        if (first is { } pressed) await StopRepeatsAsync(store, userId, taskId, pressed, now, cancellation);
        return await PutOffAsync(store, userId, taskId, task, first, minutes, now, cancellation);
    }

    /// <summary>
    /// Stops a constant reminder's repeats of the reminder first due at <paramref name="first"/>,
    /// for <paramref name="userId"/>: what Dismiss does, and Snooze before it puts the reminder off.
    /// </summary>
    public static async Task StopRepeatsAsync(
        IPushStore store, string userId, string taskId, DateTimeOffset first, DateTimeOffset now, CancellationToken cancellation)
    {
        var tag = $"{taskId}@{first.ToUnixTimeMilliseconds()}";
        for (var again = 1; again < ServerReminders.ConstantTimes; again++)
        {
            var at = first + again * ServerReminders.ConstantEvery;
            await store.MarkReminderSentAsync($"{userId}|{tag}#{at.ToUnixTimeMilliseconds()}", now, cancellation);
        }
    }

    /// <summary>
    /// The snooze itself, its repeats already stopped: the reminder comes again
    /// <paramref name="minutes"/> from now (1 to <see cref="MaxMinutes"/>), on the minute as a
    /// reminder's set time is, so the apps' keys for it agree, replacing the person's last snooze of
    /// it. Answers when it comes again.
    /// </summary>
    public static async Task<DateTimeOffset> PutOffAsync(
        IPushStore store, string userId, string taskId, JsonObject task, DateTimeOffset? first, int minutes,
        DateTimeOffset now, CancellationToken cancellation)
    {
        var later = now.AddMinutes(Math.Clamp(minutes, 1, MaxMinutes));
        var comes = later.AddTicks(-(later.UtcTicks % TimeSpan.TicksPerMinute));
        await store.SnoozeAsync(userId, taskId, comes, ServerReminders.Occurrence(task), first, cancellation);
        return comes;
    }
}
