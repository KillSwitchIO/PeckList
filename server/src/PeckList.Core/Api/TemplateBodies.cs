using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using PeckList.Core.Tasks;

namespace PeckList.Core.Api;

/// <summary>A date in a template: days from the day it is used, and a time of day or none (all day).</summary>
public sealed record TemplateDate(int InDays, string? Time);

/// <summary>A reminder in a template: minutes before the task's time, or a date of its own.</summary>
public sealed record TemplateReminder(int? Before, TemplateDate? At);

/// <summary>A task in a template, checked (web/src/core/templates.ts readTask).</summary>
public sealed record TemplateTask(
    string Title,
    string Notes,
    int Priority,
    IReadOnlyList<string> Tags,
    TemplateDate? Start,
    TemplateDate? End,
    TemplateDate? Due,
    IReadOnlyList<TemplateReminder> Reminders,
    string? Recurrence,
    bool ConstantReminder,
    IReadOnlyList<TemplateTask> Subtasks);

/// <summary>A list in a template: its look and its top-level tasks.</summary>
public sealed record TemplateList(string Name, string Color, string? Icon, IReadOnlyList<TemplateTask> Tasks);

/// <summary>
/// Template bodies (PL-140) read on the server as the apps read them: a body syncs as plain JSON from
/// any device, so it is checked on the way in, never trusted. What can't be read is left out, not
/// refused, exactly as web/src/core/templates.ts does, so the API makes what the app would.
/// </summary>
public static partial class TemplateBodies
{
    /// <summary>The most tasks one template holds, subtasks included (MAX_TEMPLATE_TASKS).</summary>
    public const int MaxTasks = 200;

    /// <summary>The most reminders a task keeps (MAX_REMINDERS).</summary>
    public const int MaxReminders = 10;

    // What a task's reminder may say (schema/task: a day before the time to a year after).
    private const int BeforeMin = -1439;
    private const int BeforeMax = 525600;

    [GeneratedRegex("^(?:[01][0-9]|2[0-3]):[0-5][0-9]$")]
    private static partial Regex TimePattern();

    /// <summary>A task template's body, checked; null when it is not a task template.</summary>
    public static TemplateTask? Task(JsonObject template)
    {
        if (ApiShapes.Text(template, "kind") != "task") return null;
        var budget = new Budget(MaxTasks);
        return ReadTask(template["body"], budget);
    }

    /// <summary>The colour a list template's list takes when its body names none the app can use.</summary>
    public const string FallbackColor = "#808080";

    [GeneratedRegex("^#[0-9a-fA-F]{6}$")]
    private static partial Regex ColorPattern();

    /// <summary>A list template's body, checked (web listBody); null when it is not a list template.</summary>
    public static TemplateList? List(JsonObject template)
    {
        if (ApiShapes.Text(template, "kind") != "list") return null;
        var body = template["body"] as JsonObject;
        var budget = new Budget(MaxTasks);
        var name = Text(body?["name"]) is { } named ? Cut(named, 200) : ApiShapes.Text(template, "name") ?? "";
        var color = Text(body?["color"]) is { } given && ColorPattern().IsMatch(given) ? given : FallbackColor;
        var icon = Text(body?["icon"]) is { Length: > 0 } shown ? Cut(shown, 64) : null;
        var tasks = (body?["tasks"] as JsonArray ?? []).Select(each => ReadTask(each, budget)).OfType<TemplateTask>().ToList();
        return new TemplateList(name, color, icon, tasks);
    }

    /// <summary>How many tasks a template makes, subtasks included.</summary>
    public static int TaskCount(JsonObject template)
    {
        static int Count(IEnumerable<TemplateTask> tasks) => tasks.Sum(task => 1 + Count(task.Subtasks));
        return Task(template) is { } task ? Count([task]) : List(template) is { } list ? Count(list.Tasks) : 0;
    }

    /// <summary>A template date on a day: the day <paramref name="inDays"/> on, with its time when it has one.</summary>
    public static string On(TemplateDate date, DateOnly day)
    {
        var at = day.AddDays(date.InDays).ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture);
        return date.Time is null ? at : $"{at}T{date.Time}";
    }

    private sealed class Budget(int left)
    {
        public int Left { get; set; } = left;
    }

    private static string? Text(JsonNode? node) =>
        node is JsonValue value && value.TryGetValue<string>(out var text) ? text : null;

    private static string Cut(string text, int max) => text.Length <= max ? text : text[..max];

    private static int? Whole(JsonNode? node)
    {
        if (node is not JsonValue value) return null;
        if (value.TryGetValue<int>(out var whole)) return whole;
        return value.TryGetValue<double>(out var number) && number == Math.Floor(number) && Math.Abs(number) <= int.MaxValue ? (int)number : null;
    }

    private static TemplateDate? ReadDate(JsonNode? node)
    {
        if (node is not JsonObject date) return null;
        if (Whole(date["inDays"]) is not { } inDays || Math.Abs(inDays) > 36500) return null;
        var time = Text(date["time"]);
        return new TemplateDate(inDays, time is not null && TimePattern().IsMatch(time) ? time : null);
    }

    private static TemplateReminder? ReadReminder(JsonNode? node)
    {
        if (node is not JsonObject reminder) return null;
        if (Whole(reminder["before"]) is { } before)
        {
            return before is >= BeforeMin and <= BeforeMax ? new TemplateReminder(before, null) : null;
        }
        return ReadDate(reminder["at"]) is { } at ? new TemplateReminder(null, at) : null;
    }

    private static int Minutes(TemplateDate date) =>
        date.InDays * 1440 + (date.Time is { } time ? int.Parse(time[..2]) * 60 + int.Parse(time[3..]) : 0);

    private static TemplateTask? ReadTask(JsonNode? node, Budget budget)
    {
        if (node is not JsonObject task || budget.Left <= 0) return null;
        budget.Left--;
        var priority = Whole(task["priority"]) is { } level && level is >= 0 and <= 3 ? level : 0;
        var start = ReadDate(task["start"]);
        var end = ReadDate(task["end"]);
        var rule = Text(task["recurrence"]);
        return new TemplateTask(
            Title: Cut(Text(task["title"]) ?? "", 1000),
            Notes: Cut(Text(task["notes"]) ?? "", 100000),
            Priority: priority,
            Tags: [.. (task["tags"] as JsonArray ?? []).Select(Text).OfType<string>()],
            Start: start,
            // An end only after its start: one before it would make a task the server refuses.
            End: start is not null && end is not null && Minutes(end) >= Minutes(start) ? end : null,
            Due: ReadDate(task["due"]),
            Reminders: [.. (task["reminders"] as JsonArray ?? []).Select(ReadReminder).OfType<TemplateReminder>().Take(MaxReminders)],
            // A rule the server can't read is dropped, not made into a task (Security, PL-140).
            Recurrence: rule is not null && Recurrence.Parse(rule) is not null ? rule : null,
            ConstantReminder: task["constantReminder"] is JsonValue constant && constant.TryGetValue<bool>(out var on) && on,
            Subtasks: [.. (task["subtasks"] as JsonArray ?? []).Select(each => ReadTask(each, budget)).OfType<TemplateTask>()]);
    }
}
