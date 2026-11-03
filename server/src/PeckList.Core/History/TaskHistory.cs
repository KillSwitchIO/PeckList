using System.Text.Json;
using System.Text.Json.Nodes;
using PeckList.Core.Notifications;

namespace PeckList.Core.History;

/// <summary>
/// One change to a task (R-FB-105): who changed which field, from what to what. Values are the
/// field's JSON as it was and became (null when gone or not kept: notes are only "edited").
/// </summary>
public sealed record HistoryEntry
{
    /// <summary>Sortable by time (a ULID).</summary>
    public required string Id { get; init; }
    public required string TaskId { get; init; }
    public required DateTimeOffset At { get; init; }
    /// <summary>Who did it; null once their account is gone.</summary>
    public string? ActorId { get; init; }
    /// <summary>A task field, or <c>created</c>, <c>deleted</c>, <c>restored</c>.</summary>
    public required string Field { get; init; }
    public string? Before { get; init; }
    public string? After { get; init; }
}

public interface ITaskHistoryStore
{
    Task AddAsync(IReadOnlyList<HistoryEntry> entries, CancellationToken cancellation = default);

    /// <summary>A task's latest changes, newest first.</summary>
    Task<IReadOnlyList<HistoryEntry>> ListAsync(string taskId, int limit, CancellationToken cancellation = default);

    /// <summary>The latest entry for one field of a task, to fold quick edits into.</summary>
    Task<HistoryEntry?> LatestAsync(string taskId, string field, CancellationToken cancellation = default);

    /// <summary>Change an entry in place (a quick follow-up edit): its new value and time.</summary>
    Task UpdateAsync(string id, string? after, DateTimeOffset at, CancellationToken cancellation = default);

    Task DeleteAsync(string id, CancellationToken cancellation = default);

    /// <summary>An account goes: its changes stay, by nobody in particular.</summary>
    Task ForgetActorAsync(string actorId, CancellationToken cancellation = default);

    /// <summary>Clear entries older than <paramref name="before"/>; how many went.</summary>
    Task<int> PruneAsync(DateTimeOffset before, CancellationToken cancellation = default);
}

/// <summary>Hears about task changes devices push, for their history.</summary>
public interface ITaskHistorySink
{
    Task ChangedAsync(string userId, IReadOnlyList<NotableChange> changes, CancellationToken cancellation = default);
}

/// <summary>What a pushed task change adds to its history (R-FB-105). Plain data in, data out.</summary>
public static class HistoryRules
{
    /// <summary>The fields a person cares to see changed, in the order a change lists them.</summary>
    public static readonly string[] Fields =
    [
        "title", "status", "schedule", "due", "priority", "listId", "parentId", "assignees", "tags",
        "notes", "recurrence", "reminders", "progress", "pinnedAt",
    ];

    /// <summary>Notes can be long: only that they changed is kept.</summary>
    private const string Notes = "notes";
    /// <summary>A value kept is cut to this many characters.</summary>
    private const int MaxValue = 2000;

    public sealed record Found(string Field, string? Before, string? After);

    public static IEnumerable<Found> For(NotableChange change)
    {
        if (change.Collection != "tasks") yield break;
        var wasGone = change.Before?["deletedAt"] is not null;
        var isGone = change.After["deletedAt"] is not null;
        if (change.Before is null)
        {
            if (!isGone) yield return new Found("created", null, Value(change.After, "title"));
            yield break;
        }
        if (isGone && !wasGone)
        {
            yield return new Found("deleted", null, null);
            yield break;
        }
        if (wasGone && !isGone) yield return new Found("restored", null, null);
        foreach (var field in Fields)
        {
            var before = Value(change.Before, field);
            var after = Value(change.After, field);
            if (before == after) continue;
            yield return field == Notes ? new Found(field, null, null) : new Found(field, before, after);
        }
    }

    /// <summary>A field as compact JSON; assignees as the principals now in, sorted.</summary>
    public static string? Value(JsonObject? doc, string field)
    {
        var node = doc?[field];
        if (node is null) return null;
        if (field == "assignees" && node is JsonObject assignees)
        {
            var current = assignees
                .Where(each => each.Value?["in"] is JsonValue value && value.TryGetValue<bool>(out var isIn) && isIn)
                .Select(each => each.Key)
                .Order(StringComparer.Ordinal)
                .ToArray();
            return JsonSerializer.Serialize(current);
        }
        var text = node.ToJsonString();
        return text.Length > MaxValue ? text[..MaxValue] : text;
    }
}
