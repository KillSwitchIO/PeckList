using System.Globalization;
using System.Text.Json.Nodes;
using PeckList.Core.Sync;

namespace PeckList.Core.Api;

/// <summary>A task's start and end, as the workspace keeps them (local dates or date-times, and a zone).</summary>
public sealed record ApiSchedule(string Start, string? End, bool AllDay, string TimeZone);

/// <summary>A task's due date.</summary>
public sealed record ApiDue(string At, bool AllDay, string TimeZone);

/// <summary>
/// A task in the task API (PL-137): the workspace fields without clocks, tags by name, and an
/// <c>updatedAt</c> from its newest clock. v1 only ever gains fields.
/// </summary>
public sealed record ApiTask(
    string Id,
    string Title,
    string Notes,
    string? ListId,
    string? SectionId,
    string? ParentId,
    string Status,
    string? CompletedAt,
    string? CompletedBy,
    int Priority,
    ApiSchedule? Schedule,
    ApiDue? Due,
    IReadOnlyList<string> Tags,
    IReadOnlyList<string> Assignees,
    string? Recurrence,
    int Progress,
    bool Pinned,
    string? CreatedAt,
    string? CreatedBy,
    string? UpdatedAt,
    string? DeletedAt);

/// <summary>A list, with the reader's role on it (<c>owner</c>, <c>editor</c> or <c>viewer</c>).</summary>
public sealed record ApiList(
    string Id,
    string Name,
    string? Color,
    string? FolderId,
    bool Archived,
    bool IsInbox,
    bool Shared,
    string? Role,
    string? CreatedAt,
    string? UpdatedAt,
    string? DeletedAt);

public sealed record ApiSection(string Id, string? ListId, string Name, string? CreatedAt, string? UpdatedAt, string? DeletedAt);

public sealed record ApiTag(string Id, string Name, string? Color, string? CreatedAt, string? UpdatedAt, string? DeletedAt);

/// <summary>A page of results; <c>next</c> is the cursor for the next page, or null at the end.</summary>
public sealed record ApiPage<T>(IReadOnlyList<T> Items, string? Next);

/// <summary>Results that come whole, unpaged.</summary>
public sealed record ApiItems<T>(IReadOnlyList<T> Items);

/// <summary>
/// A page of the changes feed: what changed after the cursor, deleted ones with <c>deletedAt</c>
/// set, and ids the reader lost access to.
/// </summary>
public sealed record ApiChanges(
    string Cursor,
    bool More,
    IReadOnlyList<ApiTask> Tasks,
    IReadOnlyList<ApiList> Lists,
    IReadOnlyList<ApiSection> Sections,
    IReadOnlyList<ApiTag> Tags,
    IReadOnlyList<string> Revoked);

/// <summary>Workspace documents shaped for the task API. Lenient: a field that is missing takes its empty value.</summary>
public static class ApiShapes
{
    public static ApiTask Task(JsonObject doc, IReadOnlyDictionary<string, string> tagNames) => new(
        Id: Text(doc, "id") ?? "",
        Title: Text(doc, "title") ?? "",
        Notes: Text(doc, "notes") ?? "",
        ListId: Text(doc, "listId"),
        SectionId: Text(doc, "sectionId"),
        ParentId: Text(doc, "parentId"),
        Status: Text(doc, "status") ?? "open",
        CompletedAt: Text(doc, "completedAt"),
        CompletedBy: Text(doc, "completedBy"),
        Priority: Number(doc, "priority"),
        Schedule: doc["schedule"] is JsonObject schedule && Text(schedule, "start") is { } start
            ? new ApiSchedule(start, Text(schedule, "end"), Flag(schedule, "allDay"), Text(schedule, "timeZone") ?? "")
            : null,
        Due: doc["due"] is JsonObject due && Text(due, "at") is { } at
            ? new ApiDue(at, Flag(due, "allDay"), Text(due, "timeZone") ?? "")
            : null,
        Tags: [.. Members(doc, "tags").Select(id => tagNames.GetValueOrDefault(id)).OfType<string>().Order(StringComparer.OrdinalIgnoreCase)],
        Assignees: [.. Members(doc, "assignees").Where(key => key.StartsWith("user:", StringComparison.Ordinal) || key.StartsWith("group:", StringComparison.Ordinal)).Order(StringComparer.Ordinal)],
        Recurrence: Text(doc, "recurrence") is { Length: > 0 } rule ? rule : null,
        Progress: Number(doc, "progress"),
        Pinned: Text(doc, "pinnedAt") is not null,
        CreatedAt: Text(doc, "createdAt"),
        CreatedBy: Text(doc, "createdBy"),
        UpdatedAt: UpdatedAt(doc),
        DeletedAt: Text(doc, "deletedAt"));

