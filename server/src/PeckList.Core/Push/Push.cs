using System.Globalization;
using System.Text.Json.Nodes;
using PeckList.Core.Sharing;

namespace PeckList.Core.Push;

/// <summary>A browser's Web Push subscription (spec: PL-061): where to send, and its keys.</summary>
public sealed record PushSubscription(string UserId, string Endpoint, string P256dh, string Auth);

public interface IPushStore
{
    /// <summary>Add or move a subscription (an endpoint belongs to one person at a time).</summary>
    Task SaveAsync(PushSubscription subscription, CancellationToken cancellation = default);

    Task<IReadOnlyList<PushSubscription>> ForUserAsync(string userId, CancellationToken cancellation = default);

    Task RemoveAsync(string endpoint, CancellationToken cancellation = default);

    /// <summary>All of a person's subscriptions go, and the zone their apps reported (account removal).</summary>
    Task RemoveUserAsync(string userId, CancellationToken cancellation = default);

    /// <summary>The zone a person's apps report (the device's own), replacing the last one.</summary>
    Task SetDeviceZoneAsync(string userId, string zone, CancellationToken cancellation = default);

    /// <summary>A person's last reported zone, if their apps reported one.</summary>
    Task<string?> DeviceZoneAsync(string userId, CancellationToken cancellation = default);

    /// <summary>Every person's last reported zone, by user id.</summary>
    Task<IReadOnlyDictionary<string, string>> DeviceZonesAsync(CancellationToken cancellation = default);

    /// <summary>Note a reminder as sent; false when it already was (so it goes out once).</summary>
    Task<bool> MarkReminderSentAsync(string key, DateTimeOffset at, CancellationToken cancellation = default);

    /// <summary>Forget sent reminders older than <paramref name="before"/>.</summary>
    Task PruneSentRemindersAsync(DateTimeOffset before, CancellationToken cancellation = default);
}

/// <summary>
/// Reminders on the server (spec: PL-061), the same rules as the app (web/src/core/reminders.ts):
/// minutes before the task's start (else its due date; an all-day date counts from 9:00), or a set
/// local date-time; for its assignees, or its maker when nobody is assigned.
/// </summary>
/// <summary>One time a reminder fires: <paramref name="At"/>, for the reminder due at <paramref name="First"/>.</summary>
public readonly record struct ReminderTime(DateTimeOffset At, DateTimeOffset First, bool Constant);

public static class ServerReminders
{
    public static readonly TimeSpan AllDayTime = TimeSpan.FromHours(9);

    /// <summary>A constant reminder (spec: R-FB-60) comes again this often, this many times in all.</summary>
    public static readonly TimeSpan ConstantEvery = TimeSpan.FromMinutes(5);
    public const int ConstantTimes = 6;

    /// <summary>
    /// When the task's reminders fire, in the given time zone: each one, and for a constant reminder
    /// its repeats too (<see cref="ReminderTime.First"/> is the reminder each belongs to).
    /// </summary>
    public static IEnumerable<ReminderTime> Instants(JsonObject task, TimeZoneInfo zone)
    {
        var constant = task["constantReminder"] is JsonValue flag && flag.TryGetValue<bool>(out var on) && on;
        foreach (var first in FirstInstants(task, zone))
        {
            for (var again = 0; again < (constant ? ConstantTimes : 1); again++)
            {
                yield return new ReminderTime(first + again * ConstantEvery, first, constant);
            }
        }
    }

    private static IEnumerable<DateTimeOffset> FirstInstants(JsonObject task, TimeZoneInfo zone)
    {
        if (task["reminders"] is not JsonArray reminders) yield break;
        var anchor = Text(task["schedule"]?["start"]) ?? Text(task["due"]?["at"]);
        foreach (var reminder in reminders.OfType<JsonObject>())
        {
            if (Text(reminder["at"]) is { } at)
            {
                if (Local(at) is { } set) yield return InZone(set, zone);
            }
            else if (reminder["before"] is JsonValue before && before.TryGetValue<int>(out var minutes) && anchor is not null
                && Local(anchor) is { } start)
            {
                yield return InZone(start, zone) - TimeSpan.FromMinutes(minutes);
            }
        }
    }

    /// <summary>Who a task's reminders are for: its assignees (groups as their people), else its maker.</summary>
    public static IReadOnlyCollection<string> Recipients(JsonObject task, SharingIndex index)
    {
        var people = new HashSet<string>(StringComparer.Ordinal);
        if (task["assignees"] is JsonObject assignees)
        {
            foreach (var (principal, state) in assignees)
            {
                if (state?["in"] is JsonValue value && value.TryGetValue<bool>(out var isIn) && isIn) people.UnionWith(index.PeopleOf(principal));
            }
        }
        if (people.Count == 0 && Text(task["createdBy"]) is { } maker) people.Add(maker);
        // Never someone who cannot see the task (a maker since moved out of its list, audit S3).
        if (Text(task["id"]) is { } id) people.IntersectWith(index.Viewers(id));
        return people;
    }

    /// <summary>A local date (all day: 9:00) or date-time, without a zone.</summary>
    private static DateTime? Local(string value)
    {
        string[] formats = ["yyyy-MM-dd'T'HH:mm", "yyyy-MM-dd'T'HH:mm:ss", "yyyy-MM-dd"];
        if (!DateTime.TryParseExact(value, formats, CultureInfo.InvariantCulture, DateTimeStyles.None, out var parsed)) return null;
        return value.Length == 10 ? parsed + AllDayTime : parsed;
    }

    private static DateTimeOffset InZone(DateTime local, TimeZoneInfo zone)
    {
        var unspecified = DateTime.SpecifyKind(local, DateTimeKind.Unspecified);
        // A time the clocks skip (spring forward) happens an hour later.
        if (zone.IsInvalidTime(unspecified)) unspecified = unspecified.AddHours(1);
        return new DateTimeOffset(TimeZoneInfo.ConvertTimeToUtc(unspecified, zone), TimeSpan.Zero);
    }

    private static string? Text(JsonNode? node) => node is JsonValue value && value.TryGetValue<string>(out var text) ? text : null;
}
