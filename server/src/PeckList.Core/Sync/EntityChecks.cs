using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace PeckList.Core.Sync;

/// <summary>Whether a pushed entity is one the server keeps (audit S4): its shape and its size.</summary>
public interface IEntityValidator
{
    /// <summary>Why <paramref name="entity"/> of <paramref name="collection"/> is not kept, or null when it is.</summary>
    string? Problem(string collection, JsonObject entity);
}

/// <summary>
/// The workspace schema's own definition for each collection (<c>schema/workspace.schema.json</c>,
/// the file the apps check with too), and a size cap (audit S4): a hostile or broken client cannot
/// store junk that every viewer then syncs, nor one huge record.
/// </summary>
public sealed class WorkspaceEntityValidator(JsonNode schema) : IEntityValidator
{
    /// <summary>The most one entity's JSON may take. Real ones are a few KB; a photo is at most 80 KB.</summary>
    public const int MaxEntityBytes = 256 * 1024;

    /// <summary>Each collection's definition under <c>$defs</c>.</summary>
    public static readonly IReadOnlyDictionary<string, string> Definitions = new Dictionary<string, string>(StringComparer.Ordinal)
    {
        ["users"] = "user", ["folders"] = "folder", ["lists"] = "list", ["sections"] = "section", ["tags"] = "tag",
        ["tasks"] = "task", ["groups"] = "group", ["groupMembers"] = "groupMember", ["listMembers"] = "listMember",
        ["friendships"] = "friendship", ["savedFilters"] = "savedFilter", ["settings"] = "settings",
        ["comments"] = "comment", ["attachments"] = "attachment",
    };

    private readonly JsonSchemaSubset validator = new(schema);

    public string? Problem(string collection, JsonObject entity)
    {
        var bytes = Encoding.UTF8.GetByteCount(entity.ToJsonString());
        if (bytes > MaxEntityBytes) return $"too large ({bytes / 1024} KB; at most {MaxEntityBytes / 1024} KB)";
        if (!Definitions.TryGetValue(collection, out var definition)) return $"unknown collection '{collection}'";
        return validator.Problem(entity, definition);
    }
}

/// <summary>
/// JSON Schema 2020-12, the keywords the workspace schema uses and no more, with local
/// <c>#/$defs/...</c> references. A keyword it does not know is refused when the schema is loaded,
/// so the schema cannot start using one that would be skipped silently. Matches ajv on what it
/// covers: string lengths in code points, ECMAScript patterns, <c>unevaluatedProperties</c> after
/// <c>allOf</c>, <c>oneOf</c> and <c>$ref</c>.
/// </summary>
public sealed class JsonSchemaSubset
{
    public static readonly IReadOnlySet<string> Keywords = new HashSet<string>(StringComparer.Ordinal)
    {
        "type", "$ref", "properties", "required", "items", "additionalProperties", "unevaluatedProperties", "allOf", "oneOf",
        "enum", "const", "pattern", "minLength", "maxLength", "minimum", "maximum", "multipleOf", "maxItems", "propertyNames",
        // Annotations: nothing to check.
        "description", "title", "$schema", "$id", "$defs",
    };

    private readonly JsonNode root;
    private readonly Dictionary<string, Regex> patterns = new(StringComparer.Ordinal);

    /// <exception cref="NotSupportedException">The schema uses a keyword or reference this does not handle.</exception>
    public JsonSchemaSubset(JsonNode root)
    {
        this.root = root;
        Inspect(root);
    }

    /// <summary>The first problem with <paramref name="instance"/> against <c>$defs/<paramref name="definition"/></c>, or null.</summary>
    public string? Problem(JsonNode? instance, string definition)
    {
        var schema = root["$defs"]?[definition] as JsonObject ?? throw new ArgumentException($"no $defs/{definition}", nameof(definition));
        var errors = new List<string>();
        return Validate(schema, instance, "", errors, out _) ? null : errors.FirstOrDefault() ?? "does not match the schema";
    }

