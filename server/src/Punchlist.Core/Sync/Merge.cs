using System.Text.Json.Nodes;

namespace Punchlist.Core.Sync;

/// <summary>
/// Conflict-free merge: per-field last-writer-wins by HLC, element sets merged per element. Must
/// give exactly what web/src/core/merge.ts gives; both run schema/fixtures/merge.
/// </summary>
public static class Merge
{
    private static readonly HashSet<string> Reserved = ["id", "_hlc"];

    public static JsonObject ElementSets(JsonObject? a, JsonObject? b)
    {
        var result = new JsonObject();
        var keys = new SortedSet<string>(StringComparer.Ordinal);
        foreach (var (key, _) in a ?? []) keys.Add(key);
        foreach (var (key, _) in b ?? []) keys.Add(key);
        foreach (var key in keys)
        {
            var left = a?[key] as JsonObject;
            var right = b?[key] as JsonObject;
            if (left is null || right is null)
            {
                var only = left ?? right;
                if (only is not null) result[key] = only.DeepClone();
                continue;
            }
            var order = Hlc.Compare((string?)left["hlc"], (string?)right["hlc"]);
            if (order > 0) result[key] = left.DeepClone();
            else if (order < 0) result[key] = right.DeepClone();
            // Same HLC: removal wins so the outcome does not depend on argument order.
            else result[key] = new JsonObject
            {
                ["in"] = (bool?)left["in"] == true && (bool?)right["in"] == true,
                ["hlc"] = (string?)left["hlc"],
            };
        }
        return result;
    }

    /// <summary>Merge two copies of one entity. <paramref name="setFields"/> merge per element.</summary>
    public static JsonObject Entity(JsonObject a, JsonObject b, IReadOnlyCollection<string> setFields)
    {
        var id = (string?)a["id"];
        if (id != (string?)b["id"])
        {
            throw new ArgumentException($"cannot merge different entities: {id} and {(string?)b["id"]}");
        }
        var leftClocks = a["_hlc"] as JsonObject;
        var rightClocks = b["_hlc"] as JsonObject;
        var result = new JsonObject { ["id"] = id };
        var clocks = new JsonObject();

        var fields = new SortedSet<string>(StringComparer.Ordinal);
        foreach (var (key, _) in a) fields.Add(key);
        foreach (var (key, _) in b) fields.Add(key);
        foreach (var field in fields)
        {
            if (Reserved.Contains(field)) continue;
            var leftClock = (string?)leftClocks?[field];
            var rightClock = (string?)rightClocks?[field];
            var order = Hlc.Compare(leftClock, rightClock);
            var inLeft = a.ContainsKey(field);
            var inRight = b.ContainsKey(field);
            if (setFields.Contains(field))
            {
                result[field] = ElementSets(a[field] as JsonObject, b[field] as JsonObject);
            }
            else if (order > 0 || (order == 0 && !inRight))
            {
                result[field] = a[field]?.DeepClone();
            }
            else if (order < 0 || !inLeft)
            {
                result[field] = b[field]?.DeepClone();
            }
            else
            {
                result[field] = TieBreak(a[field], b[field])?.DeepClone();
            }
            // For a set the field clock only records when the set was created; elements carry their own.
            var clock = order >= 0 ? leftClock : rightClock;
            if (clock is not null) clocks[field] = clock;
        }
        result["_hlc"] = clocks;
        return result;
    }

    /// <summary>Same HLC, different values: the larger canonical JSON wins.</summary>
    private static JsonNode? TieBreak(JsonNode? a, JsonNode? b) =>
        string.CompareOrdinal(CanonicalJson.Write(a), CanonicalJson.Write(b)) >= 0 ? a : b;

    /// <summary>Union by id, merging entities present on both sides; sorted by id.</summary>
    public static List<JsonObject> Collection(IEnumerable<JsonObject> a, IEnumerable<JsonObject> b, IReadOnlyCollection<string> setFields)
    {
        var byId = new Dictionary<string, JsonObject>(StringComparer.Ordinal);
        foreach (var entity in a) byId[(string)entity["id"]!] = entity;
        foreach (var entity in b)
        {
            var id = (string)entity["id"]!;
            byId[id] = byId.TryGetValue(id, out var existing) ? Entity(existing, entity, setFields) : entity;
        }
        return byId.OrderBy(pair => pair.Key, StringComparer.Ordinal).Select(pair => pair.Value).ToList();
    }
}
