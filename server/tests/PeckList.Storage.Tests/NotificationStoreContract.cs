using PeckList.Core.Notifications;
using PeckList.Core.Push;

namespace PeckList.Storage.Tests;

/// <summary>What every <see cref="INotificationStore"/> and <see cref="IPushStore"/> adapter must do.</summary>
public abstract class NotificationStoreContract : IAsyncLifetime
{
    protected INotificationStore Notifications { get; private set; } = null!;
    protected IPushStore Push { get; private set; } = null!;

    protected abstract Task<(INotificationStore, IPushStore)> CreateAsync();

    public async ValueTask InitializeAsync() => (Notifications, Push) = await CreateAsync();

    public ValueTask DisposeAsync() => ValueTask.CompletedTask;

    private static CancellationToken Token => TestContext.Current.CancellationToken;

    private static readonly DateTimeOffset Monday = new(2026, 10, 19, 8, 0, 0, TimeSpan.Zero);

    private static Notification Note(string id, string user, int minutes, string kind = NotificationKind.Assigned) => new()
    {
        Id = id,
        UserId = user,
        Kind = kind,
        At = Monday.AddMinutes(minutes),
        ActorId = "sam",
        TaskId = "T-" + id,
    };

    [Fact]
    public async Task Lists_a_persons_notifications_newest_first_and_counts_the_unread()
    {
        await Notifications.AddAsync([Note("N1", "ben", 1), Note("N2", "ben", 3), Note("N3", "kim", 2)], Token);
        var mine = await Notifications.ListAsync("ben", 10, Token);
        Assert.Equal(["N2", "N1"], mine.Select(each => each.Id));
        Assert.Equal(("sam", "T-N2", (DateTimeOffset?)null), (mine[0].ActorId, mine[0].TaskId, mine[0].ReadAt));
        Assert.Equal(Monday.AddMinutes(3), mine[0].At);
        Assert.Equal(2, await Notifications.UnreadCountAsync("ben", Token));
    }

    [Fact]
    public async Task Marks_read_and_clears_some_or_all_of_one_persons_only()
    {
        await Notifications.AddAsync([Note("R1", "ben", 1), Note("R2", "ben", 2), Note("R3", "ben", 3), Note("R4", "kim", 1)], Token);
        await Notifications.MarkReadAsync("ben", ["R1", "R4"], Monday.AddHours(1), Token);
        Assert.Equal(2, await Notifications.UnreadCountAsync("ben", Token));
        Assert.Equal(1, await Notifications.UnreadCountAsync("kim", Token));
        Assert.Equal(Monday.AddHours(1), (await Notifications.ListAsync("ben", 10, Token)).Single(each => each.Id == "R1").ReadAt);
        await Notifications.MarkReadAsync("ben", null, Monday.AddHours(2), Token);
        Assert.Equal(0, await Notifications.UnreadCountAsync("ben", Token));

        await Notifications.DeleteAsync("ben", ["R2"], Token);
        Assert.Equal(["R3", "R1"], (await Notifications.ListAsync("ben", 10, Token)).Select(each => each.Id));
        await Notifications.DeleteAsync("ben", null, Token);
        Assert.Empty(await Notifications.ListAsync("ben", 10, Token));
        Assert.Single(await Notifications.ListAsync("kim", 10, Token));
    }

    [Fact]
    public async Task Prunes_old_notifications()
    {
        await Notifications.AddAsync([Note("P1", "ben", 1), Note("P2", "ben", 100)], Token);
        Assert.Equal(1, await Notifications.PruneAsync(Monday.AddMinutes(50), Token));
        Assert.Equal(["P2"], (await Notifications.ListAsync("ben", 10, Token)).Select(each => each.Id));
    }

    [Fact]
    public async Task Keeps_push_subscriptions_by_endpoint_and_sends_each_reminder_once()
    {
        await Push.SaveAsync(new PushSubscription("ben", "https://push.example/a", "key-a", "auth-a"), Token);
        await Push.SaveAsync(new PushSubscription("ben", "https://push.example/b", "key-b", "auth-b"), Token);
        // The same browser signed in as someone else now: the endpoint moves.
        await Push.SaveAsync(new PushSubscription("kim", "https://push.example/b", "key-b2", "auth-b2"), Token);
        Assert.Equal(["https://push.example/a"], (await Push.ForUserAsync("ben", Token)).Select(each => each.Endpoint));
        Assert.Equal("key-b2", (await Push.ForUserAsync("kim", Token)).Single().P256dh);
        await Push.RemoveAsync("https://push.example/a", Token);
        Assert.Empty(await Push.ForUserAsync("ben", Token));
        await Push.RemoveUserAsync("kim", Token);
        Assert.Empty(await Push.ForUserAsync("kim", Token));

        Assert.True(await Push.MarkReminderSentAsync("ben|T1@1", Monday, Token));
        Assert.False(await Push.MarkReminderSentAsync("ben|T1@1", Monday, Token));
        await Push.PruneSentRemindersAsync(Monday.AddDays(1), Token);
        Assert.True(await Push.MarkReminderSentAsync("ben|T1@1", Monday, Token));
    }

