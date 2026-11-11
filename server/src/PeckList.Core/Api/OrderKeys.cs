namespace PeckList.Core.Api;

/// <summary>
/// Fractional order keys as <c>web/src/core/ordering.ts</c> makes them: base-62 digits whose ASCII
/// order is their value, never ending in '0'. The server only ever adds to the end.
/// </summary>
public static class OrderKeys
{
    private const string Digits = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    private const int Base = 62;
    /// <summary>Digits added when a key has no room left at its length (ordering.ts ROOM).</summary>
    private const int Room = 3;

    public static bool IsKey(string? key) =>
        key is { Length: > 0 } && key[^1] != '0' && key.All(c => Digits.Contains(c, StringComparison.Ordinal));

    /// <summary>A key after <paramref name="last"/> (or the first key when there is none): <c>keyBetween(last, null)</c>.</summary>
    public static string After(string? last)
    {
        // keyBetween(null, null) is the midpoint of an empty range: the middle digit.
        if (last is null || !IsKey(last)) return "V";
        var digits = last.Select(c => Digits.IndexOf(c, StringComparison.Ordinal)).ToArray();
        var at = digits.Length - 1;
        while (at >= 0 && digits[at] == Base - 1)
        {
            digits[at] = 0;
            at--;
        }
        if (at < 0) return last + new string('0', Room - 1) + "1";
        digits[at]++;
        if (digits[^1] == 0) digits[^1] = 1;
        return new string([.. digits.Select(d => Digits[d])]);
    }

    /// <summary>The last of these keys in display order (ordinal), or null.</summary>
    public static string? Last(IEnumerable<string?> keys) =>
        keys.Where(IsKey).Max(StringComparer.Ordinal);
}
