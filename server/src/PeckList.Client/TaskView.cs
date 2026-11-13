using System.Globalization;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace PeckList.Client;

/// <summary>
/// How the CLI shows tasks (PL-142): a table with a clear status, the date, priority, list and
/// tags by name, subtasks under their parent, and an id short enough to copy. Plain ASCII, so it
/// reads the same in any terminal's code page.
/// </summary>
internal static partial class TaskView
{
    /// <summary>One line of the table: a task, how deep it sits under a parent shown above it, and the parent it names when that parent is not shown.</summary>
    internal sealed record Row(JsonNode Task, int Depth, string? ParentTitle);

    /// <summary>Ids are shown by their last characters: at least this many, more when two shown would look alike.</summary>
    public const int ShortId = 6;

    [GeneratedRegex("^[0-9A-Za-z]{4,25}$")]
    internal static partial Regex ShortIdPattern();

    [GeneratedRegex(@"^\s*[-*+]\s+\[([ xX])\]\s?(.*)$")]
    private static partial Regex CheckboxPattern();

    private static string? Text(JsonNode? node, string key) => ClientCli.Text(node, key);

    private static int Number(JsonNode? node, string key) =>
        node?[key] is JsonValue value && value.TryGetValue<int>(out var number) ? number : 0;

    public static string Status(JsonNode task) =>
        Text(task, "deletedAt") is not null ? "deleted"
        : Text(task, "status") switch { "done" => "done", "wontdo" => "won't do", _ => "open" };

    public static string Priority(JsonNode task) =>
        Number(task, "priority") switch { 3 => "high", 2 => "medium", 1 => "low", _ => "" };

    /// <summary>The list's name, and its section's after a slash; a list the reader cannot see is "(hidden list)".</summary>
    public static string ListLabel(JsonNode task)
    {
        var list = Text(task, "listName") ?? (Text(task, "listId") is null ? "" : "(hidden list)");
        return Text(task, "sectionName") is { } section ? $"{list} / {section}" : list;
    }

    public static string Tags(JsonNode task) =>
        string.Join(' ', (task["tags"] as JsonArray ?? []).Select(tag => $"#{(string?)tag}"));

    /// <summary>Who it is assigned to, by name (an id when the name is not known).</summary>
    public static string Assigned(JsonNode task)
    {
        var names = task["assigneeNames"] as JsonObject;
        return string.Join(", ", (task["assignees"] as JsonArray ?? []).Select(each => (string?)each ?? "")
            .Select(key => Text(names, key) ?? key));
    }

    /// <summary>The date a task counts as due on: its due date, else its start (as the API's due filters count).</summary>
    public static string? When(JsonNode task) => Text(task["due"], "at") ?? Text(task["schedule"], "start");

    /// <summary>A local date or date-time from the API as people say it: today, tomorrow, Fri 14 Nov, 14 Nov 2027, with the time when it has one.</summary>
    public static string Day(string? at, DateOnly today)
    {
        if (at is not { Length: >= 10 } || !DateOnly.TryParseExact(at[..10], "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var date)) return at ?? "";
        var day = (date.DayNumber - today.DayNumber) switch
        {
            0 => "today",
            1 => "tomorrow",
            -1 => "yesterday",
            _ when date.Year == today.Year => date.ToString("ddd d MMM", CultureInfo.InvariantCulture),
            _ => date.ToString("d MMM yyyy", CultureInfo.InvariantCulture),
        };
        return at.Length >= 16 ? $"{day} {at[11..16]}" : day;
    }

    /// <summary>The table's date: due, else start, and "late" for an open task whose day has gone.</summary>
    public static string DateCell(JsonNode task, DateOnly today)
    {
        var at = When(task);
        if (at is null) return "";
        var late = Status(task) == "open" && at.Length >= 10 && string.CompareOrdinal(at[..10], today.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)) < 0;
        return Day(at, today) + (late ? ", late" : "");
    }

    /// <summary>An instant from the API (UTC) as a local date and time: 2026-11-10 14:02.</summary>
    public static string Local(string? instant, TimeZoneInfo zone) =>
        DateTimeOffset.TryParse(instant, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var at)
            ? TimeZoneInfo.ConvertTime(at, zone).ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture)
            : instant ?? "";

    /// <summary>How many of their last characters tell these ids apart: <see cref="ShortId"/>, or more.</summary>
    public static int ShortLength(IEnumerable<string> ids)
    {
        var all = ids.Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        for (var length = ShortId; length < 26; length++)
        {
            if (all.Select(id => Short(id, length)).Distinct(StringComparer.OrdinalIgnoreCase).Count() == all.Count) return length;
        }
        return 26;
    }

    public static string Short(string id, int length = ShortId) => id.Length <= length ? id : id[^length..];

