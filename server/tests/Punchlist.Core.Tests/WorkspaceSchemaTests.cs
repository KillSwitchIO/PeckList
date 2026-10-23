using System.Text.Json.Nodes;

namespace Punchlist.Core.Tests;

public sealed class WorkspaceSchemaTests
{
    [Fact]
    public void Matches_the_published_json_schema()
    {
        var schema = JsonNode.Parse(File.ReadAllText(RepoFiles.Path("schema", "workspace.schema.json")))!;
        Assert.Equal(WorkspaceSchema.CurrentVersion, (int)schema["properties"]!["schemaVersion"]!["const"]!);
        // The server keeps the same collections the schema lists.
        var collections = schema["properties"]!["entities"]!["required"]!.AsArray().Select(each => (string)each!).Order();
        Assert.Equal(collections, WorkspaceSchema.Collections.Order());
    }

    [Fact]
    public void The_full_fixture_is_this_version_with_every_collection()
    {
        var full = JsonNode.Parse(File.ReadAllText(RepoFiles.Path("schema", "fixtures", "workspace", "full.json")))!;
        Assert.Equal(WorkspaceSchema.CurrentVersion, (int)full["schemaVersion"]!);
        foreach (var collection in WorkspaceSchema.Collections) Assert.NotEmpty(full["entities"]![collection]!.AsArray());
    }
}
