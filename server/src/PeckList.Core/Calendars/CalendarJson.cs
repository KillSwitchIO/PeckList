using System.Text.Json;

namespace PeckList.Core.Calendars;

/// <summary>How events and snapshots are kept in <see cref="CalendarItem"/>'s text columns.</summary>
public static class CalendarJson
{
    private static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web);

    /// <summary>An event as stored.</summary>
    public static string Write(RemoteEvent remote) => JsonSerializer.Serialize(remote, Options);

    /// <summary>Event data as stored.</summary>
    public static string Write(EventData data) => JsonSerializer.Serialize(data, Options);

    /// <summary>The event back.</summary>
    public static RemoteEvent ReadEvent(string json) =>
        JsonSerializer.Deserialize<RemoteEvent>(json, Options) ?? throw new JsonException("not an event");

    /// <summary>The event data back.</summary>
    public static EventData ReadData(string json) =>
        JsonSerializer.Deserialize<EventData>(json, Options) ?? throw new JsonException("not event data");

    /// <summary>Whether two events agree on every mapped part (records holding lists do not compare by value).</summary>
    public static bool Same(EventData a, EventData b) =>
        a.Summary == b.Summary && a.Description == b.Description && SameWhen(a, b) && a.Marker == b.Marker;

    /// <summary>Whether two events fall at the same times and repeat the same way.</summary>
    public static bool SameWhen(EventData a, EventData b) =>
        a.Start == b.Start && a.End == b.End && a.RRule == b.RRule && (a.ExDates ?? []).SequenceEqual(b.ExDates ?? []);
}
