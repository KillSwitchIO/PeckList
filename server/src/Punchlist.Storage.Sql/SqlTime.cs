using System.Globalization;

namespace Punchlist.Storage.Sql;

/// <summary>Times kept in text columns: ISO 8601 round-trip, the same on every database.</summary>
internal static class SqlTime
{
    public static string Text(DateTimeOffset value) => value.ToString("O", CultureInfo.InvariantCulture);

    public static string? Text(DateTimeOffset? value) => value?.ToString("O", CultureInfo.InvariantCulture);

    public static DateTimeOffset Parse(string value) => DateTimeOffset.Parse(value, CultureInfo.InvariantCulture);

    public static DateTimeOffset? ParseOrNull(string? value) => value is null ? null : Parse(value);
}
