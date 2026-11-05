using System.Text.Json.Nodes;
using PeckList.Core.Sync;

namespace PeckList.Core.Tests;

/// <summary>Pushed entities against the workspace schema and a size cap (audit S4).</summary>
public sealed class EntityChecksTests
{
    private static readonly JsonNode Schema = JsonNode.Parse(File.ReadAllText(RepoFiles.Path("schema", "workspace.schema.json")))!;
    private static readonly WorkspaceEntityValidator Validator = new(Schema);

    private static JsonObject Full() => (JsonObject)JsonNode.Parse(File.ReadAllText(RepoFiles.Path("schema", "fixtures", "workspace", "full.json")))!;

    private static JsonObject Task()
    {
        var task = Full()["entities"]!["tasks"]![0]!.DeepClone().AsObject();
        Assert.Null(Validator.Problem("tasks", task));
        return task;
    }

    [Fact]
    public void Handles_every_keyword_the_workspace_schema_uses_and_refuses_one_it_does_not()
    {
        // Loading the real schema checks every keyword and reference in it.
        _ = new JsonSchemaSubset(Schema);
        var unknown = JsonNode.Parse("""{ "$defs": { "thing": { "type": "object", "dependentRequired": { "a": ["b"] } } } }""")!;
        Assert.Contains("dependentRequired", Assert.Throws<NotSupportedException>(() => new JsonSchemaSubset(unknown)).Message);
        var remote = JsonNode.Parse("""{ "$defs": { "thing": { "$ref": "https://example.com/other.json" } } }""")!;
        Assert.Throws<NotSupportedException>(() => new JsonSchemaSubset(remote));
    }

    [Fact]
    public void Every_entity_in_the_full_fixture_is_kept()
    {
        var entities = Full()["entities"]!.AsObject();
        Assert.Equal(WorkspaceEntityValidator.Definitions.Keys.Order(), WorkspaceSchema.Collections.Order());
        foreach (var (collection, items) in entities)
        {
            foreach (var entity in items!.AsArray()) Assert.Null(Validator.Problem(collection, entity!.AsObject()));
        }
    }

    [Theory]
    [InlineData("title", "42", "/title must be string")]
    [InlineData("status", "\"maybe\"", "/status must be one of the allowed values")]
    [InlineData("priority", "7", "/priority must be one of the allowed values")]
    [InlineData("progress", "45", "/progress must be a multiple of 10")]
    [InlineData("progress", "120", "/progress must be at most 100")]
    [InlineData("progress", "5.5", "/progress must be integer")]
    [InlineData("listId", "\"not an id\"", "/listId must match")]
    [InlineData("parentId", "17", "/parentId matches none of the allowed shapes")]
    [InlineData("assignees", """{ "mallory": { "in": true, "hlc": "2026-10-20T16:15:00.018Z-0000-dev1" } }""", "/assignees/mallory must match")]
    [InlineData("hostname", "\"tasks.example.com\"", "/hostname is not allowed here")]
    public void A_task_of_the_wrong_shape_is_refused_with_what_is_wrong(string field, string json, string problem)
    {
        var task = Task();
        task[field] = JsonNode.Parse(json);
        Assert.StartsWith(problem, Validator.Problem("tasks", task));
    }

    [Fact]
    public void A_missing_field_or_a_bad_nested_value_is_refused()
    {
        var task = Task();
        task.Remove("notes");
        Assert.StartsWith("/ must have notes", Validator.Problem("tasks", task));

        var reminded = Task();
        reminded["reminders"] = new JsonArray(Enumerable.Range(0, 11).Select(_ => (JsonNode?)JsonValue.Create("x")).ToArray());
        Assert.Contains("/reminders must have at most 10 items", Validator.Problem("tasks", reminded));
    }

    [Fact]
    public void Lengths_count_characters_not_utf16_units()
    {
        // A schema's maxLength counts code points: an emoji is one, as ajv counts it.
        var schema = JsonNode.Parse("""{ "$defs": { "short": { "type": "string", "maxLength": 2 } } }""")!;
        var subset = new JsonSchemaSubset(schema);
        Assert.Null(subset.Problem(JsonValue.Create("🦆🦆"), "short"));
        Assert.NotNull(subset.Problem(JsonValue.Create("🦆🦆🦆"), "short"));
    }

    [Fact]
    public void Properties_another_part_of_the_schema_looked_at_are_not_unevaluated()
    {
        // The task's own properties and those base adds through allOf are both fine; a stranger is not.
        var schema = JsonNode.Parse("""
            {
              "$defs": {
                "base": { "type": "object", "properties": { "id": { "type": "string" } } },
                "thing": {
                  "allOf": [{ "$ref": "#/$defs/base" }],
                  "properties": { "name": { "type": "string" } },
                  "oneOf": [{ "properties": { "kind": { "const": "a" } } }, { "properties": { "size": { "type": "integer" } }, "required": ["size"] }],
                  "unevaluatedProperties": false
                }
              }
            }
            """)!;
        var subset = new JsonSchemaSubset(schema);
        Assert.Null(subset.Problem(JsonNode.Parse("""{ "id": "1", "name": "n", "kind": "a" }"""), "thing"));
        Assert.Equal("/other is not allowed here", subset.Problem(JsonNode.Parse("""{ "id": "1", "name": "n", "kind": "a", "other": 1 }"""), "thing"));
    }

    [Fact]
    public void One_huge_entity_is_refused()
    {
        var task = Task();
        task["notes"] = new string('x', WorkspaceEntityValidator.MaxEntityBytes);
        Assert.StartsWith("too large", Validator.Problem("tasks", task));
    }
}