    [Fact]
    public async Task Keeps_what_each_subscription_said_its_language_and_clock_were()
    {
        await Push.SaveAsync(new PushSubscription("ben", "https://push.example/24", "k", "a", "de-DE,de", Clock24: true), Token);
        await Push.SaveAsync(new PushSubscription("ben", "https://push.example/12", "k", "a", "en-US", Clock24: false), Token);
        await Push.SaveAsync(new PushSubscription("ben", "https://push.example/older", "k", "a"), Token);
        var said = (await Push.ForUserAsync("ben", Token)).ToDictionary(each => each.Endpoint, each => (each.Languages, each.Clock24));
        Assert.Equal(("de-DE,de", (bool?)true), said["https://push.example/24"]);
        Assert.Equal(("en-US", (bool?)false), said["https://push.example/12"]);
        Assert.Equal(((string?)null, (bool?)null), said["https://push.example/older"]);

        // Saved again without a clock (an older app): it no longer says one.
        await Push.SaveAsync(new PushSubscription("ben", "https://push.example/24", "k", "a", "de-DE,de"), Token);
        Assert.Null((await Push.ForUserAsync("ben", Token)).Single(each => each.Endpoint == "https://push.example/24").Clock24);
    }

    [Fact]
    public async Task Keeps_each_persons_last_reported_zone_until_their_account_goes()
    {
        Assert.Null(await Push.DeviceZoneAsync("ben", Token));
        await Push.SetDeviceZoneAsync("ben", "America/Chicago", Token);
        await Push.SetDeviceZoneAsync("ben", "Asia/Tokyo", Token);
        await Push.SetDeviceZoneAsync("kim", "Europe/Paris", Token);
        Assert.Equal("Asia/Tokyo", await Push.DeviceZoneAsync("ben", Token));
        Assert.Equal(new Dictionary<string, string> { ["ben"] = "Asia/Tokyo", ["kim"] = "Europe/Paris" }, await Push.DeviceZonesAsync(Token));

        await Push.RemoveUserAsync("ben", Token);
        Assert.Null(await Push.DeviceZoneAsync("ben", Token));
        Assert.Equal("Europe/Paris", await Push.DeviceZoneAsync("kim", Token));
    }

    [Fact]
    public async Task Keeps_each_persons_snoozes_until_a_week_after_they_are_due_or_their_account_goes()
    {
        await Push.SnoozeAsync("ben", "T1", Monday.AddMinutes(10), null, cancellation: Token);
        await Push.SnoozeAsync("ben", "T1", Monday.AddMinutes(10), null, cancellation: Token);
        await Push.SnoozeAsync("ben", "T2", Monday.AddMinutes(30), null, cancellation: Token);
        await Push.SnoozeAsync("kim", "T1", Monday.AddMinutes(20), null, cancellation: Token);

        Assert.Equal(
            [new ReminderSnooze("ben", "T1", Monday.AddMinutes(10)), new ReminderSnooze("kim", "T1", Monday.AddMinutes(20)), new ReminderSnooze("ben", "T2", Monday.AddMinutes(30))],
            await Push.SnoozesAsync(Monday, Monday.AddHours(1), cancellation: Token));
        // Due after the start and up to the end, as reminders are.
        Assert.Equal(["T1"], (await Push.SnoozesAsync(Monday.AddMinutes(10), Monday.AddMinutes(20), cancellation: Token)).Select(each => each.TaskId));
        Assert.Equal(["T1", "T2"], (await Push.SnoozesAsync(Monday, Monday.AddHours(1), "ben", Token)).Select(each => each.TaskId));

        await Push.PruneSentRemindersAsync(Monday.AddMinutes(25), Token);
        Assert.Equal([new ReminderSnooze("ben", "T2", Monday.AddMinutes(30))], await Push.SnoozesAsync(Monday, Monday.AddHours(1), cancellation: Token));
        await Push.RemoveUserAsync("ben", Token);
        Assert.Empty(await Push.SnoozesAsync(Monday, Monday.AddHours(1), cancellation: Token));
    }

