using System.Collections;
using System.Globalization;
using System.Text;

namespace Punchlist.Server.Logging;

/// <summary>
/// Renders a message template (<c>"{Admin} took a backup: {Name}"</c>) from its values the way
/// Microsoft.Extensions.Logging does (invariant culture), holes filled by name, with secret
/// values masked first.
/// </summary>
public static class LogTemplate
{
    /// <summary>
    /// Render with each hole taking the next unused value of its name; null when a hole has no
    /// value (the state was not made from this template).
    /// </summary>
    public static string? Fill(string template, IReadOnlyList<KeyValuePair<string, object?>> named)
    {
        var used = new bool[named.Count];
        var values = new List<object?>();
        foreach (var name in Names(template))
        {
            var index = -1;
            for (var i = 0; i < named.Count; i++)
            {
                if (!used[i] && named[i].Key == name)
                {
                    index = i;
                    break;
                }
            }
            if (index < 0) return null;
            used[index] = true;
            values.Add(named[index].Value);
        }
        return Render(template, values);
    }

    public static string Render(string template, IReadOnlyList<object?> values)
    {
        var output = new StringBuilder(template.Length + 32);
        var next = 0;
        for (var i = 0; i < template.Length; i++)
        {
            var c = template[i];
            if (c == '{' && i + 1 < template.Length && template[i + 1] == '{')
            {
                output.Append('{');
                i++;
                continue;
            }
            if (c == '}' && i + 1 < template.Length && template[i + 1] == '}')
            {
                output.Append('}');
                i++;
                continue;
            }
            if (c != '{')
            {
                output.Append(c);
                continue;
            }
            var end = template.IndexOf('}', i + 1);
            if (end < 0)
            {
                output.Append(template, i, template.Length - i);
                break;
            }
            var hole = template.AsSpan(i + 1, end - i - 1);
            var colon = hole.IndexOf(':');
            var format = colon >= 0 ? hole[(colon + 1)..].ToString() : null;
            var nameAndAlignment = colon >= 0 ? hole[..colon] : hole;
            var comma = nameAndAlignment.IndexOf(',');
            var text = next < values.Count ? Format(values[next], format) : "";
            if (comma >= 0 && int.TryParse(nameAndAlignment[(comma + 1)..], NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out var width))
            {
                text = width < 0 ? text.PadRight(-width) : text.PadLeft(width);
            }
            output.Append(text);
            next++;
            i = end;
        }
        return output.ToString();
    }

    /// <summary>The hole names of a template, in order.</summary>
    public static IReadOnlyList<string> Names(string template)
    {
        var names = new List<string>();
        for (var i = 0; i < template.Length; i++)
        {
            if (template[i] != '{') continue;
            if (i + 1 < template.Length && template[i + 1] == '{')
            {
                i++;
                continue;
            }
            var end = template.IndexOf('}', i + 1);
            if (end < 0) break;
            var hole = template[(i + 1)..end];
            var cut = hole.IndexOfAny([',', ':']);
            names.Add(cut >= 0 ? hole[..cut] : hole);
            i = end;
        }
        return names;
    }

    public static string Format(object? value, string? format) => value switch
    {
        null => "(null)",
        string text => text,
        IFormattable formattable => formattable.ToString(format, CultureInfo.InvariantCulture),
        IEnumerable items => string.Join(", ", items.Cast<object?>().Select(item => Format(item, format))),
        _ => value.ToString() ?? "",
    };
}
