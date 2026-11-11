using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using PeckList.Core.Tasks;

namespace PeckList.Core.Api;

/// <summary>
/// A task body sent to the task API (PL-137), checked field by field. A field that is absent is
/// left alone; one sent as null clears it. Values come out in the workspace's own shapes.
/// </summary>
public sealed partial class TaskInput
{
    /// <summary>The fields to set on the task, in workspace form (no clocks yet).</summary>
    public JsonObject Fields { get; } = new();

    public string? Id { get; private set; }
    /// <summary>Sent and not null: the list to put it in. A move when it differs.</summary>
    public string? ListId { get; private set; }
    public bool HasSection { get; private set; }
    public bool HasParent { get; private set; }
    public string? SectionId { get; private set; }
    public string? ParentId { get; private set; }
    /// <summary>The whole set of tag names (<c>tags</c>), or null when not sent.</summary>
    public IReadOnlyList<string>? Tags { get; private set; }
    public IReadOnlyList<string> AddTags { get; private set; } = [];
    public IReadOnlyList<string> RemoveTags { get; private set; } = [];
    /// <summary>The whole set of assignees, or null when not sent.</summary>
    public IReadOnlyList<string>? Assignees { get; private set; }
    /// <summary>Sent and not null: pin (true) or unpin (false).</summary>
    public bool? Pinned { get; private set; }
    /// <summary>The status sent, if any (only the unchanged one is taken on a PATCH).</summary>
    public string? Status { get; private set; }
    /// <summary>Schedule or due sent without a time zone: the writer fills in the account's.</summary>
    public bool NeedsZone { get; private set; }

    public Dictionary<string, string[]> Errors { get; } = new(StringComparer.Ordinal);

    public bool Valid => Errors.Count == 0;

    private void Fail(string field, string message) => Errors[field] = [message];

    public const int MaxTitle = 1000;
    public const int MaxNotes = 80000;
    public const int MaxTags = 100;
    public const int MaxInterval = 999;

    /// <summary>Fields a client may send back as it read them; they are not changed by a write.</summary>
    private static readonly HashSet<string> ReadOnly = ["completedAt", "completedBy", "createdAt", "createdBy", "updatedAt", "deletedAt"];

    private static readonly HashSet<string> Known =
    [
        "id", "title", "notes", "listId", "sectionId", "parentId", "status", "priority", "schedule", "due",
        "tags", "addTags", "removeTags", "assignees", "recurrence", "progress", "pinned",
    ];

    [GeneratedRegex(@"^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$")]
    private static partial Regex LocalMoment();

    [GeneratedRegex("^((user|group):[0-9A-HJKMNP-TV-Z]{26})$")]
    private static partial Regex Principal();

