using System.Globalization;
using System.Text.Json.Nodes;
using PeckList.Core.Sharing;

namespace PeckList.Core.Push;

/// <summary>
/// A browser's Web Push subscription (spec: PL-061): where to send, and its keys.
/// <paramref name="Languages"/>: the languages the browser asked for when it subscribed (its
/// Accept-Language, PL-148), "de-DE,de,en"; null from before they were kept.
/// </summary>
public sealed record PushSubscription(string UserId, string Endpoint, string P256dh, string Auth, string? Languages = null);

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

    /// <summary>Forget sent reminders, and snoozes due, before <paramref name="before"/>.</summary>
    Task PruneSentRemindersAsync(DateTimeOffset before, CancellationToken cancellation = default);

    /// <summary>
    /// A person's reminder for a task, put off to <paramref name="at"/> for them alone (audit B3).
    /// <paramref name="occurrence"/>: the task's date it was snoozed on (<see cref="ServerReminders.Occurrence"/>).
    /// <paramref name="first"/>: the reminder it was pressed on, by its first time (0.14.0; null when
    /// the press named none). With one, it replaces that person's snooze of the same reminder (task,
    /// occurrence and first), in one write: snoozed again before the last came back, both came.
    /// </summary>
    Task SnoozeAsync(
        string userId, string taskId, DateTimeOffset at, string? occurrence, DateTimeOffset? first = null, CancellationToken cancellation = default);

    /// <summary>Everyone's snoozes due in (<paramref name="from"/>, <paramref name="to"/>], or only <paramref name="userId"/>'s.</summary>
    Task<IReadOnlyList<ReminderSnooze>> SnoozesAsync(DateTimeOffset from, DateTimeOffset to, string? userId = null, CancellationToken cancellation = default);
}

/// <summary>
/// A reminder <paramref name="UserId"/> snoozed: it comes again for them at <paramref name="At"/>.
/// <paramref name="Occurrence"/>: the task's date when it was snoozed, null on a snooze from before
/// it was kept (or on a task with no date). <paramref name="First"/>: the reminder it was pressed on,
/// by its first time (the task's own, or an earlier snooze's), null from before 0.14.0 or a press that
/// named none.
/// </summary>
public sealed record ReminderSnooze(string UserId, string TaskId, DateTimeOffset At, string? Occurrence = null, DateTimeOffset? First = null);

