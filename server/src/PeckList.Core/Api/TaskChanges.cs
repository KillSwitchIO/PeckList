using PeckList.Core.Storage;

namespace PeckList.Core.Api;

public sealed partial class TaskQueries
{
    /// <summary>
    /// The changes feed: the sync feed after <paramref name="cursor"/>, keeping tasks, lists,
    /// sections and tags. A page may hold none of those and still say <c>More</c>.
    /// </summary>
    public async Task<ApiChanges> ChangesAsync(string userId, long cursor, int limit, CancellationToken cancellation = default)
    {
        if (limit is < 1 or > MaxPage) throw new ApiBadRequest("invalid_request", $"limit must be 1 to {MaxPage}");
        if (cursor < 0) throw new ApiBadRequest("invalid_cursor", "not a cursor from this API");
        var index = await IndexAsync(cancellation);
        var page = await store.ChangesAsync(userId, cursor, limit, cancellation);
        var tags = (await TagsAsync(userId, cancellation)).Concat(page.Entities.Where(each => each.Collection == "tags"));
        var names = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var tag in tags) if (ApiShapes.Text(tag.Doc, "name") is { } name) names[tag.Id] = name;
        IReadOnlyList<StoredEntity> Of(string collection) => [.. page.Entities.Where(each => each.Collection == collection)];
        return new ApiChanges(
            page.Cursor.ToString(System.Globalization.CultureInfo.InvariantCulture),
            page.More,
            [.. Of("tasks").Select(each => ApiShapes.Task(each.Doc, names))],
            [.. Of("lists").Select(each => ApiShapes.List(each.Doc, index.ListRole(userId, each.Id)))],
            [.. Of("sections").Select(each => ApiShapes.Section(each.Doc))],
            [.. Of("tags").Select(each => ApiShapes.Tag(each.Doc))],
            page.Revoked);
    }
}
