using System.Globalization;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using PeckList.Core.Sync;

namespace PeckList.Core.Api;

/// <summary>A reminder: minutes before the task's date, or a set local date-time.</summary>
public sealed record ApiReminder(
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] int? Before,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? At);

/// <summary>
/// The names a task's ids point at, as one reader sees them (PL-142): tags, lists and sections by
/// id, people by <c>user:&lt;id&gt;</c> or <c>group:&lt;id&gt;</c>. A name the reader can't see is absent.
/// </summary>
public sealed record ApiNames(
    IReadOnlyDictionary<string, string> Tags,
    IReadOnlyDictionary<string, string> Lists,
    IReadOnlyDictionary<string, string> Sections,
    IReadOnlyDictionary<string, string> People)
{
    /// <summary>The names in a set of stored entities (tags, lists, sections, users and groups; others are ignored).</summary>
    public static ApiNames Of(IEnumerable<Storage.StoredEntity> entities)
    {
        var tags = new Dictionary<string, string>(StringComparer.Ordinal);
        var lists = new Dictionary<string, string>(StringComparer.Ordinal);
        var sections = new Dictionary<string, string>(StringComparer.Ordinal);
        var people = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var each in entities)
        {
            switch (each.Collection)
            {
                case "tags" when ApiShapes.Text(each.Doc, "name") is { } name: tags[each.Id] = name; break;
                case "lists" when ApiShapes.Text(each.Doc, "name") is { } name: lists[each.Id] = name; break;
                case "sections" when ApiShapes.Text(each.Doc, "name") is { } name: sections[each.Id] = name; break;
                case "users": people[$"user:{each.Id}"] = ApiShapes.PersonName(each.Doc, each.Id); break;
                case "groups": people[$"group:{each.Id}"] = ApiShapes.Text(each.Doc, "name") ?? each.Id; break;
            }
        }
        return new ApiNames(tags, lists, sections, people);
    }
}

/// <summary>A task's start and end, as the workspace keeps them (local dates or date-times, and a zone).</summary>
public sealed record ApiSchedule(string Start, string? End, bool AllDay, string TimeZone);

/// <summary>A task's due date.</summary>
public sealed record ApiDue(string At, bool AllDay, string TimeZone);

/// <summary>
/// A task in the task API (PL-137): the workspace fields without clocks, tags by name, and an
/// <c>updatedAt</c> from its newest clock. v1 only ever gains fields. Since PL-142 it also carries
/// the names its ids point at (list, section, assignees, who made and closed it) and its reminders.
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
    string? DeletedAt,
    string? ListName,
    string? SectionName,
    IReadOnlyDictionary<string, string> AssigneeNames,
    string? CreatedByName,
    string? CompletedByName,
    IReadOnlyList<ApiReminder> Reminders,
    bool ConstantReminder,
    string? Order = null);

/// <summary>
/// A list, with the reader's role on it (<c>owner</c>, <c>editor</c> or <c>viewer</c>). <c>order</c>, here
/// and on tasks, sections and tags, is the apps' sort key: compare the strings byte by byte.
/// </summary>
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
    string? DeletedAt,
    string? Icon = null,
    string? Order = null);

public sealed record ApiSection(string Id, string? ListId, string Name, string? CreatedAt, string? UpdatedAt, string? DeletedAt, string? Order = null);

public sealed record ApiTag(string Id, string Name, string? Color, string? CreatedAt, string? UpdatedAt, string? DeletedAt, string? Order = null);

