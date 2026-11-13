using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using PeckList.Core.Sharing;
using PeckList.Core.Storage;

namespace PeckList.Core.Api;

/// <summary>What <c>GET /api/v1/tasks</c> filters on. Null means no filter.</summary>
public sealed record TaskFilter
{
    /// <summary>In any of these lists.</summary>
    public IReadOnlyList<string>? ListIds { get; init; }
    public string? SectionId { get; init; }
    /// <summary>A task id, or <see cref="TopLevel"/> for tasks with no parent.</summary>
    public string? ParentId { get; init; }
    /// <summary><c>open</c>, <c>done</c>, <c>wontdo</c>, or null for all.</summary>
    public string? Status { get; init; } = "open";
    /// <summary>With any of these tags (or one under it).</summary>
    public IReadOnlyList<string>? Tags { get; init; }
    public string? DueBefore { get; init; }
    public string? DueAfter { get; init; }
    public bool Deleted { get; init; }
    /// <summary>With one of these priorities (0 none to 3 high).</summary>
    public IReadOnlyCollection<int>? Priorities { get; init; }
    /// <summary><see cref="Me"/>, <see cref="Nobody"/>, <c>user:&lt;id&gt;</c> or <c>group:&lt;id&gt;</c>.</summary>
    public string? Assignee { get; init; }
    /// <summary>Words that must all be in the title or notes, in any order (case does not matter).</summary>
    public string? Text { get; init; }
    /// <summary>The id ends with this (the CLI's short ids).</summary>
    public string? IdSuffix { get; init; }

    public const string TopLevel = "none";
    public const string Me = "me";
    public const string Nobody = "none";
    public const int MaxText = 200;
    /// <summary>Different words in <see cref="Text"/>: each one is a pass over every task's notes, so there is a cap.</summary>
    public const int MaxWords = 8;

    /// <summary>The words of <see cref="Text"/>, each once whatever its case.</summary>
    public static string[] Words(string? text) =>
        text?.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries).Distinct(StringComparer.OrdinalIgnoreCase).ToArray() ?? [];
}

/// <summary>A cursor or filter value the API cannot take.</summary>
public sealed class ApiBadRequest(string code, string message) : Exception(message)
{
    public string Code { get; } = code;
}

/// <summary>
/// The task API's reads (PL-137): what one account sees, shaped by <see cref="ApiShapes"/>.
/// Visibility comes from the store's index of who sees what, as for sync; filters on a task's list,
/// parent and status run on the in-memory sharing index, and only a page's tasks load whole.
/// </summary>
public sealed partial class TaskQueries(IEntityStore store, SharingState sharing)
{
    public const int MaxPage = 500;
    public const int DefaultPage = 100;

    [GeneratedRegex("^[0-9A-Za-z_-]{1,64}$")]
    public static partial Regex IdPattern();

    /// <summary>
    /// An id of your own for something new: a ULID, as the apps make and the workspace schema
    /// requires of every entity (anything else would be refused when it is stored).
    /// </summary>
    [GeneratedRegex("^[0-9A-HJKMNP-TV-Z]{26}$")]
    public static partial Regex NewIdPattern();

    /// <summary>What an id of your own must be, for the field's problem.</summary>
    public const string NewIdRule = "must be a ULID: 26 characters of 0-9 and A-Z without I, L, O or U";

    [GeneratedRegex(@"^\d{4}-\d{2}-\d{2}$")]
    private static partial Regex DatePattern();

    [GeneratedRegex("^[0-9A-Za-z]{4,26}$")]
    private static partial Regex SuffixPattern();

    private async Task<SharingIndex> IndexAsync(CancellationToken cancellation)
    {
        await sharing.Loaded.WaitAsync(cancellation);
        return sharing.Index;
    }

    /// <summary>Live tags the account sees, by id: their names for tasks.</summary>
    public async Task<IReadOnlyList<StoredEntity>> TagsAsync(string userId, CancellationToken cancellation = default) =>
        await store.GetManyAsync(await store.VisibleIdsAsync(userId, "tags", deleted: false, cancellation), cancellation);