    public static ApiList List(JsonObject doc, string? role) => new(
        Id: Text(doc, "id") ?? "",
        Name: Text(doc, "name") ?? "",
        Color: Text(doc, "color"),
        FolderId: Text(doc, "folderId"),
        Archived: Flag(doc, "archived"),
        IsInbox: Flag(doc, "isInbox"),
        Shared: Text(doc, "visibility") == "shared",
        Role: role,
        CreatedAt: Text(doc, "createdAt"),
        UpdatedAt: UpdatedAt(doc),
        DeletedAt: Text(doc, "deletedAt"));

    public static ApiSection Section(JsonObject doc) => new(
        Text(doc, "id") ?? "", Text(doc, "listId"), Text(doc, "name") ?? "", Text(doc, "createdAt"), UpdatedAt(doc), Text(doc, "deletedAt"));

    public static ApiTag Tag(JsonObject doc) => new(
        Text(doc, "id") ?? "", Text(doc, "name") ?? "", Text(doc, "color"), Text(doc, "createdAt"), UpdatedAt(doc), Text(doc, "deletedAt"));

    /// <summary>The wall time of the newest clock on the document (its fields and set elements), or null when it has none.</summary>
    public static string? UpdatedAt(JsonObject doc)
    {
        string? newest = null;
        void Consider(JsonNode? node)
        {
            if (node is JsonValue value && value.TryGetValue<string>(out var stamp) && Hlc.IsValid(stamp) && Hlc.Compare(stamp, newest) > 0) newest = stamp;
        }
        if (doc["_hlc"] is JsonObject clocks) foreach (var (_, stamp) in clocks) Consider(stamp);
        foreach (var field in new[] { "tags", "assignees", "blockedBy" })
        {
            if (doc[field] is not JsonObject set) continue;
            foreach (var (_, element) in set) if (element is JsonObject item) Consider(item["hlc"]);
        }
        return newest is null ? null : Hlc.WallTime(newest).UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);
    }

    /// <summary>The members of an element set that are in.</summary>
    public static IEnumerable<string> Members(JsonObject doc, string field) =>
        doc[field] is JsonObject set
            ? set.Where(pair => pair.Value is JsonObject item && item["in"] is JsonValue value && value.TryGetValue<bool>(out var isIn) && isIn).Select(pair => pair.Key)
            : [];

    /// <summary>The local date a task counts as due on: its due date, else its start; null when it has neither.</summary>
    public static string? DueDate(JsonObject doc)
    {
        var at = (doc["due"] as JsonObject) is { } due ? Text(due, "at") : null;
        at ??= (doc["schedule"] as JsonObject) is { } schedule ? Text(schedule, "start") : null;
        return at is { Length: >= 10 } ? at[..10] : null;
    }

    public static string? Text(JsonObject? doc, string field) =>
        doc?[field] is JsonValue value && value.TryGetValue<string>(out var text) ? text : null;

    private static bool Flag(JsonObject doc, string field) =>
        doc[field] is JsonValue value && value.TryGetValue<bool>(out var flag) && flag;

    private static int Number(JsonObject doc, string field) =>
        doc[field] is JsonValue value && value.TryGetValue<int>(out var number) ? number
        : doc[field] is JsonValue other && other.TryGetValue<double>(out var real) ? (int)real : 0;
}