/// <summary>
/// Someone a task's <c>assignees</c> can name: a person (<c>user:&lt;id&gt;</c>) or a group
/// (<c>group:&lt;id&gt;</c>), with the name the apps show. <c>assignable</c>: you may assign them.
/// Since PL-142 also the colour of their initials (a group's own colour) and, when asked for, their
/// photo as an image data URL (null otherwise, and when they have none).
/// </summary>
public sealed record ApiPerson(string Id, string Kind, string Name, string? Handle, bool Me, bool Assignable, string? AvatarColor = null, string? Photo = null);

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
    public static ApiTask Task(JsonObject doc, ApiNames names)
    {
        string? Name(IReadOnlyDictionary<string, string> named, string? id) => id is not null && named.TryGetValue(id, out var name) ? name : null;
        var bare = Task(doc, names.Tags);
        return bare with
        {
            ListName = Name(names.Lists, Text(doc, "listId")),
            SectionName = Name(names.Sections, Text(doc, "sectionId")),
            AssigneeNames = bare.Assignees.Where(names.People.ContainsKey).ToDictionary(key => key, key => names.People[key], StringComparer.Ordinal),
            CreatedByName = Name(names.People, Text(doc, "createdBy") is { } maker ? $"user:{maker}" : null),
            CompletedByName = Name(names.People, Text(doc, "completedBy") is { } closer ? $"user:{closer}" : null),
            Reminders = Reminders(doc),
            ConstantReminder = Flag(doc, "constantReminder"),
        };
    }

    /// <summary>A task's reminders, as the workspace keeps them (anything else in the array is left out).</summary>
    public static IReadOnlyList<ApiReminder> Reminders(JsonObject doc) =>
        doc["reminders"] is JsonArray reminders
            ? [.. reminders.OfType<JsonObject>().Select(reminder =>
                    Text(reminder, "at") is { } at ? new ApiReminder(null, at)
                    : reminder["before"] is JsonValue before && before.TryGetValue<int>(out var minutes) ? new ApiReminder(minutes, null)
                    : null).OfType<ApiReminder>()]
            : [];

    /// <summary>A task's priority, 0 (none) to 3 (high).</summary>
    public static int PriorityOf(JsonObject doc) => Number(doc, "priority");

    /// <summary>The longest photo a profile may hold (the workspace schema's <c>maxLength</c>).</summary>
    public const int MaxPhoto = 80_000;

    /// <summary>
    /// A profile's photo when it is a PNG, JPEG or WebP data URL of at most <see cref="MaxPhoto"/>
    /// characters, as the apps store it; anything else is null (writes are held to the same by the
    /// schema; this also covers data from before it).
    /// </summary>
    public static string? Photo(JsonObject profile) =>
        Text(profile, "photo") is { Length: > 0 and <= MaxPhoto } photo
            && (photo.StartsWith("data:image/png;base64,", StringComparison.Ordinal)
                || photo.StartsWith("data:image/jpeg;base64,", StringComparison.Ordinal)
                || photo.StartsWith("data:image/webp;base64,", StringComparison.Ordinal))
            && photo.AsSpan(photo.IndexOf(',') + 1).IndexOfAnyExcept("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=") < 0
            ? photo
            : null;

    /// <summary>A profile's name as the apps show it: its display name, else its handle.</summary>
    public static string PersonName(JsonObject profile, string id) => Text(profile, "displayName") ?? Text(profile, "handle") ?? id;

    private static ApiTask Task(JsonObject doc, IReadOnlyDictionary<string, string> tagNames) => new(
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
        DeletedAt: Text(doc, "deletedAt"),
        ListName: null,
        SectionName: null,
        AssigneeNames: new Dictionary<string, string>(),
        CreatedByName: null,
        CompletedByName: null,
        Reminders: [],
        ConstantReminder: false,
        Order: Text(doc, "order"));

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
        DeletedAt: Text(doc, "deletedAt"),
        Icon: Text(doc, "icon"),
        Order: Text(doc, "order"));

    public static ApiSection Section(JsonObject doc) => new(
        Text(doc, "id") ?? "", Text(doc, "listId"), Text(doc, "name") ?? "", Text(doc, "createdAt"), UpdatedAt(doc), Text(doc, "deletedAt"), Text(doc, "order"));

    public static ApiTag Tag(JsonObject doc) => new(
        Text(doc, "id") ?? "", Text(doc, "name") ?? "", Text(doc, "color"), Text(doc, "createdAt"), UpdatedAt(doc), Text(doc, "deletedAt"), Text(doc, "order"));

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