    public static Dictionary<string, string> TagNames(IEnumerable<StoredEntity> tags) =>
        tags.Where(tag => ApiShapes.Text(tag.Doc, "name") is not null)
            .ToDictionary(tag => tag.Id, tag => ApiShapes.Text(tag.Doc, "name")!, StringComparer.Ordinal);

    /// <summary>
    /// The live tags, lists, sections, people and groups that these tasks point at and the account
    /// sees. Only those are loaded: a person's doc carries a photo of up to 80 KB.
    /// </summary>
    public async Task<IReadOnlyList<StoredEntity>> NamedAsync(string userId, IEnumerable<JsonObject> tasks, CancellationToken cancellation = default)
    {
        var wanted = new Dictionary<string, HashSet<string>>(StringComparer.Ordinal)
        {
            ["tags"] = new(StringComparer.Ordinal), ["lists"] = new(StringComparer.Ordinal), ["sections"] = new(StringComparer.Ordinal),
            ["users"] = new(StringComparer.Ordinal), ["groups"] = new(StringComparer.Ordinal),
        };
        foreach (var doc in tasks)
        {
            wanted["tags"].UnionWith(ApiShapes.Members(doc, "tags"));
            if (ApiShapes.Text(doc, "listId") is { } listId) wanted["lists"].Add(listId);
            if (ApiShapes.Text(doc, "sectionId") is { } sectionId) wanted["sections"].Add(sectionId);
            if (ApiShapes.Text(doc, "createdBy") is { } maker) wanted["users"].Add(maker);
            if (ApiShapes.Text(doc, "completedBy") is { } closer) wanted["users"].Add(closer);
            foreach (var key in ApiShapes.Members(doc, "assignees"))
            {
                switch (key.Split(':', 2))
                {
                    case ["user", var id]: wanted["users"].Add(id); break;
                    case ["group", var id]: wanted["groups"].Add(id); break;
                }
            }
        }
        var ids = new List<string>();
        foreach (var (collection, some) in wanted)
        {
            if (some.Count == 0) continue;
            ids.AddRange((await store.VisibleIdsAsync(userId, collection, deleted: false, cancellation)).Where(some.Contains));
        }
        return ids.Count == 0 ? [] : await store.GetManyAsync(ids, cancellation);
    }

    /// <summary>The names these tasks point at, as the account sees them.</summary>
    public async Task<ApiNames> NamesAsync(string userId, IEnumerable<JsonObject> tasks, CancellationToken cancellation = default) =>
        ApiNames.Of(await NamedAsync(userId, tasks, cancellation));

    public async Task<IReadOnlyList<ApiList>> ListsAsync(string userId, bool archived, CancellationToken cancellation = default)
    {
        var index = await IndexAsync(cancellation);
        var lists = await store.GetManyAsync(await store.VisibleIdsAsync(userId, "lists", deleted: false, cancellation), cancellation);
        return [.. lists
            .Select(list => ApiShapes.List(list.Doc, index.ListRole(userId, list.Id)))
            .Where(list => archived || !list.Archived)
            .OrderBy(list => list.Id, StringComparer.Ordinal)];
    }

    public async Task<IReadOnlyList<ApiSection>> SectionsAsync(string userId, string? listId, CancellationToken cancellation = default)
    {
        var index = await IndexAsync(cancellation);
        var ids = (await store.VisibleIdsAsync(userId, "sections", deleted: false, cancellation))
            .Where(id => listId is null || ApiShapes.Text(index.DocOf(id), "listId") == listId).ToList();
        return [.. (await store.GetManyAsync(ids, cancellation)).Select(each => ApiShapes.Section(each.Doc)).OrderBy(each => each.Id, StringComparer.Ordinal)];
    }

    public async Task<IReadOnlyList<ApiTag>> TagListAsync(string userId, CancellationToken cancellation = default) =>
        [.. (await TagsAsync(userId, cancellation)).Select(each => ApiShapes.Tag(each.Doc)).OrderBy(each => each.Name, StringComparer.OrdinalIgnoreCase)];

