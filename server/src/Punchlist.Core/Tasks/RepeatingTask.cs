using System.Globalization;
using System.Text.Json.Nodes;
using Punchlist.Core.Sync;

namespace Punchlist.Core.Tasks;

/// <summary>
/// One occurrence of a repeating task closed by the server (Complete on an Android notification),
/// the way the app's setTaskStatus does it (web/src/core/tasks.ts, repeatTask): a closed copy
/// stays in history, and the task itself moves on to its next date (start, end and due shift by
/// the same days, times kept) with its subtasks open again.
/// </summary>
public static class RepeatingTask
{
    /// <summary>
    /// What to write, or null when the task does not repeat, has no date to count from, or this
    /// was its last time (it then closes like any task). <paramref name="task"/> is the whole
    /// stored task; <paramref name="subtasks"/> its live subtasks at any depth.
    /// </summary>
    public static IReadOnlyList<JsonObject>? Complete(
        JsonObject task,
        IEnumerable<JsonObject> subtasks,
        string userId,
        string doneAt,
        DateOnly doneOn,
        string historyId,
        Func<string> stamp)
    {
        var rule = Recurrence.Parse(Text(task, "recurrence"));
        var schedule = task["schedule"] as JsonObject;
        var due = task["due"] as JsonObject;
        var anchor = Text(schedule, "start") ?? Text(due, "at");
        if (rule is null || anchor is null || !TryDate(anchor, out var from)) return null;
        if (rule.Advance(from, doneOn) is not { } step) return null;
        var days = step.Date.DayNumber - from.DayNumber;
        string Shift(string value)
        {
            if (!TryDate(value, out var date)) return value;
            var moved = date.AddDays(days).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
            return value.Length > 10 ? $"{moved}T{value.Substring(11, Math.Min(5, value.Length - 11))}" : moved;
        }

        var made = stamp();
        var history = new JsonObject
        {
            ["title"] = Copy(task, "title"),
            ["notes"] = Copy(task, "notes"),
            ["listId"] = Copy(task, "listId"),
            ["sectionId"] = null,
            ["parentId"] = Copy(task, "parentId"),
            ["order"] = Copy(task, "order"),
            ["status"] = "done",
            ["completedAt"] = doneAt,
            ["completedBy"] = userId,
            ["priority"] = Copy(task, "priority"),
            ["schedule"] = Copy(task, "schedule"),
            ["due"] = Copy(task, "due"),
            ["tags"] = Members(task["tags"], made),
            ["assignees"] = Members(task["assignees"], made),
            ["blockedBy"] = new JsonObject(),
            ["recurrence"] = null,
            ["progress"] = Copy(task, "progress"),
        };
        // The app leaves out fields the task does not have (undefined), so the copy does too.
        foreach (var field in new[] { "notes", "priority", "progress", "order" })
        {
            if (!task.ContainsKey(field)) history.Remove(field);
        }
        var closed = ServerEntities.New(historyId, userId, "server", doneAt, made, history);

        JsonNode? movedSchedule = null;
        if (schedule is not null)
        {
            movedSchedule = schedule.DeepClone();
            if (Text(schedule, "start") is { } start) movedSchedule["start"] = Shift(start);
            movedSchedule["end"] = Text(schedule, "end") is { } end ? Shift(end) : null;
        }
        JsonNode? movedDue = null;
        if (due is not null)
        {
            movedDue = due.DeepClone();
            if (Text(due, "at") is { } at) movedDue["at"] = Shift(at);
        }
        var next = ServerEntities.Changed(task, stamp(), new JsonObject
        {
            ["schedule"] = movedSchedule,
            ["due"] = movedDue,
            ["recurrence"] = step.Rule.Format(),
            ["progress"] = 0,
            ["completedAt"] = null,
        });

        var written = new List<JsonObject> { closed, next };
        foreach (var subtask in subtasks)
        {
            if (Text(subtask, "status") == "open") continue;
            written.Add(ServerEntities.Changed(subtask, stamp(), new JsonObject
            {
                ["status"] = "open",
                ["completedAt"] = null,
                ["completedBy"] = null,
            }));
        }
        return written;
    }

    private static string? Text(JsonObject? entity, string field) =>
        entity?[field] is JsonValue value && value.TryGetValue<string>(out var text) ? text : null;

    private static JsonNode? Copy(JsonObject entity, string field) => entity[field]?.DeepClone();

    private static bool TryDate(string value, out DateOnly date) =>
        DateOnly.TryParseExact(value.Length >= 10 ? value[..10] : value, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out date);

    /// <summary>An element set with only what is in <paramref name="set"/> now, each added at <paramref name="at"/>.</summary>
    private static JsonObject Members(JsonNode? set, string at)
    {
        var result = new JsonObject();
        if (set is not JsonObject elements) return result;
        foreach (var (element, state) in elements.OrderBy(each => each.Key, StringComparer.Ordinal))
        {
            if (state is JsonObject item && item["in"] is JsonValue present && present.TryGetValue<bool>(out var isIn) && isIn)
            {
                result[element] = new JsonObject { ["in"] = true, ["hlc"] = at };
            }
        }
        return result;
    }
}