    [Fact]
    public async Task A_snooze_replaces_the_persons_snooze_of_the_same_reminder()
    {
        // 0.14.0: snoozed again before the last came back, both came.
        const string occurrence = "2026-10-26T10:30";
        var first = Monday.AddMinutes(5);
        await Push.SnoozeAsync("ben", "T1", Monday.AddMinutes(10), occurrence, first, Token);
        await Push.SnoozeAsync("ben", "T1", Monday.AddMinutes(25), occurrence, first, Token);
        // Another reminder of the task, another occurrence, task or person: each their own.
        await Push.SnoozeAsync("ben", "T1", Monday.AddMinutes(20), occurrence, Monday.AddMinutes(6), Token);
        await Push.SnoozeAsync("ben", "T1", Monday.AddMinutes(40), "2026-10-27T10:30", first, Token);
        await Push.SnoozeAsync("ben", "T2", Monday.AddMinutes(12), occurrence, first, Token);
        await Push.SnoozeAsync("kim", "T1", Monday.AddMinutes(14), occurrence, first, Token);
        // Naming no reminder (as before 0.14.0): kept beside the rest, and replacing none.
        await Push.SnoozeAsync("ben", "T1", Monday.AddMinutes(16), occurrence, cancellation: Token);
        await Push.SnoozeAsync("ben", "T1", Monday.AddMinutes(18), occurrence, cancellation: Token);

        Assert.Equal(
            [
                new ReminderSnooze("ben", "T2", Monday.AddMinutes(12), occurrence, first),
                new ReminderSnooze("kim", "T1", Monday.AddMinutes(14), occurrence, first),
                new ReminderSnooze("ben", "T1", Monday.AddMinutes(16), occurrence),
                new ReminderSnooze("ben", "T1", Monday.AddMinutes(18), occurrence),
                new ReminderSnooze("ben", "T1", Monday.AddMinutes(20), occurrence, Monday.AddMinutes(6)),
                new ReminderSnooze("ben", "T1", Monday.AddMinutes(25), occurrence, first),
                new ReminderSnooze("ben", "T1", Monday.AddMinutes(40), "2026-10-27T10:30", first),
            ],
            await Push.SnoozesAsync(Monday, Monday.AddHours(1), cancellation: Token));
    }

    [Fact]
    public async Task Two_reminders_snoozed_to_the_same_minute_each_keep_their_own_snooze()
    {
        // 0.14.0 (0021): they shared a row, and the later press's reminder replaced the other's.
        const string occurrence = "2026-10-26T10:30";
        var at = Monday.AddMinutes(30);
        await Push.SnoozeAsync("ben", "T1", at, occurrence, Monday.AddMinutes(5), Token);
        await Push.SnoozeAsync("ben", "T1", at, occurrence, Monday.AddMinutes(10), Token);
        // One that names no reminder, twice: its own row, once.
        await Push.SnoozeAsync("ben", "T1", at, occurrence, cancellation: Token);
        await Push.SnoozeAsync("ben", "T1", at, occurrence, cancellation: Token);
        // The same reminder to the same minute on the next occurrence: its row, that occurrence's now.
        await Push.SnoozeAsync("ben", "T1", at, "2026-10-27T10:30", Monday.AddMinutes(10), Token);

        Assert.Equal(
            [
                new ReminderSnooze("ben", "T1", at, occurrence),
                new ReminderSnooze("ben", "T1", at, occurrence, Monday.AddMinutes(5)),
                new ReminderSnooze("ben", "T1", at, "2026-10-27T10:30", Monday.AddMinutes(10)),
            ],
            (await Push.SnoozesAsync(Monday, Monday.AddHours(1), cancellation: Token)).OrderBy(each => each.First));
    }

    [Fact]
    public async Task Keeps_the_occurrence_a_snooze_is_for_and_the_latest_on_the_same_time_snoozed_again()
    {
        await Push.SnoozeAsync("ben", "T1", Monday.AddMinutes(10), "2026-10-26T10:30", cancellation: Token);
        Assert.Equal([new ReminderSnooze("ben", "T1", Monday.AddMinutes(10), "2026-10-26T10:30")],
            await Push.SnoozesAsync(Monday, Monday.AddHours(1), cancellation: Token));
        // The same time on the next occurrence of a repeating task: that occurrence's now.
        await Push.SnoozeAsync("ben", "T1", Monday.AddMinutes(10), "2026-10-27", cancellation: Token);
        Assert.Equal([new ReminderSnooze("ben", "T1", Monday.AddMinutes(10), "2026-10-27")],
            await Push.SnoozesAsync(Monday, Monday.AddHours(1), cancellation: Token));
    }
}