    /// <summary>Every keyword in a schema and its subschemas is one this handles.</summary>
    private void Inspect(JsonNode? node)
    {
        if (node is JsonArray array)
        {
            foreach (var item in array) Inspect(item);
            return;
        }
        if (node is not JsonObject schema) return;
        foreach (var (key, value) in schema)
        {
            if (!Keywords.Contains(key)) throw new NotSupportedException($"JSON Schema keyword '{key}' is not handled");
            if (key == "$ref" && (value is not JsonValue reference || !reference.ToString().StartsWith("#/$defs/", StringComparison.Ordinal)))
            {
                throw new NotSupportedException($"only #/$defs/ references are handled, not {value}");
            }
            if (key == "pattern") Pattern(value!.GetValue<string>());
            // Under these, the keys are names (of properties, of definitions), and the values schemas.
            if (key is "properties" or "$defs")
            {
                foreach (var (_, child) in (JsonObject)value!) Inspect(child);
                continue;
            }
            // Values, not schemas.
            if (key is "enum" or "const" or "required" or "type" or "description" or "title" or "$schema" or "$id") continue;
            Inspect(value);
        }
    }

    private Regex Pattern(string pattern)
    {
        lock (patterns)
        {
            if (!patterns.TryGetValue(pattern, out var regex))
            {
                regex = new Regex(pattern, RegexOptions.ECMAScript, TimeSpan.FromMilliseconds(250));
                patterns[pattern] = regex;
            }
            return regex;
        }
    }

    private JsonObject Resolve(string reference)
    {
        var name = reference["#/$defs/".Length..];
        return root["$defs"]?[name] as JsonObject ?? throw new NotSupportedException($"no definition for {reference}");
    }

