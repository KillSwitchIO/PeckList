using System.Text.Json.Nodes;
using PeckList.Core.Sync;

namespace PeckList.Server;

/// <summary>The workspace schema built into the server (<c>schema/workspace.schema.json</c>).</summary>
public static class EntitySchema
{
    public static JsonNode Load()
    {
        using var stream = typeof(EntitySchema).Assembly.GetManifestResourceStream("workspace.schema.json")
            ?? throw new InvalidOperationException("workspace.schema.json is not embedded");
        return JsonNode.Parse(stream)!;
    }

    public static IEntityValidator Validator() => new WorkspaceEntityValidator(Load());
}
