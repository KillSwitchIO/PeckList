using System.Globalization;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace PeckList.Core.Backup;

/// <summary>
/// Moves a seed's dates on (<c>pecklist import --shift-dates</c>, PL-117): a demo seed made once,
/// with its tasks laid out around the day it was made, reads as if made today. Every calendar date
/// and time in an entity moves by whole days; the clock stamps (<c>_hlc</c>) stay, as they order
/// changes and are never shown.
/// </summary>
public static partial class SeedDates
{
    /// <summary>Whole days from the backup's <c>exportedAt</c> to <paramref name="today"/> (both UTC).</summary>
    public static int DaysSince(JsonObject root, DateOnly today)
    {
        var exported = (string?)root["exportedAt"];
        if (!DateTimeOffset.TryParse(exported, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var at))
        {
            throw new BackupException("--shift-dates needs the backup's exportedAt");
        }
        return today.DayNumber - DateOnly.FromDateTime(at.UtcDateTime).DayNumber;
    }

    /// <summary><paramref name="node"/> with every <c>YYYY-MM-DD</c> (alone or starting a time) moved by <paramref name="days"/>.</summary>
    public static void Shift(JsonNode? node, int days)
    {
        if (days == 0) return;
        switch (node)
        {
            case JsonObject item:
                foreach (var (key, value) in item.ToList())
                {
                    if (key == "_hlc") continue;
                    if (value is JsonValue text && Moved(text, days) is { } moved) item[key] = moved;
                    else Shift(value, days);
                }
                break;
            case JsonArray items:
                for (var i = 0; i < items.Count; i++)
                {
                    if (items[i] is JsonValue text && Moved(text, days) is { } moved) items[i] = moved;
                    else Shift(items[i], days);
                }
                break;
        }
    }

    private static string? Moved(JsonValue value, int days)
    {
        if (!value.TryGetValue<string>(out var text)) return null;
        var match = DateStart().Match(text);
        if (!match.Success
            || !DateOnly.TryParseExact(match.Groups[1].Value, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var date))
        {
            return null;
        }
        return date.AddDays(days).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) + text[10..];
    }

    // A date alone, or a date and time (2026-10-30T14:30, 2026-10-30T00:00:00.000Z).
    [GeneratedRegex(@"^(\d{4}-\d{2}-\d{2})(T\d{2}:\d{2}[0-9:.]*(Z|[+-]\d{2}:\d{2})?)?$")]
    private static partial Regex DateStart();
}