    /// <param name="evaluated">The instance's property names this schema (and its passing subschemas) looked at.</param>
    private bool Validate(JsonObject schema, JsonNode? instance, string path, List<string> errors, out HashSet<string> evaluated)
    {
        evaluated = new HashSet<string>(StringComparer.Ordinal);
        var ok = true;
        void Fail(string message)
        {
            ok = false;
            errors.Add($"{(path.Length == 0 ? "/" : path)} {message}");
        }
        var kind = Kind(instance);

        if (schema["type"] is { } type)
        {
            var allowed = type is JsonArray many ? many.Select(each => (string)each!).ToList() : [(string)type!];
            if (!allowed.Any(each => Is(each, instance, kind))) Fail($"must be {string.Join(" or ", allowed)}");
        }
        if (schema["const"] is { } constant && !JsonNode.DeepEquals(constant, instance)) Fail($"must be {constant.ToJsonString()}");
        if (schema["enum"] is JsonArray choices && !choices.Any(each => JsonNode.DeepEquals(each, instance))) Fail("must be one of the allowed values");

        if (kind == JsonValueKind.String)
        {
            var text = instance!.GetValue<string>();
            var length = CodePoints(text);
            if (schema["minLength"] is { } min && length < (int)min) Fail($"must be at least {min} characters");
            if (schema["maxLength"] is { } max && length > (int)max) Fail($"must be at most {max} characters");
            if (schema["pattern"] is { } pattern && !Pattern((string)pattern!).IsMatch(text)) Fail($"must match {pattern}");
        }
        if (kind == JsonValueKind.Number)
        {
            var number = instance!.GetValue<decimal>();
            if (schema["minimum"] is { } minimum && number < minimum.GetValue<decimal>()) Fail($"must be at least {minimum}");
            if (schema["maximum"] is { } maximum && number > maximum.GetValue<decimal>()) Fail($"must be at most {maximum}");
            if (schema["multipleOf"] is { } step && number % step.GetValue<decimal>() != 0) Fail($"must be a multiple of {step}");
        }
        if (instance is JsonArray array)
        {
            if (schema["maxItems"] is { } maxItems && array.Count > (int)maxItems) Fail($"must have at most {maxItems} items");
            if (schema["items"] is JsonObject itemSchema)
            {
                for (var i = 0; i < array.Count; i++)
                {
                    if (!Validate(itemSchema, array[i], $"{path}/{i}", errors, out _)) ok = false;
                }
            }
        }

        if (schema["$ref"] is { } reference)
        {
            if (Validate(Resolve((string)reference!), instance, path, errors, out var byReference)) evaluated.UnionWith(byReference);
            else ok = false;
        }
        if (schema["allOf"] is JsonArray all)
        {
            foreach (var each in all)
            {
                if (Validate((JsonObject)each!, instance, path, errors, out var byEach)) evaluated.UnionWith(byEach);
                else ok = false;
            }
        }
        if (schema["oneOf"] is JsonArray one)
        {
            var passed = 0;
            HashSet<string>? byPassing = null;
            var branchErrors = new List<string>();
            foreach (var each in one)
            {
                if (Validate((JsonObject)each!, instance, path, branchErrors, out var byEach))
                {
                    passed++;
                    byPassing = byEach;
                }
            }
            if (passed == 1) evaluated.UnionWith(byPassing!);
            else Fail(passed == 0 ? $"matches none of the allowed shapes ({branchErrors.FirstOrDefault()})" : "matches more than one allowed shape");
        }

        if (instance is JsonObject obj)
        {
            if (schema["required"] is JsonArray required)
            {
                foreach (var name in required.Select(each => (string)each!).Where(name => !obj.ContainsKey(name))) Fail($"must have {name}");
            }
            var properties = schema["properties"] as JsonObject;
            if (properties is not null)
            {
                foreach (var (name, value) in obj)
                {
                    if (properties[name] is not JsonObject propertySchema) continue;
                    evaluated.Add(name);
                    if (!Validate(propertySchema, value, $"{path}/{name}", errors, out _)) ok = false;
                }
            }
            if (schema["additionalProperties"] is { } additional)
            {
                foreach (var (name, value) in obj)
                {
                    if (properties?.ContainsKey(name) == true) continue;
                    evaluated.Add(name);
                    if (!Allowed(additional, value, $"{path}/{name}")) ok = false;
                }
            }
            if (schema["propertyNames"] is JsonObject names)
            {
                foreach (var (name, _) in obj)
                {
                    if (!Validate(names, JsonValue.Create(name), $"{path}/{name}", errors, out _)) ok = false;
                }
            }
            // Last: what nothing above looked at.
            if (schema["unevaluatedProperties"] is { } unevaluated)
            {
                foreach (var (name, value) in obj)
                {
                    if (evaluated.Contains(name)) continue;
                    if (!Allowed(unevaluated, value, $"{path}/{name}")) ok = false;
                }
                foreach (var (name, _) in obj) evaluated.Add(name);
            }
        }
        return ok;

        bool Allowed(JsonNode rule, JsonNode? value, string at)
        {
            if (rule is JsonValue flag && flag.GetValueKind() is JsonValueKind.False)
            {
                errors.Add($"{at} is not allowed here");
                return false;
            }
            return rule is not JsonObject ruleSchema || Validate(ruleSchema, value, at, errors, out _);
        }
    }

    private static JsonValueKind Kind(JsonNode? node) => node is null ? JsonValueKind.Null : node.GetValueKind();

    private static bool Is(string type, JsonNode? instance, JsonValueKind kind) => type switch
    {
        "null" => kind == JsonValueKind.Null,
        "boolean" => kind is JsonValueKind.True or JsonValueKind.False,
        "string" => kind == JsonValueKind.String,
        "number" => kind == JsonValueKind.Number,
        "integer" => kind == JsonValueKind.Number && instance!.GetValue<decimal>() % 1 == 0,
        "array" => kind == JsonValueKind.Array,
        "object" => kind == JsonValueKind.Object,
        _ => throw new NotSupportedException($"JSON Schema type '{type}' is not handled"),
    };

    /// <summary>Length as JSON Schema counts it: in code points, a surrogate pair being one.</summary>
    private static int CodePoints(string text) => text.Length - text.Count(char.IsLowSurrogate);
}