    /// <summary>
    /// The tasks in the order asked for: due (soonest first, undated last), priority (high first),
    /// title, list, status (open first), created or updated (oldest first); a leading - reverses.
    /// Ties go by due date, then title.
    /// </summary>
    public static List<JsonNode> Sort(IEnumerable<JsonNode> tasks, string? key)
    {
        var descending = key?.StartsWith('-') == true;
        var name = (descending ? key![1..] : key) ?? "due";
        // Every key a string compared ordinally, so the order is the same in every culture; missing sorts last.
        static string Key(string? text) => text ?? "￿";
        Func<JsonNode, string> primary = name switch
        {
            "due" => task => Key(When(task)),
            "priority" => task => (3 - Number(task, "priority")).ToString(CultureInfo.InvariantCulture),
            "title" => task => (Text(task, "title") ?? "").ToUpperInvariant(),
            "list" => task => ListLabel(task).ToUpperInvariant(),
            "status" => task => Status(task) switch { "open" => "0", "done" => "1", "won't do" => "2", _ => "3" },
            "created" => task => Key(Text(task, "createdAt")),
            "updated" => task => Key(Text(task, "updatedAt")),
            _ => throw new UsageException($"--sort is one of {string.Join(", ", CommandTable.Sorts)}, with - in front to reverse"),
        };
        var ordered = descending ? tasks.OrderByDescending(primary, StringComparer.Ordinal) : tasks.OrderBy(primary, StringComparer.Ordinal);
        return [.. ordered
            .ThenBy(task => Key(When(task)), StringComparer.Ordinal)
            .ThenBy(task => Text(task, "title") ?? "", StringComparer.OrdinalIgnoreCase)
            .ThenBy(task => Text(task, "id") ?? "", StringComparer.Ordinal)];
    }

    /// <summary>
    /// Subtasks moved under their parent (in the same order among themselves); a subtask whose
    /// parent is not among these names it, from <paramref name="parentTitles"/>.
    /// </summary>
    public static List<Row> Arrange(IReadOnlyList<JsonNode> sorted, IReadOnlyDictionary<string, string> parentTitles)
    {
        var shown = sorted.Select(task => Text(task, "id")).OfType<string>().ToHashSet(StringComparer.Ordinal);
        var children = sorted.Where(task => Text(task, "parentId") is { } parent && shown.Contains(parent))
            .ToLookup(task => Text(task, "parentId")!, StringComparer.Ordinal);
        var rows = new List<Row>();
        var placed = new HashSet<string>(StringComparer.Ordinal);
        void Place(JsonNode task, int depth, string? parentTitle)
        {
            if (Text(task, "id") is not { } id || !placed.Add(id)) return;
            rows.Add(new Row(task, depth, parentTitle));
            foreach (var child in children[id]) Place(child, depth + 1, null);
        }
        foreach (var task in sorted)
        {
            var parent = Text(task, "parentId");
            if (parent is not null && shown.Contains(parent)) continue;
            Place(task, 0, parent is null ? null : parentTitles.GetValueOrDefault(parent) ?? "a task not shown");
        }
        // A loop of parents (never made by the apps) still shows every task once.
        foreach (var task in sorted) Place(task, 0, null);
        return rows;
    }

    /// <summary>The table, header first. With a terminal width, titles are cut to fit (tags keep their place after them).</summary>
    public static List<string> Table(IReadOnlyList<Row> rows, bool wide, DateOnly today, TimeZoneInfo zone, int? width)
    {
        var shortLength = ShortLength(rows.Select(row => Text(row.Task, "id") ?? ""));
        string Title(Row row) =>
            new string(' ', row.Depth * 2) + (row.Depth > 0 ? "- " : "") + (Text(row.Task, "title") ?? "")
            + (row.ParentTitle is { } parent ? $" (in: {parent})" : "");
        var header = wide
            ? new[] { "ID", "STATUS", "START", "DUE", "PRI", "LIST", "ASSIGNED", "REPEATS", "PROGRESS", "CREATED", "CHANGED", "TITLE", "TAGS" }
            : ["ID", "STATUS", "DATE", "PRI", "LIST", "TITLE", "TAGS"];
        var cells = rows.Select(row =>
        {
            var task = row.Task;
            var id = Text(task, "id") ?? "";
            return wide
                ? new[]
                {
                    id, Status(task), Day(Text(task["schedule"], "start"), today), Day(Text(task["due"], "at"), today), Priority(task), ListLabel(task),
                    Assigned(task), Text(task, "recurrence") ?? "", Number(task, "progress") is > 0 and var progress ? $"{progress}%" : "",
                    Local(Text(task, "createdAt"), zone), Local(Text(task, "updatedAt"), zone), Title(row), Tags(task),
                }
                : [Short(id, shortLength), Status(task), DateCell(task, today), Priority(task), ListLabel(task), Title(row), Tags(task)];
        }).Prepend(header).ToList();

        var title = header.Length - 2;
        var widths = Enumerable.Range(0, header.Length).Select(column => cells.Max(row => row[column].Length)).ToArray();
        if (width is { } available)
        {
            var fixedPart = widths.Take(title).Sum() + 2 * title;
            var room = available - fixedPart - 2 - widths[^1];
            if (widths[title] > room) widths[title] = Math.Max(16, room);
        }
        var lines = new List<string>();
        foreach (var row in cells)
        {
            var line = new StringBuilder();
            for (var column = 0; column < row.Length; column++)
            {
                var cell = row[column];
                if (column == title && cell.Length > widths[title]) cell = cell[..(widths[title] - 3)] + "...";
                if (column < row.Length - 1) line.Append(cell.PadRight(widths[column])).Append("  ");
                else line.Append(cell);
            }
            lines.Add(line.ToString().TrimEnd());
        }
        return lines;
    }

