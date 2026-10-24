using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Punchlist.Core.Sharing;

namespace Punchlist.Core.Notifications;

/// <summary>What a notification is about (spec: PL-061).</summary>
public static class NotificationKind
{
    /// <summary>Someone assigned me (or a group I am in) a task.</summary>
    public const string Assigned = "assigned";

    /// <summary>Someone shared a list with me (or a group I am in).</summary>
    public const string Shared = "shared";

    /// <summary>Someone @mentioned me in a comment.</summary>
    public const string Mentioned = "mentioned";

    /// <summary>A task's reminder fired (recorded by the server's reminder sender).</summary>
    public const string Reminder = "reminder";
}

/// <summary>
/// One notification for one person. Ids only, never titles or comment text: the app shows names
/// from its own copy of the data, so nothing private sits in this table.
/// </summary>
public sealed record Notification
{
    /// <summary>Sortable by time (a ULID).</summary>
    public required string Id { get; init; }
    public required string UserId { get; init; }
    public required string Kind { get; init; }
    public required DateTimeOffset At { get; init; }

    /// <summary>Who did it (none for a reminder).</summary>
    public string? ActorId { get; init; }
    public string? TaskId { get; init; }
    public string? ListId { get; init; }
    public string? CommentId { get; init; }
    public DateTimeOffset? ReadAt { get; init; }
}

public interface INotificationStore
{
    Task AddAsync(IReadOnlyList<Notification> notifications, CancellationToken cancellation = default);

    /// <summary>A person's latest notifications, newest first.</summary>
    Task<IReadOnlyList<Notification>> ListAsync(string userId, int limit, CancellationToken cancellation = default);

    Task<int> UnreadCountAsync(string userId, CancellationToken cancellation = default);

    /// <summary>Mark some (null: all) of a person's notifications read.</summary>
    Task MarkReadAsync(string userId, IReadOnlyCollection<string>? ids, DateTimeOffset at, CancellationToken cancellation = default);

    /// <summary>Clear some (null: all) of a person's notifications.</summary>
    Task DeleteAsync(string userId, IReadOnlyCollection<string>? ids, CancellationToken cancellation = default);

    /// <summary>Clear everyone's notifications older than <paramref name="before"/>; how many went.</summary>
    Task<int> PruneAsync(DateTimeOffset before, CancellationToken cancellation = default);
}

/// <summary>One pushed change a notification may come from. <paramref name="Before"/> is null for a new entity.</summary>
public sealed record NotableChange(string Collection, string Id, JsonObject? Before, JsonObject After);

/// <summary>Hears about changes devices push that may notify someone.</summary>
public interface INotificationSink
{
    Task ChangedAsync(string userId, IReadOnlyList<NotableChange> changes, CancellationToken cancellation = default);
}

/// <summary>Who to notify about what, from pushed changes (spec: PL-061). Plain data in, data out.</summary>
public static partial class NotificationRules
{
    /// <summary>The collections whose changes may notify someone.</summary>
    public static bool Watched(string collection) => collection is "tasks" or "listMembers" or "comments";

    [GeneratedRegex(@"(?<![\w@])@([A-Za-z0-9._-]{1,64})")]
    private static partial Regex Mention();

    public sealed record Found(string UserId, string Kind, string? TaskId, string? ListId, string? CommentId);

    /// <summary>
    /// What one change tells whom. <paramref name="actorId"/> is never told about their own doing;
    /// <paramref name="userByName"/> finds an account by username (for @mentions), and only people
    /// who can see the task hear of a mention.
    /// </summary>
    public static IEnumerable<Found> For(string actorId, NotableChange change, SharingIndex index, Func<string, string?> userByName)
    {
        if (change.After["deletedAt"] is not null) return [];
        var found = change.Collection switch
        {
            "tasks" => NewlyAssigned(change).SelectMany(index.PeopleOf)
                .Select(user => new Found(user, NotificationKind.Assigned, change.Id, Field(change.After, "listId"), null)),
            "listMembers" when change.Before is null || change.Before["deletedAt"] is not null =>
                Field(change.After, "principal") is { } principal
                    ? index.PeopleOf(principal).Select(user =>
                        new Found(user, NotificationKind.Shared, null, Field(change.After, "listId"), null))
                    : [],
            "comments" when change.Before is null => Mentioned(change, index, userByName),
            _ => [],
        };
        return found.Where(each => each.UserId != actorId).DistinctBy(each => each.UserId);
    }

    private static IEnumerable<string> NewlyAssigned(NotableChange change)
    {
        static HashSet<string> In(JsonObject? task)
        {
            var set = new HashSet<string>(StringComparer.Ordinal);
            if (task?["assignees"] is not JsonObject assignees) return set;
            foreach (var (principal, state) in assignees)
            {
                if (state?["in"] is JsonValue value && value.TryGetValue<bool>(out var isIn) && isIn) set.Add(principal);
            }
            return set;
        }
        var before = In(change.Before);
        return In(change.After).Where(principal => !before.Contains(principal));
    }

    private static IEnumerable<Found> Mentioned(NotableChange change, SharingIndex index, Func<string, string?> userByName)
    {
        if (Field(change.After, "taskId") is not { } taskId || Field(change.After, "body") is not { } body) return [];
        var viewers = index.Viewers(taskId);
        return Mention().Matches(body)
            .Select(match => userByName(match.Groups[1].Value))
            .OfType<string>()
            .Where(viewers.Contains)
            .Select(user => new Found(user, NotificationKind.Mentioned, taskId, null, change.Id));
    }

    private static string? Field(JsonObject? doc, string name) =>
        doc?[name] is JsonValue value && value.TryGetValue<string>(out var text) ? text : null;
}
