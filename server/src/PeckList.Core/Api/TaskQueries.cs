using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using PeckList.Core.Sharing;
using PeckList.Core.Storage;

namespace PeckList.Core.Api;

/// <summary>What <c>GET /api/v1/tasks</c> filters on. Null means no filter.</summary>
public sealed record TaskFilter
{
    public string? ListId { get; init; }
    public string? SectionId { get; init; }
    /// <summary>A task id, or <see cref="TopLevel"/> for tasks with no parent.</summary>
    public string? ParentId { get; init; }
    /// <summary><c>open</c>, <c>done</c>, <c>wontdo</c>, or null for all.</summary>
    public string? Status { get; init; } = "open";
    public string? Tag { get; init; }
    public string? DueBefore { get; init; }
    public string? DueAfter { get; init; }
    public bool Deleted { get; init; }

    public const string TopLevel = "none";
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
            ? ApiShapes.Task(task.Doc, TagNames(await TagsAsync(userId, cancellation)))
            : null;

    public async Task<ApiList?> ListAsync(string userId, string id, CancellationToken cancellation = default)
    {
        if (await FindAsync(userId, "lists", id, cancellation) is not { } list) return null;
        return ApiShapes.List(list.Doc, (await IndexAsync(cancellation)).ListRole(userId, id));
    }

    public async Task<ApiPage<ApiTask>> TasksAsync(string userId, TaskFilter filter, int limit, string? cursor, CancellationToken cancellation = default)
    {
        if (limit is < 1 or > MaxPage) throw new ApiBadRequest("invalid_request", $"limit must be 1 to {MaxPage}");
        if (cursor is not null && !IdPattern().IsMatch(cursor)) throw new ApiBadRequest("invalid_cursor", "not a cursor from this API");
        if (filter.Status is not (null or "open" or "done" or "wontdo")) throw new ApiBadRequest("invalid_request", "status must be open, done, wontdo or all");
        foreach (var (name, value) in new[] { ("dueBefore", filter.DueBefore), ("dueAfter", filter.DueAfter) })
        {
            if (value is not null && (!DatePattern().IsMatch(value) || !DateOnly.TryParse(value, out _)))
            {
                throw new ApiBadRequest("invalid_request", $"{name} must be a date like 2026-11-10");
            }
        }

        var index = await IndexAsync(cancellation);
        var tags = await TagsAsync(userId, cancellation);
        var names = TagNames(tags);
        HashSet<string>? wantedTags = null;
        if (filter.Tag is { } tag)
        {
            // A parent tag matches its children, as the app's filters do.
            wantedTags = names.Where(pair => pair.Value.Equals(tag, StringComparison.OrdinalIgnoreCase)
                    || pair.Value.StartsWith(tag + "/", StringComparison.OrdinalIgnoreCase))
                .Select(pair => pair.Key).ToHashSet(StringComparer.Ordinal);
        }

        var candidates = new List<string>();
        foreach (var id in await store.VisibleIdsAsync(userId, "tasks", filter.Deleted, cancellation))
        {
            if (cursor is not null && string.CompareOrdinal(id, cursor) <= 0) continue;
            var facts = index.DocOf(id);
            if (facts is null) continue;
            if (filter.ListId is not null && ApiShapes.Text(facts, "listId") != filter.ListId) continue;
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
            return true;
        }

        var found = new List<ApiTask>();
        var chunk = Math.Max(limit, 100);
        for (var at = 0; at < candidates.Count && found.Count <= limit; at += chunk)
        {
            var ids = candidates.Skip(at).Take(chunk).ToList();
            var docs = (await store.GetManyAsync(ids, cancellation)).ToDictionary(each => each.Id, StringComparer.Ordinal);
            foreach (var id in ids)
            {
                if (!docs.TryGetValue(id, out var task) || task.Collection != "tasks" || !Wanted(task.Doc)) continue;
                found.Add(ApiShapes.Task(task.Doc, names));
                if (found.Count > limit) break;
            }
        }
        var more = found.Count > limit;
        var page = more ? found[..limit] : found;
        return new ApiPage<ApiTask>(page, more ? page[^1].Id : null);
    }
}
