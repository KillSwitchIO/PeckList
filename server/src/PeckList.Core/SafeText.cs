using System.Diagnostics.CodeAnalysis;
using System.Text;

namespace PeckList.Core;

/// <summary>
/// Text someone else wrote, made fit to keep: whole characters only, where a plain <c>text[..n]</c>
/// can stop halfway through one.
/// </summary>
public static class SafeText
{
    /// <summary>At most <paramref name="length"/> characters, never ending in half of a surrogate pair.</summary>
    public static string Cut(string text, int length)
    {
        if (text.Length <= length) return text;
        return text[..(char.IsHighSurrogate(text[length - 1]) ? length - 1 : length)];
    }

    /// <summary>The text without NULs and without any surrogate that lost its other half.</summary>
    [return: NotNullIfNotNull(nameof(text))]
    public static string? Clean(string? text)
    {
        if (text is null) return null;
        StringBuilder? clean = null;
        for (var at = 0; at < text.Length; at++)
        {
            var letter = text[at];
            var pair = char.IsHighSurrogate(letter) && at + 1 < text.Length && char.IsLowSurrogate(text[at + 1]);
            if (letter == '\0' || (char.IsSurrogate(letter) && !pair))
            {
                clean ??= new StringBuilder(text, 0, at, text.Length);
                continue;
            }
            clean?.Append(letter);
            if (!pair) continue;
            at++;
            clean?.Append(text[at]);
        }
        return clean?.ToString() ?? text;
    }
}
