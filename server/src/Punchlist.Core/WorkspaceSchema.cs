namespace Punchlist.Core;

/// <summary>The workspace JSON format this build reads and writes (schema/workspace.schema.json).</summary>
public static class WorkspaceSchema
{
    /// <summary>Must match <c>CURRENT_SCHEMA_VERSION</c> in web/src/core/migrations.ts.</summary>
    public const int CurrentVersion = 4;
}