/// <summary>
/// Reminders on the server (spec: PL-061), the same rules as the app (web/src/core/reminders.ts):
/// minutes before the task's start (else its due date; a timed one on its own zone's clock, an all-day
/// date from 9:00 where the person is), or a set local date-time where the person is; for its
/// assignees, or its maker when nobody is assigned.
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
    public static IEnumerable<ReminderTime> Instants(JsonObject task, TimeZoneInfo zone) =>
        FirstInstants(task, zone).SelectMany(first => Snoozed(task, first));

    /// <summary>
    /// When a reminder of the task due at <paramref name="first"/> fires: then, and on a constant
    /// reminder its repeats. A snooze (audit B3) comes back this way, as a reminder set for then would.
    /// </summary>
    public static IEnumerable<ReminderTime> Snoozed(JsonObject task, DateTimeOffset first)
    {
        var constant = task["constantReminder"] is JsonValue flag && flag.TryGetValue<bool>(out var on) && on;
        for (var again = 0; again < (constant ? ConstantTimes : 1); again++)
        {
            yield return new ReminderTime(first + again * ConstantEvery, first, constant);
        }
    }

    /// <summary>
    /// The occurrence a snooze is for: the moment the task's reminders count from (its start, else
    /// its due date, as the app's occurrenceOf). A timed date is a moment written on its own zone's
    /// clock, which the app moves to the viewer's as it shows it (spec: PL-020), so it is kept as UTC
    /// ("yyyy-MM-ddTHH:mmZ") and the two agree; a whole day is the same date everywhere, and a time
    /// with no zone stays as written.
    /// </summary>
    public static string? Occurrence(JsonObject task)
    {
        var (dated, at) = Dated(task);
        if (at is null) return null;
        if (at.Length <= 10 || Local(at) is not { } local || OwnZone(dated!) is not { } zone) return at;
        return InZone(local, zone).UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm", CultureInfo.InvariantCulture) + "Z";
    }

    /// <summary>
    /// The first moment the task's current occurrence reminds: the earliest of its reminders, one
    /// counted from its date read as <see cref="Occurrence"/> reads it (a timed date on its own zone's
    /// clock, a whole day from 9:00 where the person is), a set time where the person is. Null when it
    /// has none that counts from its date (no date, or only set times, which do not move with it). A
    /// press of a reminder from before this is for an occurrence already gone.
    /// </summary>
    public static DateTimeOffset? OccurrenceStart(JsonObject task, TimeZoneInfo personZone)
    {
        if (task["reminders"] is not JsonArray reminders || Start(task, personZone) is not { } start) return null;
        DateTimeOffset? fromDate = null, setTime = null;
        foreach (var reminder in reminders.OfType<JsonObject>())
        {
            if (Text(reminder["at"]) is { } set && Local(set) is { } setLocal)
            {
                var when = InZone(setLocal, personZone);
                if (setTime is null || when < setTime) setTime = when;
            }
            else if (reminder["before"] is JsonValue before && before.TryGetValue<int>(out var minutes))
            {
                var when = start - TimeSpan.FromMinutes(minutes);
                if (fromDate is null || when < fromDate) fromDate = when;
            }
        }
        if (fromDate is not { } first) return null;
        return setTime is { } earlier && earlier < first ? earlier : first;
    }

    /// <summary>
    /// The task's own date as its reminders name it (Ben, 0.14.0-rc.1: "the time of the event, not
    /// the time of the reminder"): the date they count from (<see cref="Dated"/>), whether that is its
    /// start, and its day and time where the person is. A timed date is the moment <see cref="Start"/>
    /// reads, shown on the person's clock as the app shows it; a whole day has no time and is the same
    /// date everywhere. The current occurrence's, since a repeating task carries its next date. Null
    /// when the task has no date.
    /// </summary>
    public static (bool Starts, DateOnly Day, TimeOnly? Time)? TaskDate(JsonObject task, TimeZoneInfo personZone)
    {
        var (dated, at) = Dated(task);
        if (at is null || Local(at) is not { } local) return null;
        var starts = ReferenceEquals(dated, task["schedule"]);
        if (at.Length <= 10) return (starts, DateOnly.FromDateTime(local), null);
        var shown = TimeZoneInfo.ConvertTime(InZone(local, OwnZone(dated!) is { } own ? own : personZone), personZone).DateTime;
        return (starts, DateOnly.FromDateTime(shown), TimeOnly.FromDateTime(shown));
    }

    /// <summary>The date the task's reminders count from: its start, else its due date, with the object holding it.</summary>
    private static (JsonObject? Of, string? At) Dated(JsonObject task) =>
        task["schedule"] is JsonObject schedule && Text(schedule["start"]) is { } start ? (schedule, start)
        : task["due"] is JsonObject due && Text(due["at"]) is { } at ? (due, at)
        : (null, null);

    private static TimeZoneInfo? OwnZone(JsonObject dated) =>
        Text(dated["timeZone"]) is { } name && TimeZoneInfo.TryFindSystemTimeZoneById(name, out var zone) ? zone : null;

    /// <summary>
    /// The moment the task's reminders count from (<see cref="Dated"/>). A timed date is a moment
    /// written on its own zone's clock (spec: PL-020), so it is read there, wherever the person is: a
    /// task written in UTC and seen from Chicago reminds at the same moment for both, as the app
    /// works it out. A whole day is the same date everywhere and reminds from 9:00 where the person
    /// is; so does a time with no zone (or one this server does not know).
    /// </summary>
    private static DateTimeOffset? Start(JsonObject task, TimeZoneInfo personZone)
    {
        var (dated, at) = Dated(task);
        if (at is null || Local(at) is not { } local) return null;
        return InZone(local, at.Length > 10 && OwnZone(dated!) is { } own ? own : personZone);
    }

    /// <summary>
    /// Whether a snooze still comes back (Ben, 0.13.0-rc.2): the task is open, it still has a
    /// reminder, and it is on the occurrence that was snoozed. Completing a repeating task leaves it
    /// open on its next date, and that occurrence must not get the last one's snooze; nor does a task
    /// moved to another date, or whose reminders were taken off.
    /// <para>
    /// A snooze with no occurrence (kept by 0.13.0-rc.1 and earlier, or on a task with no date)
    /// cannot say which occurrence it was for (QA, rc.2 note c):
    /// <list type="bullet">
    /// <item>On a repeating task it never holds. Done since, the task's next occurrence can start
    /// before the snooze comes (a daily 7:00 task snoozed to 9:00 tomorrow), and nothing kept tells
    /// the two apart, so the snooze goes rather than come back on an occurrence it was not for.
    /// Such rows are rc.1's, at most a week old.</item>
    /// <item>Otherwise it holds while the task reminds no later than the snooze comes: a snooze is
    /// pressed on a reminder that has come, so it is never earlier than that reminder, while a task
    /// moved to a later date reminds later. A task in a zone west of the person's that rc.1 reminded
    /// at the person's clock can lose such a snooze; its own reminder still comes. A task with no
    /// date has no start, so its snooze holds, a repeat rule left on it too.</item>
    /// </list>
    /// </para>
    /// </summary>
    public static bool SnoozeHolds(JsonObject task, ReminderSnooze snooze, TimeZoneInfo personZone) =>
        (string?)task["status"] == "open"
        && task["reminders"] is JsonArray { Count: > 0 }
        && (snooze.Occurrence is { } occurrence
            ? occurrence == Occurrence(task)
            : !Repeats(task) && (OccurrenceStart(task, personZone) is not { } start || start <= snooze.At));

    /// <summary>
    /// Whether the task repeats: a rule and a date. A rule left on a task whose date was cleared does
    /// nothing (the app repeats only from a date), so its snoozes hold as any undated task's.
    /// </summary>
    private static bool Repeats(JsonObject task) => Text(task["recurrence"]) is { Length: > 0 } && Dated(task).At is not null;

    /// <summary>
    /// The occurrence to tell an app a snooze is for: its own, or for one kept before it was (see
    /// <see cref="SnoozeHolds"/>) and still holding, the task's current one, so the app drops it
    /// the moment the task moves on there.
    /// </summary>
    public static string? SnoozedOccurrence(JsonObject task, ReminderSnooze snooze) => snooze.Occurrence ?? Occurrence(task);

    /// <summary>How long after its first time a reminder's last repeat can come.</summary>
    public static readonly TimeSpan RepeatsLast = (ConstantTimes - 1) * ConstantEvery;

    /// <summary>
    /// How far ahead snoozes are read: one is at most a week (reminders/act clamps its minutes to 7
    /// days; keep the two together), and a little more covers a constant reminder's repeats.
    /// </summary>
    public static readonly TimeSpan SnoozesAhead = TimeSpan.FromDays(8);

    /// <summary>
    /// Of the snoozes that hold (<see cref="SnoozeHolds"/>), those that come (0.14.0): of a person's
    /// snoozes of one reminder (the same task and <see cref="ReminderSnooze.First"/>), the latest. A
    /// new snooze replaces the one before it (<see cref="IPushStore.SnoozeAsync"/>), but two can be
    /// left by a race. Snoozes that name no reminder each come, as before.
    /// </summary>
    public static IEnumerable<T> LatestPerReminder<T>(IEnumerable<T> holding, Func<T, ReminderSnooze> snooze)
    {
        var all = holding.ToList();
        return all.Where(each => snooze(each).First is null)
            .Concat(all.Where(each => snooze(each).First is not null)
                .GroupBy(each => (snooze(each).UserId, snooze(each).TaskId, snooze(each).First))
                .Select(group => group.MaxBy(each => snooze(each).At)!));
    }

    /// <summary>
    /// The reminders a person's snoozes of a task put off (0.14.0): each the one it was pressed on,
    /// by its first time (the task's own, early or not; or an earlier snooze, come back and snoozed
    /// again), with that one's repeats. Any other reminder of the task still comes.
    /// </summary>
    public static HashSet<DateTimeOffset> Pressed(IEnumerable<ReminderSnooze> snoozes) =>
        [.. snoozes.Where(each => each.First is not null).Select(each => each.First!.Value)];

    /// <summary>Whether a time a reminder comes is put off by a snooze pressed on it (<see cref="Pressed"/>).</summary>
    public static bool PutOff(ReminderTime time, IReadOnlySet<DateTimeOffset>? pressed) => pressed?.Contains(time.First) == true;

    /// <summary>
    /// When each of the task's reminders of its current occurrence is first due, in the person's
    /// zone (a constant reminder's repeats left out): what a snooze names as the reminder it puts off.
    /// </summary>
    public static IEnumerable<DateTimeOffset> FirstInstants(JsonObject task, TimeZoneInfo zone)
    {
        if (task["reminders"] is not JsonArray reminders) yield break;
        var start = Start(task, zone);
        foreach (var reminder in reminders.OfType<JsonObject>())
        {
            // A set time is on the person's own clock: it has no zone of its own, and the app reads
            // it where it runs too.
            if (Text(reminder["at"]) is { } at)
            {
                if (Local(at) is { } set) yield return InZone(set, zone);
            }
            else if (reminder["before"] is JsonValue before && before.TryGetValue<int>(out var minutes) && start is { } from)
            {
                yield return from - TimeSpan.FromMinutes(minutes);
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

    /// <summary>A local date (all day: 9:00) or date-time, without a zone; none outside 1900 to 2200, where no reminder is meant.</summary>
    private static DateTime? Local(string value)
    {
        string[] formats = ["yyyy-MM-dd'T'HH:mm", "yyyy-MM-dd'T'HH:mm:ss", "yyyy-MM-dd"];
        if (!DateTime.TryParseExact(value, formats, CultureInfo.InvariantCulture, DateTimeStyles.None, out var parsed)) return null;
        if (parsed.Year is < 1900 or > 2200) return null;
        return value.Length == 10 ? parsed + AllDayTime : parsed;
    }

    private static DateTimeOffset InZone(DateTime local, TimeZoneInfo zone)
    {
        var unspecified = DateTime.SpecifyKind(local, DateTimeKind.Unspecified);
        if (!zone.IsInvalidTime(unspecified)) return new DateTimeOffset(TimeZoneInfo.ConvertTimeToUtc(unspecified, zone), TimeSpan.Zero);
        // A time the clocks skip (spring forward) counts at the offset from before the jump, so it
        // happens as much later as the clocks jumped, however far that is.
        return new DateTimeOffset(DateTime.SpecifyKind(unspecified - OffsetBefore(unspecified, zone), DateTimeKind.Utc), TimeSpan.Zero);
    }

    /// <summary>The zone's offset at the last time before <paramref name="skipped"/> that its clocks show.</summary>
    private static TimeSpan OffsetBefore(DateTime skipped, TimeZoneInfo zone)
    {
        for (var earlier = skipped.AddMinutes(-15); earlier > skipped.AddDays(-2); earlier = earlier.AddMinutes(-15))
        {
            if (!zone.IsInvalidTime(earlier)) return zone.GetUtcOffset(earlier);
        }
        return zone.BaseUtcOffset;
    }

    private static string? Text(JsonNode? node) => node is JsonValue value && value.TryGetValue<string>(out var text) ? text : null;
}