    /// <param name="create">A create: <c>title</c> is required, and <c>id</c> may be given.</param>
    public static TaskInput Parse(JsonObject body, bool create)
    {
        var input = new TaskInput();
        foreach (var (field, _) in body)
        {
            if (!Known.Contains(field) && !ReadOnly.Contains(field)) input.Fail(field, "not a field of a task");
        }
        // On a PATCH the id comes from the address: one in the body (a task sent back as read) is ignored.
        if (create && body.ContainsKey("id"))
        {
            if (Text(body["id"]) is { } id && TaskQueries.NewIdPattern().IsMatch(id)) input.Id = id;
            else input.Fail("id", TaskQueries.NewIdRule);
        }
        if (body.ContainsKey("title"))
        {
            if (Text(body["title"]) is not { } title) input.Fail("title", "must be text");
            else if (title.Trim().Length == 0) input.Fail("title", "must not be empty");
            else if (title.Length > MaxTitle) input.Fail("title", $"at most {MaxTitle} characters");
            else input.Fields["title"] = title.Trim();
        }
        else if (create)
        {
            input.Fail("title", "is required");
        }
        if (body.ContainsKey("notes"))
        {
            var notes = body["notes"] is null ? "" : Text(body["notes"]);
            if (notes is null) input.Fail("notes", "must be text");
            else if (notes.Length > MaxNotes) input.Fail("notes", $"at most {MaxNotes} characters");
            else input.Fields["notes"] = notes;
        }
        if (body.ContainsKey("listId"))
        {
            if (Text(body["listId"]) is { } list && TaskQueries.IdPattern().IsMatch(list)) input.ListId = list;
            else input.Fail("listId", "must be a list id");
        }
        if (body.ContainsKey("sectionId"))
        {
            input.HasSection = true;
            if (body["sectionId"] is null) input.SectionId = null;
            else if (Text(body["sectionId"]) is { } section && TaskQueries.IdPattern().IsMatch(section)) input.SectionId = section;
            else input.Fail("sectionId", "must be a section id or null");
        }
        if (body.ContainsKey("parentId"))
        {
            input.HasParent = true;
            if (body["parentId"] is null) input.ParentId = null;
            else if (Text(body["parentId"]) is { } parent && TaskQueries.IdPattern().IsMatch(parent)) input.ParentId = parent;
            else input.Fail("parentId", "must be a task id or null");
        }
        if (body.ContainsKey("status"))
        {
            if (Text(body["status"]) is "open" or "done" or "wontdo") input.Status = Text(body["status"]);
            else input.Fail("status", "must be open, done or wontdo");
            if (create && input.Status is not (null or "open")) input.Fail("status", "a new task is open; complete it afterwards");
        }
        if (body.ContainsKey("priority"))
        {
            if (Int(body["priority"]) is { } priority and >= 0 and <= 3) input.Fields["priority"] = priority;
            else input.Fail("priority", "must be 0 to 3");
        }
        if (body.ContainsKey("progress"))
        {
            if (Int(body["progress"]) is { } progress and >= 0 and <= 100 && progress % 10 == 0) input.Fields["progress"] = progress;
            else input.Fail("progress", "must be 0 to 100 in steps of 10");
        }
        if (body.ContainsKey("recurrence"))
        {
            if (body["recurrence"] is null) input.Fields["recurrence"] = null;
            else if (Text(body["recurrence"]) is { } rule && rule.Length <= 500 && Recurrence.Parse(rule) is { } parsed)
            {
                if (parsed.Interval <= MaxInterval) input.Fields["recurrence"] = rule;
                else input.Fail("recurrence", $"INTERVAL must be at most {MaxInterval}");
            }
            else input.Fail("recurrence", "must be an RRULE such as FREQ=WEEKLY;BYDAY=SA, or null");
        }
        if (body.ContainsKey("schedule")) input.Moment(body["schedule"], "schedule", "start");
        if (body.ContainsKey("due")) input.Moment(body["due"], "due", "at");
        if (body.ContainsKey("tags")) input.Tags = input.Names(body["tags"], "tags");
        if (body.ContainsKey("addTags")) input.AddTags = input.Names(body["addTags"], "addTags") ?? [];
        if (body.ContainsKey("removeTags")) input.RemoveTags = input.Names(body["removeTags"], "removeTags") ?? [];
        if (input.Tags is not null && (body.ContainsKey("addTags") || body.ContainsKey("removeTags")))
        {
            input.Fail("tags", "send tags, or addTags and removeTags, not both");
        }
        if (body.ContainsKey("assignees"))
        {
            if (body["assignees"] is not JsonArray list || list.Count > 50) input.Fail("assignees", "must be a list of user: or group: principals");
            else
            {
                var principals = list.Select(Text).ToList();
                if (principals.Any(each => each is null || !Principal().IsMatch(each))) input.Fail("assignees", "must be a list of user: or group: principals");
                else input.Assignees = [.. principals.OfType<string>().Distinct(StringComparer.Ordinal)];
            }
        }
        if (body.ContainsKey("pinned"))
        {
            if (body["pinned"] is JsonValue value && value.TryGetValue<bool>(out var pinned)) input.Pinned = pinned;
            else input.Fail("pinned", "must be true or false");
        }
        return input;
    }

    /// <summary>A schedule (<c>start</c>) or due date (<c>at</c>): null clears it.</summary>
    private void Moment(JsonNode? node, string field, string key)
    {
        if (node is null)
        {
            Fields[field] = null;
            return;
        }
        if (node is not JsonObject value)
        {
            Fail(field, $"must be an object with {key}, or null");
            return;
        }
        var allowed = field == "schedule" ? new[] { "start", "end", "allDay", "timeZone" } : ["at", "allDay", "timeZone"];
        if (value.Select(pair => pair.Key).FirstOrDefault(name => !allowed.Contains(name)) is { } unknown)
        {
            Fail(field, $"'{unknown}' is not part of it");
            return;
        }
        if (Text(value[key]) is not { } at || !IsMoment(at))
        {
            Fail(field, $"{key} must be a date (2026-11-10) or a local date-time (2026-11-10T09:00)");
            return;
        }
        string? end = null;
        if (field == "schedule" && value["end"] is not null)
        {
            end = Text(value["end"]);
            if (end is null || !IsMoment(end))
            {
                Fail(field, "end must be a date or a local date-time, or null");
                return;
            }
            if (string.CompareOrdinal(end, at) < 0)
            {
                Fail(field, "end must not be before start");
                return;
            }
        }
        var allDay = at.Length == 10;
        if (value["allDay"] is not null)
        {
            if (value["allDay"] is JsonValue flag && flag.TryGetValue<bool>(out var given)) allDay = given;
            else
            {
                Fail(field, "allDay must be true or false");
                return;
            }
        }
        string? zone = null;
        if (value["timeZone"] is not null)
        {
            zone = Text(value["timeZone"]);
            if (zone is null || zone.Length > 64 || !TimeZoneInfo.TryFindSystemTimeZoneById(zone, out _))
            {
                Fail(field, "timeZone must be an IANA zone such as America/Chicago");
                return;
            }
        }
        else
        {
            NeedsZone = true;
        }
        var result = new JsonObject { [key] = at };
        if (field == "schedule") result["end"] = end;
        result["allDay"] = allDay;
        result["timeZone"] = zone ?? "";
        Fields[field] = result;
    }

