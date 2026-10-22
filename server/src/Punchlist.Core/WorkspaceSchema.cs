namespace Punchlist.Core;

/// <summary>The workspace JSON format this build reads and writes (schema/workspace.schema.json).</summary>
public static class WorkspaceSchema
{
    /// <summary>Must match <c>CURRENT_SCHEMA_VERSION</c> in web/src/core/migrations.ts.</summary>
    public const int CurrentVersion = 5;

    /// <summary>The entity collections, as in <c>COLLECTIONS</c> (web/src/core/types.ts).</summary>
    public static readonly IReadOnlyList<string> Collections =
    [
        "users", "folders", "lists", "sections", "tags", "tasks",
        "groups", "groupMembers", "listMembers", "friendships", "savedFilters", "settings",
    ];

    /// <summary>Fields that merge per element instead of as one value (<c>ELEMENT_SET_FIELDS</c>).</summary>
    public static IReadOnlyCollection<string> ElementSetFields(string collection) =>
        collection == "tasks" ? TaskSets : [];

    private static readonly string[] TaskSets = ["tags", "assignees", "blockedBy"];
}