    /// <summary>"5 tasks: 3 open, 1 done, 1 won't do", and how many of them are shown when that is fewer.</summary>
    public static string Footer(IReadOnlyCollection<JsonNode> all, int shown)
    {
        var counts = all.GroupBy(Status).OrderBy(group => Array.IndexOf(["open", "done", "won't do", "deleted"], group.Key))
            .Select(group => $"{group.Count()} {group.Key}");
        var footer = $"{all.Count} {(all.Count == 1 ? "task" : "tasks")}: {string.Join(", ", counts)}";
        return shown < all.Count ? $"{footer} (showing {shown})" : footer;
    }

    /// <summary>
    /// --due as the API's dueAfter and dueBefore: today, tomorrow, overdue (before today), week
    /// (today and the 6 days after), a date, or a range FROM..TO with either end left off.
    /// </summary>
    public static (string? After, string? Before) DueRange(string text, DateOnly today)
    {
        static string Iso(DateOnly date) => date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        UsageException Wrong() => new($"--due '{text}' is not one of today, tomorrow, overdue, week, a date (2026-11-30) or a range (2026-11-01..2026-11-30)");
        DateOnly? Date(string part) =>
            part.Length == 0 ? null
            : DateOnly.TryParseExact(part, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var date) ? date
            : throw Wrong();
        switch (text.ToLowerInvariant())
        {
            case "today": return (Iso(today), Iso(today));
            case "tomorrow": return (Iso(today.AddDays(1)), Iso(today.AddDays(1)));
            case "overdue": return (null, Iso(today.AddDays(-1)));
            case "week": return (Iso(today), Iso(today.AddDays(6)));
        }
        var cut = text.IndexOf("..", StringComparison.Ordinal);
        var (from, to) = cut < 0 ? (Date(text), Date(text)) : (Date(text[..cut]), Date(text[(cut + 2)..]));
        if (from is null && to is null) throw Wrong();
        if (from > to) throw new UsageException($"--due {text}: the range ends before it starts");
        return (from is { } start ? Iso(start) : null, to is { } end ? Iso(end) : null);
    }

    /// <summary>--priority as the API's priority: names or 0 to 3, comma separated, or LEVEL+ for that level and up.</summary>
    public static string Priorities(string text)
    {
        static int Level(string name) => name.Trim().ToLowerInvariant() switch
        {
            "none" or "0" => 0,
            "low" or "1" => 1,
            "medium" or "med" or "2" => 2,
            "high" or "3" => 3,
            _ => throw new UsageException("--priority is high, medium, low or none (comma separated), or medium+ for medium and high"),
        };
        var levels = new SortedSet<int>();
        foreach (var part in text.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            if (part.EndsWith('+')) levels.UnionWith(Enumerable.Range(Level(part[..^1]), 4).Where(level => level <= 3));
            else levels.Add(Level(part));
        }
        return levels.Count > 0 ? string.Join(',', levels) : throw new UsageException("--priority needs a level: high, medium, low or none");
    }

    /// <summary>The notes' checkbox lines (- [ ] and - [x]), as the app's checklists are kept.</summary>
    public static List<(bool Done, string Text)> Checklist(string notes) =>
        [.. notes.ReplaceLineEndings("\n").Split('\n').Select(line => CheckboxPattern().Match(line))
            .Where(match => match.Success).Select(match => (match.Groups[1].Value is "x" or "X", match.Groups[2].Value.Trim()))];

    /// <summary>The notes without their checkbox lines, trimmed.</summary>
    public static string NotesWithoutChecklist(string notes) =>
        string.Join('\n', notes.ReplaceLineEndings("\n").Split('\n').Where(line => !CheckboxPattern().IsMatch(line))).Trim();

    /// <summary>A reminder as people say it: 30 minutes before, 2 hours before, 1 day before, at the time, or its date and time.</summary>
    public static string Reminder(JsonNode reminder, DateOnly today)
    {
        if (Text(reminder, "at") is { } at) return Day(at, today);
        var minutes = Number(reminder, "before");
        string Unit(int count, string unit) => $"{count} {unit}{(count == 1 ? "" : "s")} before";
        return minutes switch
        {
            0 => "at the time",
            >= 1440 when minutes % 1440 == 0 => Unit(minutes / 1440, "day"),
            >= 60 when minutes % 60 == 0 => Unit(minutes / 60, "hour"),
            _ => Unit(minutes, "minute"),
        };
    }
}
