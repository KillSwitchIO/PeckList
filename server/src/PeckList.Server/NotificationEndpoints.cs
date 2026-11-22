using System.Text.Json.Nodes;
using System.Security.Claims;
using PeckList.Core;
using PeckList.Core.Accounts;
using PeckList.Core.Notifications;
using PeckList.Core.Sharing;
using PeckList.Core.Text;
using PeckList.Server.Auth;

namespace PeckList.Server;

public sealed record NotificationView(
    string Id, string Kind, DateTimeOffset At, string? ActorId, string? TaskId, string? ListId, string? CommentId, bool Read);

public sealed record NotificationFeed(IReadOnlyList<NotificationView> Items, int Unread);

/// <summary>Which notifications; none (null) means all of mine.</summary>
public sealed record NotificationIds(IReadOnlyList<string>? Ids);

/// <summary>A person's notifications (spec: PL-061): read the latest, mark read, clear.</summary>
public static class NotificationEndpoints
{
    public const int FeedSize = 100;

    public static RouteGroupBuilder MapNotifications(this RouteGroupBuilder api)
    {
        api.MapGet("/notifications", async (ClaimsPrincipal user, INotificationStore store, CancellationToken cancellation) =>
        {
            var items = await store.ListAsync(user.UserId(), FeedSize, cancellation);
            var unread = await store.UnreadCountAsync(user.UserId(), cancellation);
            return new NotificationFeed(
                [.. items.Select(each => new NotificationView(
                    each.Id, each.Kind, each.At, each.ActorId, each.TaskId, each.ListId, each.CommentId, each.ReadAt is not null))],
                unread);
        }).WithSummary($"Your latest {FeedSize} notifications and how many are unread");

        api.MapPost("/notifications/read", async (NotificationIds request, ClaimsPrincipal user, INotificationStore store, TimeProvider time, CancellationToken cancellation) =>
        {
            await store.MarkReadAsync(user.UserId(), request.Ids, time.GetUtcNow(), cancellation);
            return Results.NoContent();
        }).Doc("Mark notifications read (all of yours when ids is left out)");

        api.MapPost("/notifications/clear", async (NotificationIds request, ClaimsPrincipal user, INotificationStore store, CancellationToken cancellation) =>
        {
            await store.DeleteAsync(user.UserId(), request.Ids, cancellation);
            return Results.NoContent();
        }).Doc("Clear notifications (all of yours when ids is left out)");

        return api;
    }
}

/// <summary>
/// Turns pushed changes into notifications (spec: PL-061): a task assigned, a list shared, an
/// @mention in a comment. Whoever pushed the change is never told about it.
/// </summary>
public sealed class NotificationRecorder(
    INotificationStore store, IAccountStore accounts, SharingState sharing, Push.IPushSender push, BackgroundQueue background, TimeProvider time,
    Core.Sync.IChangeNotifier notifier, Text.ServerWords words)
    : INotificationSink
{
    public async Task ChangedAsync(string userId, IReadOnlyList<NotableChange> changes, CancellationToken cancellation = default)
    {
        // Usernames only matter for @mentions, so only comments load them.
        var byName = changes.Any(change => change.Collection == "comments")
            ? (await accounts.ListAsync(cancellation))
                .Where(account => account.DeletedAt is null)
                .ToDictionary(account => account.Username, account => account.Id, StringComparer.OrdinalIgnoreCase)
            : new Dictionary<string, string>();
        var now = time.GetUtcNow();
        var found = changes
            .SelectMany(change => NotificationRules.For(userId, change, sharing.Index, name => byName.GetValueOrDefault(name)))
            .Select(each => new Notification
            {
                Id = Ids.NewUlid(time),
                UserId = each.UserId,
                Kind = each.Kind,
                At = now,
                ActorId = userId,
                TaskId = each.TaskId,
                ListId = each.ListId,
                CommentId = each.CommentId,
            })
            .ToList();
        await store.AddAsync(found, cancellation);
        if (found.Count == 0) return;
        // Open streams hear at once (the task API's listeners: Home Assistant, scripts).
        Core.Sync.InProcessChangeNotifier.Notify(notifier, found);

        // And to their devices, with names: the push is encrypted for each browser. The words are
        // settled now; sending waits for no one's sync (audit B2), so a slow push service slows nobody.
        var actor = (await accounts.FindByIdAsync(userId, cancellation))?.Username;
        var pushes = new List<(string UserId, Func<Push.PushDevice, Push.PushPayload> Payload)>();
        foreach (var each in found)
        {
            // Switched off in their settings: recorded in the feed, but not pushed (PL-115).
            var settings = Push.ReminderSender.SettingsOf(sharing.Index, each.UserId);
            if (!NotificationSwitches.Allows(settings, each.Kind)) continue;
            // The task's and list's names as they are now, not when the job runs (a rename or a
            // delete in between would show); the wording waits for each device's language (PL-148).
            var names = NotificationText.NamesOf(each, sharing.Index);
            pushes.Add((each.UserId, device =>
            {
                var said = Push.ReminderSender.WordsFor(words.Catalog, settings, device);
                var (body, url) = NotificationText.Of(each, actor, names, said);
                return new Push.PushPayload("PeckList", body, each.Id, url, Actions: NotificationText.ActionsOf(each, url, said));
            }));
        }
        // One job each: one person's browser that never answers costs only them their push.
        foreach (var (to, payload) in pushes)
        {
            background.Enqueue("Sending a notification", stopping => push.SendAsync(to, payload, stopping));
        }
    }
}

