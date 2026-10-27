using System.Text.Json.Nodes;
using System.Security.Claims;
using Punchlist.Core;
using Punchlist.Core.Accounts;
using Punchlist.Core.Notifications;
using Punchlist.Core.Sharing;
using Punchlist.Server.Auth;

namespace Punchlist.Server;

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
        });

        api.MapPost("/notifications/read", async (NotificationIds request, ClaimsPrincipal user, INotificationStore store, TimeProvider time, CancellationToken cancellation) =>
        {
            await store.MarkReadAsync(user.UserId(), request.Ids, time.GetUtcNow(), cancellation);
            return Results.NoContent();
        });

        api.MapPost("/notifications/clear", async (NotificationIds request, ClaimsPrincipal user, INotificationStore store, CancellationToken cancellation) =>
        {
            await store.DeleteAsync(user.UserId(), request.Ids, cancellation);
            return Results.NoContent();
        });

        return api;
    }
}

/// <summary>
/// Turns pushed changes into notifications (spec: PL-061): a task assigned, a list shared, an
/// @mention in a comment. Whoever pushed the change is never told about it.
/// </summary>
public sealed class NotificationRecorder(
    INotificationStore store, IAccountStore accounts, SharingState sharing, Push.IPushSender push, TimeProvider time)
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

        // And to their devices, with names: the push is encrypted for each browser.
        var actor = (await accounts.FindByIdAsync(userId, cancellation))?.Username;
        foreach (var each in found)
        {
            var (body, url) = NotificationText.Of(each, actor, sharing.Index);
            await push.SendAsync(each.UserId, new Push.PushPayload("Punchlist", body, each.Id, url), cancellation);
        }
    }
}

/// <summary>What a notification says and where it leads: in a push, and in the Android app's background check.</summary>
public static class NotificationText
{
    public static (string Body, string Url) Of(Notification each, string? actorName, SharingIndex index)
    {
        var actor = actorName ?? "Someone";
        string Name(string? id, string field, string fallback) =>
            id is not null && index.DocOf(id)?[field] is JsonValue value && value.TryGetValue<string>(out var text) && text.Length > 0
                ? text
                : fallback;
        var task = Name(each.TaskId, "title", "a task");
        var body = each.Kind switch
        {
            NotificationKind.Assigned => $"{actor} assigned you {task}",
            NotificationKind.Shared => $"{actor} shared {Name(each.ListId, "name", "a list")} with you",
            NotificationKind.Mentioned => $"{actor} mentioned you in {task}",
            _ => task,
        };
        var url = each.TaskId is not null ? $"/today?task={each.TaskId}" : $"/lists/{each.ListId}";
        return (body, url);
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