    /// <summary>
    /// One entity of <paramref name="collection"/> the account sees, live or deleted, or null (also
    /// when it exists but is not theirs to see: the caller answers 404 either way).
    /// </summary>
    public async Task<StoredEntity?> FindAsync(string userId, string collection, string id, CancellationToken cancellation = default)
    {
        if (!IdPattern().IsMatch(id)) return null;
        var index = await IndexAsync(cancellation);
        if (!index.Viewers(id).Contains(userId)) return null;
        var stored = await store.GetAsync(id, cancellation);
        return stored?.Collection == collection ? stored : null;
    }

    public async Task<ApiTask?> TaskAsync(string userId, string id, CancellationToken cancellation = default) =>
        await FindAsync(userId, "tasks", id, cancellation) is { } task
            ? ApiShapes.Task(task.Doc, await NamesAsync(userId, [task.Doc], cancellation))
            : null;

    public async Task<ApiList?> ListAsync(string userId, string id, CancellationToken cancellation = default)
    {
        if (await FindAsync(userId, "lists", id, cancellation) is not { } list) return null;
        return ApiShapes.List(list.Doc, (await IndexAsync(cancellation)).ListRole(userId, id));
    }

    /// <summary>The filter's values the API cannot take, as the problem to answer with.</summary>
    private static void Check(TaskFilter filter)
    {
        if (filter.Status is not (null or "open" or "done" or "wontdo")) throw new ApiBadRequest("invalid_request", "status must be open, done, wontdo or all");
        foreach (var (name, value) in new[] { ("dueBefore", filter.DueBefore), ("dueAfter", filter.DueAfter) })
        {
            if (value is not null && (!DatePattern().IsMatch(value) || !DateOnly.TryParse(value, out _)))
            {
                throw new ApiBadRequest("invalid_request", $"{name} must be a date like 2026-11-10");
            }
        }
        if (filter.ListIds?.FirstOrDefault(id => !IdPattern().IsMatch(id)) is { } list) throw new ApiBadRequest("invalid_request", $"listId '{list}' is not an id");
        if (filter.Priorities?.Any(priority => priority is < 0 or > 3) == true) throw new ApiBadRequest("invalid_request", "priority must be 0 to 3 (none, low, medium, high)");
        if (filter.Assignee is { } assignee && assignee is not (TaskFilter.Me or TaskFilter.Nobody)
            && !(assignee.Split(':') is ["user" or "group", var id] && IdPattern().IsMatch(id)))
        {
            throw new ApiBadRequest("invalid_request", "assignee must be me, none, user:<id> or group:<id>");
        }
        if (filter.Text is { Length: > TaskFilter.MaxText }) throw new ApiBadRequest("invalid_request", $"q must be at most {TaskFilter.MaxText} characters");
        if (TaskFilter.Words(filter.Text).Length > TaskFilter.MaxWords) throw new ApiBadRequest("invalid_request", $"q must have at most {TaskFilter.MaxWords} different words");
        if (filter.IdSuffix is { } suffix && !SuffixPattern().IsMatch(suffix)) throw new ApiBadRequest("invalid_request", "idSuffix must be 4 to 26 letters and digits");
    }

