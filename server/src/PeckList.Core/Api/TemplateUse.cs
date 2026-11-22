using System.Globalization;
using System.Text.Json.Nodes;

namespace PeckList.Core.Api;

/// <summary>One task a template's use makes: its depth under the top task (0) and its fields.</summary>
public sealed record PlannedTask(int Depth, JsonObject Fields, IReadOnlyList<string> Tags);

/// <summary>
/// What using a template makes (PL-140), as the app's Use makes it (web/src/core/templates.ts
/// makeTask): the tasks in order, top first, each followed by its subtasks. Ids, list and order are
/// the caller's. Both sides run the shared cases in schema/fixtures/templates/use.json, so the
/// server's copy of the rules can't drift from the app's.
/// </summary>
public static class TemplateUse
{
    /// <summary>The deepest a subtask may sit (MAX_SUBTASK_DEPTH).</summary>
    public const int MaxSubtaskDepth = 5;

    /// <summary>
    /// The tasks <paramref name="body"/> makes with its dates counted from <paramref name="day"/>, in
    /// <paramref name="zone"/>. <paramref name="onDay"/>: the place's own day (an add field for a day),
    /// which a task with no start and no due date goes on. <paramref name="depth"/>: the top task's
    /// depth where it goes (0 at the top of a list, its parent's plus one under a task). A tag not in
    /// <paramref name="liveTags"/> (deleted since the template was saved) is skipped. A subtask
    /// starts with its parent's tags, as any new subtask does: <paramref name="parentTags"/> are those
    /// of the task the top one goes under, if any.
    /// </summary>
    public static IReadOnlyList<PlannedTask> Tasks(
        TemplateTask body, DateOnly day, string zone, IReadOnlySet<string> liveTags, bool onDay, int depth = 0, IReadOnlyList<string>? parentTags = null)
    {
        var made = new List<PlannedTask>();
        Make(body, day, zone, liveTags, onDay, depth, 0, parentTags ?? [], made);
        return made;
    }

    private static void Make(
        TemplateTask task, DateOnly day, string zone, IReadOnlySet<string> liveTags, bool onDay, int depth, int level, IReadOnlyList<string> parentTags, List<PlannedTask> made)
    {
        var schedule = task.Start is { } start
            ? new JsonObject
            {
                ["start"] = TemplateBodies.On(start, day),
                ["end"] = task.End is { } end ? TemplateBodies.On(end, day) : null,
                ["allDay"] = start.Time is null,
                ["timeZone"] = zone,
            }
            : onDay && task.Due is null
                ? new JsonObject
                {
                    ["start"] = day.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), ["end"] = null, ["allDay"] = true, ["timeZone"] = zone,
                }
                : null;
        var due = task.Due is { } at
            ? new JsonObject { ["at"] = TemplateBodies.On(at, day), ["allDay"] = at.Time is null, ["timeZone"] = zone }
            : null;
        var reminders = new JsonArray([.. task.Reminders.Select(reminder => (JsonNode)(reminder.Before is { } before
            ? new JsonObject { ["before"] = before }
            : new JsonObject { ["at"] = TemplateBodies.On(reminder.At!, day) }))]);
        var fields = new JsonObject
        {
            ["title"] = task.Title,
            ["notes"] = task.Notes,
            ["priority"] = task.Priority,
            ["schedule"] = schedule,
            ["due"] = due,
            ["reminders"] = reminders,
            ["recurrence"] = task.Recurrence,
            ["constantReminder"] = task.ConstantReminder,
        };
        IReadOnlyList<string> tags = [.. task.Tags.Where(liveTags.Contains).Concat(parentTags).Distinct(StringComparer.Ordinal)];
        made.Add(new PlannedTask(level, fields, tags));
        // Subtasks nest only so deep: a body from elsewhere may go deeper, and those levels are left out.
        if (depth + 1 > MaxSubtaskDepth) return;
        foreach (var child in task.Subtasks) Make(child, day, zone, liveTags, false, depth + 1, level + 1, tags, made);
    }
}
