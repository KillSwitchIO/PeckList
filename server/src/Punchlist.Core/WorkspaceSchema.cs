namespace Punchlist.Core;

/// <summary>The workspace JSON format this build reads and writes (schema/workspace.schema.json).</summary>
public static class WorkspaceSchema
{
    /// <summary>Must match <c>CURRENT_SCHEMA_VERSION</c> in web/src/core/migrations.ts.</summary>
    public const int CurrentVersion = 14;

    /// <summary>
    /// Older versions whose data this build reads as it is: their migrations only added optional
    /// fields or empty collections (5 to 6: friendships' <c>madeBy</c>; 6 to 7: comments; 7 to 8:
    /// attachments; 8 to 9: settings' <c>bottomBar</c> and lists' <c>ownerId</c>; 9 to 10: settings'
    /// <c>newTask</c>; 10 to 11: settings' <c>palettePreset</c>;
    /// 11 to 12: tasks' <c>reminders</c>; 12 to 13: settings' <c>dateFormat</c>; 13 to 14: users' <c>photo</c>). Backups
    /// from them restore without a migration.
    /// </summary>
    public static bool Readable(int? version) => version is >= 5 and <= CurrentVersion;

    /// <summary>The entity collections, as in <c>COLLECTIONS</c> (web/src/core/types.ts).</summary>
    public static readonly IReadOnlyList<string> Collections =
    [
        "users", "folders", "lists", "sections", "tags", "tasks",
        "groups", "groupMembers", "listMembers", "friendships", "savedFilters", "settings", "comments", "attachments",
    ];

    /// <summary>Fields that merge per element instead of as one value (<c>ELEMENT_SET_FIELDS</c>).</summary>
    public static IReadOnlyCollection<string> ElementSetFields(string collection) =>
        collection == "tasks" ? TaskSets : [];

    private static readonly string[] TaskSets = ["tags", "assignees", "blockedBy"];
}