    public async Task<ApiPage<ApiTask>> TasksAsync(string userId, TaskFilter filter, int limit, string? cursor, CancellationToken cancellation = default)
    {
        if (limit is < 1 or > MaxPage) throw new ApiBadRequest("invalid_request", $"limit must be 1 to {MaxPage}");
        if (cursor is not null && !IdPattern().IsMatch(cursor)) throw new ApiBadRequest("invalid_cursor", "not a cursor from this API");
        Check(filter);

        var index = await IndexAsync(cancellation);
        HashSet<string>? wantedTags = null;
        if (filter.Tags is { Count: > 0 } tags)
        {
            // A parent tag matches its children, as the app's filters do.
            wantedTags = TagNames(await TagsAsync(userId, cancellation)).Where(pair => tags.Any(tag => pair.Value.Equals(tag, StringComparison.OrdinalIgnoreCase)
                    || pair.Value.StartsWith(tag + "/", StringComparison.OrdinalIgnoreCase)))
                .Select(pair => pair.Key).ToHashSet(StringComparer.Ordinal);
        }
        var lists = filter.ListIds is { Count: > 0 } wantedLists ? wantedLists.ToHashSet(StringComparer.Ordinal) : null;
        // Assigned to me: to me by name, or to a group I am in (as the app's "Assigned to me").
        Func<string, bool>? assigned = filter.Assignee switch
        {
            null or TaskFilter.Nobody => null,
            TaskFilter.Me => key => key == $"user:{userId}" || (key.StartsWith("group:", StringComparison.Ordinal) && index.MayAssign(userId, [key])),
            var key => each => each == key,
        };
        // Every word somewhere in the title or the notes, in any order.
        var words = TaskFilter.Words(filter.Text);

        var candidates = new List<string>();
        foreach (var id in await store.VisibleIdsAsync(userId, "tasks", filter.Deleted, cancellation))
        {
            if (cursor is not null && string.CompareOrdinal(id, cursor) <= 0) continue;
            if (filter.IdSuffix is not null && !id.EndsWith(filter.IdSuffix, StringComparison.OrdinalIgnoreCase)) continue;
            var facts = index.DocOf(id);
            if (facts is null) continue;
            if (lists is not null && (ApiShapes.Text(facts, "listId") is not { } listId || !lists.Contains(listId))) continue;
            if (filter.ParentId is not null)
            {
                var parent = ApiShapes.Text(facts, "parentId");
                if (filter.ParentId == TaskFilter.TopLevel ? parent is not null : parent != filter.ParentId) continue;
            }
            if (filter.Status is not null && (ApiShapes.Text(facts, "status") ?? "open") != filter.Status) continue;
            candidates.Add(id);
        }

        bool Wanted(JsonObject doc)
        {
            if (filter.SectionId is not null && ApiShapes.Text(doc, "sectionId") != filter.SectionId) return false;
            if (wantedTags is not null && !ApiShapes.Members(doc, "tags").Any(wantedTags.Contains)) return false;
            if (filter.DueBefore is not null || filter.DueAfter is not null)
            {
                if (ApiShapes.DueDate(doc) is not { } date) return false;
                if (filter.DueBefore is not null && string.CompareOrdinal(date, filter.DueBefore) > 0) return false;
                if (filter.DueAfter is not null && string.CompareOrdinal(date, filter.DueAfter) < 0) return false;
            }
            if (filter.Priorities is { Count: > 0 } priorities && !priorities.Contains(ApiShapes.PriorityOf(doc))) return false;
            if (filter.Assignee == TaskFilter.Nobody && ApiShapes.Members(doc, "assignees").Any()) return false;
            if (assigned is not null && !ApiShapes.Members(doc, "assignees").Any(assigned)) return false;
            if (words.Length > 0)
            {
                var haystack = $"{ApiShapes.Text(doc, "title")}\n{ApiShapes.Text(doc, "notes")}";
                if (!words.All(word => haystack.Contains(word, StringComparison.OrdinalIgnoreCase))) return false;
            }
            return true;
        }

        var found = new List<JsonObject>();
        var chunk = Math.Max(limit, 100);
        for (var at = 0; at < candidates.Count && found.Count <= limit; at += chunk)
        {
            var ids = candidates.Skip(at).Take(chunk).ToList();
            var docs = (await store.GetManyAsync(ids, cancellation)).ToDictionary(each => each.Id, StringComparer.Ordinal);
            foreach (var id in ids)
            {
                if (!docs.TryGetValue(id, out var task) || task.Collection != "tasks" || !Wanted(task.Doc)) continue;
                found.Add(task.Doc);
                if (found.Count > limit) break;
            }
        }
        var more = found.Count > limit;
        var page = more ? found[..limit] : found;
        // Names for this page only, once its tasks are known.
        var names = await NamesAsync(userId, page, cancellation);
        List<ApiTask> items = [.. page.Select(doc => ApiShapes.Task(doc, names))];
        return new ApiPage<ApiTask>(items, more ? items[^1].Id : null);
    }
}