    private static bool IsMoment(string text) =>
        LocalMoment().IsMatch(text) && DateOnly.TryParseExact(text[..10], "yyyy-MM-dd", out _)
        && (text.Length == 10 || TimeOnly.TryParse(text[11..], System.Globalization.CultureInfo.InvariantCulture, out _));

    /// <summary>Tag names, normalized as the app does (<c>normalizeTagName</c>).</summary>
    private IReadOnlyList<string>? Names(JsonNode? node, string field)
    {
        if (node is not JsonArray list || list.Count > MaxTags)
        {
            Fail(field, $"must be a list of at most {MaxTags} tag names");
            return null;
        }
        var names = new List<string>();
        foreach (var item in list)
        {
            var name = Text(item) is { } text ? NormalizeTag(text) : "";
            if (name.Length == 0 || name.Length > 100)
            {
                Fail(field, "each tag name must be 1 to 100 characters");
                return null;
            }
            if (!names.Contains(name, StringComparer.OrdinalIgnoreCase)) names.Add(name);
        }
        return names;
    }

    /// <summary><c>normalizeTagName</c> (web/src/core/tags.ts): lower case, spaces to dashes, empty segments gone.</summary>
    public static string NormalizeTag(string name) =>
        string.Join('/', name.Split('/')
            .Select(part => Regex.Replace(part.Trim().ToLowerInvariant(), @"\s+", "-"))
            .Where(part => part.Length > 0));

    internal static string? Text(JsonNode? node) => node is JsonValue value && value.TryGetValue<string>(out var text) ? text : null;

    private static int? Int(JsonNode? node) =>
        node is JsonValue value && value.TryGetValue<int>(out var number) ? number
        : node is JsonValue other && other.TryGetValue<double>(out var real) && real == Math.Floor(real) && real is >= int.MinValue and <= int.MaxValue ? (int)real
        : null;
}

/// <summary>A list or section body: a name, and for lists a color.</summary>
public sealed partial class NamedInput
{
    public string? Id { get; private set; }
    public string? Name { get; private set; }
    public string? Color { get; private set; }
    public string? ListId { get; private set; }
    public Dictionary<string, string[]> Errors { get; } = new(StringComparer.Ordinal);
    public bool Valid => Errors.Count == 0;

    public const int MaxName = 200;

    [GeneratedRegex("^#[0-9A-Fa-f]{6}$")]
    private static partial Regex ColorPattern();

    /// <param name="fields">The fields this body may hold besides <c>id</c> (on a create).</param>
    public static NamedInput Parse(JsonObject body, bool create, params string[] fields)
    {
        var input = new NamedInput();
        var known = new HashSet<string>(fields, StringComparer.Ordinal);
        if (create) known.Add("id");
        foreach (var (field, _) in body)
        {
            if (!known.Contains(field)) input.Errors[field] = ["not a field here"];
        }
        if (create && body.ContainsKey("id"))
        {
            if (TaskInput.Text(body["id"]) is { } id && TaskQueries.NewIdPattern().IsMatch(id)) input.Id = id;
            else input.Errors["id"] = [TaskQueries.NewIdRule];
        }
        if (body.ContainsKey("name"))
        {
            var name = TaskInput.Text(body["name"])?.Trim();
            if (string.IsNullOrEmpty(name) || name.Length > MaxName) input.Errors["name"] = [$"must be 1 to {MaxName} characters"];
            else input.Name = name;
        }
        else if (create)
        {
            input.Errors["name"] = ["is required"];
        }
        if (body.ContainsKey("color"))
        {
            if (TaskInput.Text(body["color"]) is { } color && ColorPattern().IsMatch(color)) input.Color = color.ToUpperInvariant();
            else input.Errors["color"] = ["must be a color such as #3A7D44"];
        }
        if (body.ContainsKey("listId"))
        {
            if (TaskInput.Text(body["listId"]) is { } list && TaskQueries.IdPattern().IsMatch(list)) input.ListId = list;
            else input.Errors["listId"] = ["must be a list id"];
        }
        else if (create && known.Contains("listId"))
        {
            input.Errors["listId"] = ["is required"];
        }
        return input;
    }
}