/// <summary>
/// What a notification says and where it leads: in a push, and in the Android app's background
/// check. In <c>words</c>' language (PL-148), English when not given.
/// </summary>
public static class NotificationText
{
    /// <summary>The names a notification shows: its task's title and its list's name, null when there is none.</summary>
    public sealed record Names(string? Task, string? List);

    /// <summary>The task's and list's names in <paramref name="index"/> now.</summary>
    public static Names NamesOf(Notification each, SharingIndex index)
    {
        string? Name(string? id, string field) =>
            id is not null && index.DocOf(id)?[field] is JsonValue value && value.TryGetValue<string>(out var text) && text.Length > 0
                ? text
                : null;
        return new Names(Name(each.TaskId, "title"), Name(each.ListId, "name"));
    }

    public static (string Body, string Url) Of(Notification each, string? actorName, SharingIndex index, Words? words = null) =>
        Of(each, actorName, NamesOf(each, index), words);

    public static (string Body, string Url) Of(Notification each, string? actorName, Names names, Words? words = null)
    {
        words ??= Words.English;
        var actor = actorName ?? words["notify.someone"];
        var task = names.Task ?? words["notify.aTask"];
        var body = each.Kind switch
        {
            NotificationKind.Assigned => words.Get("notify.assigned", ("actor", actor), ("task", task)),
            NotificationKind.Shared => words.Get("notify.shared", ("actor", actor), ("list", names.List ?? words["notify.aList"])),
            NotificationKind.Mentioned => words.Get("notify.mentioned", ("actor", actor), ("task", task)),
            NotificationKind.Commented => words.Get("notify.commented", ("actor", actor), ("task", task)),
            NotificationKind.CommentEdited => words.Get("notify.commentEdited", ("actor", actor), ("task", task)),
            NotificationKind.GroupAssigned => words.Get("notify.groupAssigned", ("actor", actor), ("task", task)),
            NotificationKind.Claimed => words.Get("notify.claimed", ("actor", actor), ("task", task)),
            _ => task,
        };
        // A comment opens with the comments shown and scrolled to it (R-FB-106).
        var url = each.TaskId is null
            ? $"/lists/{each.ListId}"
            : each.CommentId is null
                ? $"/today?task={each.TaskId}"
                : $"/today?task={each.TaskId}&comment={each.CommentId}";
        return (body, url);
    }

    /// <summary>
    /// A notification's buttons, left to right, each leading into the app: Reply (the comments,
    /// scrolled to it) and thumbs up for a comment (R-FB-106); Open task and Call dibs for a task
    /// assigned to a group (R-FB-107). The app does the thumbs up and the dibs on opening, from the
    /// button's TaskId as the service worker or the Android app hands it over, never from a flag in
    /// the address, which a link from anywhere could carry (security review 2026-11-19). Reply's
    /// reply=1 is a flag in the address, and may be: it only puts the cursor in the comment box.
    /// </summary>
    public static IReadOnlyList<Push.PushAction> ActionsOf(Notification each, string url, Words? words = null)
    {
        words ??= Words.English;
        return each.Kind switch
        {
            NotificationKind.Commented or NotificationKind.CommentEdited or NotificationKind.Mentioned
                when each.CommentId is not null =>
                [new("reply", words["notify.reply"], url + "&reply=1"), new("like", "\U0001F44D", url, each.TaskId)],
            NotificationKind.GroupAssigned => [new("open", words["notify.openTask"], url), new("dibs", words["notify.callDibs"], url, each.TaskId)],
            // A tap opens it too, but a button says so (drill of 2026-10-29).
            NotificationKind.Assigned or NotificationKind.Claimed => [new("open", words["notify.openTask"], url)],
            NotificationKind.Shared => [new("open", words["notify.openList"], url)],
            _ => [],
        };
    }
}

/// <summary>Clears notifications older than 90 days, once a day.</summary>
public sealed class NotificationRetention(INotificationStore store, TimeProvider time, ILogger<NotificationRetention> logger)
    : PeriodicService("Clearing old notifications", TimeSpan.Zero, TimeSpan.FromDays(1), time, logger, LogLevel.Warning)
{
    public static readonly TimeSpan Keep = TimeSpan.FromDays(90);

    protected override async Task RunAsync(CancellationToken stopping)
    {
        var gone = await store.PruneAsync(Time.GetUtcNow() - Keep, stopping);
        if (gone > 0) Logger.LogInformation("Cleared {Count} notifications older than {Days} days", gone, Keep.Days);
    }
}
