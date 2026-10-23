namespace Punchlist.Core;

/// <summary>The workspace JSON format this build reads and writes (schema/workspace.schema.json).</summary>
public static class WorkspaceSchema
{
    /// <summary>Must match <c>CURRENT_SCHEMA_VERSION</c> in web/src/core/migrations.ts.</summary>
    public const int CurrentVersion = 7;

    /// <summary>
    /// Older versions whose data this build reads as it is: their migrations only added optional
    /// fields or empty collections (5 to 6: friendships' <c>madeBy</c>; 6 to 7: comments). Backups
    /// from them restore without a migration.
    /// </summary>
    public static bool Readable(int? version) => version is 5 or 6 or CurrentVersion;

    /// <summary>The entity collections, as in <c>COLLECTIONS</c> (web/src/core/types.ts).</summary>
    public static readonly IReadOnlyList<string> Collections =
    [
        "users", "folders", "lists", "sections", "tags", "tasks",
        "groups", "groupMembers", "listMembers", "friendships", "savedFilters", "settings", "comments",
    ];

    /// <summary>Fields that merge per element instead of as one value (<c>ELEMENT_SET_FIELDS</c>).</summary>
    public static IReadOnlyCollection<string> ElementSetFields(string collection) =>
        collection == "tasks" ? TaskSets : [];

    private static readonly string[] TaskSets = ["tags", "assignees", "blockedBy"];
}
