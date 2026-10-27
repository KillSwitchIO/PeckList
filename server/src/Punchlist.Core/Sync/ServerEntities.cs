using System.Text.Json.Nodes;

namespace Punchlist.Core.Sync;

/// <summary>
/// Entities and changes the server writes itself (profiles, friendships, server groups, a reminder
/// snoozed from a notification), shaped as the workspace schema wants them: every field it sets
/// carries a stamp from the <see cref="ServerClock"/>, so devices merge them like any other change.
/// </summary>
public static class ServerEntities
{
    /// <summary>A whole new entity: the common fields, then <paramref name="fields"/>, every one stamped <paramref name="stamp"/>.</summary>
    public static JsonObject New(string id, string createdBy, string origin, string createdAt, string stamp, JsonObject fields)
    {
        var entity = new JsonObject
        {
            ["id"] = id,
            ["createdAt"] = createdAt,
            ["createdBy"] = createdBy,
            ["deletedAt"] = null,
            ["origin"] = origin,
        };
        foreach (var (field, value) in fields) entity[field] = value?.DeepClone();
        var clocks = new JsonObject();
        foreach (var (field, _) in entity) if (field != "id") clocks[field] = stamp;
        entity["_hlc"] = clocks;
        return entity;
    }

    /// <summary>Only the fields that change, each stamped: merged into the stored copy by the sync.</summary>
    public static JsonObject Change(string id, string stamp, JsonObject fields)
    {
        var change = new JsonObject { ["id"] = id };
        var clocks = new JsonObject();
        foreach (var (field, value) in fields)
        {
            change[field] = value?.DeepClone();
            clocks[field] = stamp;
        }
        change["_hlc"] = clocks;
        return change;
    }

    /// <summary>The whole entity as it is with <paramref name="fields"/> changed on it (the stamped fields win).</summary>
    public static JsonObject Changed(JsonObject doc, string stamp, JsonObject fields) =>
        Merge.Entity((JsonObject)doc.DeepClone(), Change((string)doc["id"]!, stamp, fields), []);

    /// <summary>The entity deleted now, as devices delete: a tombstone every device hears of.</summary>
    public static JsonObject Tombstone(string id, ServerClock clock) =>
        Change(id, clock.Next(), new JsonObject { ["deletedAt"] = clock.Now() });
}
