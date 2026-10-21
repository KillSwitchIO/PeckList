using System.Text.Json.Nodes;

namespace Punchlist.Core.Tests;

public sealed class WorkspaceSchemaTests
{
    [Fact]
    public void Matches_the_published_json_schema()
    {
        var schema = JsonNode.Parse(File.ReadAllText(RepoFiles.Path("schema", "workspace.schema.json")))!;
        Assert.Equal(WorkspaceSchema.CurrentVersion, (int)schema["properties"]!["schemaVersion"]!["const"]!);
    }
}
