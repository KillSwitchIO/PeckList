using Punchlist.Core.Notifications;
using Punchlist.Core.Push;

namespace Punchlist.Storage.Tests;

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
}
