using System.Text;

namespace PeckList.CalDav.ICalendar;

/// <summary>An iCalendar object the reader can't make sense of.</summary>
public sealed class CalendarFormatException(string message) : Exception(message);

/// <summary>
/// iCalendar text (RFC 5545 3.1): unfolding and parsing content lines into components, printing
/// them back with folding, and TEXT value escaping.
/// </summary>
public static class CalText
{
    /// <summary>
    /// The most text one calendar object may hold: as much as servers take for one resource
    /// (Radicale's default is 10 MB), since an event too big to read would look deleted in a full
    /// listing. The client's answer cap keeps a hostile server from going past it by much.
    /// </summary>
    public const int MaxLength = 12_000_000;

    private const int MaxDepth = 8;
    private const int MaxProperties = 200_000;

    /// <summary>Parses one calendar object; the root is the VCALENDAR.</summary>
    /// <exception cref="CalendarFormatException">The text is not an iCalendar object.</exception>
    public static CalComponent Parse(string text)
    {
        if (text.Length > MaxLength) throw new CalendarFormatException("calendar object too large");
        var stack = new Stack<CalComponent>();
        CalComponent? root = null;
        var count = 0;
        foreach (var line in Unfold(text))
        {
            var property = ParseLine(line);
            // Every line and every parameter value counts, so memory stays in step with the cap.
            count += 1 + property.Parameters.Sum(p => p.Values.Count);
            if (count > MaxProperties) throw new CalendarFormatException("too many lines");
            if (property.Name == "BEGIN")
            {
                if (root is not null && stack.Count == 0) throw new CalendarFormatException("text after END:VCALENDAR");
                if (stack.Count >= MaxDepth) throw new CalendarFormatException("components nested too deep");
                var component = new CalComponent(property.Value.Trim());
                if (stack.TryPeek(out var parent)) parent.Children.Add(component);
                else if (component.Name != "VCALENDAR") throw new CalendarFormatException("not a VCALENDAR");
                else root = component;
                stack.Push(component);
            }
            else if (property.Name == "END")
            {
                if (!stack.TryPop(out var open) || !string.Equals(open.Name, property.Value.Trim(), StringComparison.OrdinalIgnoreCase))
                    throw new CalendarFormatException("an END does not close the open component");
            }
            else if (stack.TryPeek(out var current)) current.Properties.Add(property);
            else throw new CalendarFormatException("property outside a component");
        }
        if (root is null || stack.Count > 0) throw new CalendarFormatException("unterminated VCALENDAR");
        return root;
    }

    /// <summary>Prints a component tree with CRLF line ends, folding lines at 75 octets.</summary>
    public static string Write(CalComponent root)
    {
        var builder = new StringBuilder();
        WriteComponent(builder, root);
        return builder.ToString();
    }

    /// <summary>A TEXT value's string (RFC 5545 3.3.11): <c>\n</c>, <c>\;</c>, <c>\,</c>, <c>\\</c>.</summary>
    public static string Unescape(string value)
    {
        if (!value.Contains('\\', StringComparison.Ordinal)) return value;
        var builder = new StringBuilder(value.Length);
        for (var i = 0; i < value.Length; i++)
        {
            var c = value[i];
            if (c != '\\' || i + 1 == value.Length)
            {
                builder.Append(c);
                continue;
            }
            var next = value[++i];
            builder.Append(next is 'n' or 'N' ? '\n' : next);
        }
        return builder.ToString();
    }

    /// <summary>A string as a TEXT value. Line breaks of any kind become <c>\n</c>.</summary>
    public static string Escape(string text)
    {
        var builder = new StringBuilder(text.Length + 8);
        for (var i = 0; i < text.Length; i++)
        {
            var c = text[i];
            switch (c)
            {
                case '\\': builder.Append(@"\\"); break;
                case ';': builder.Append(@"\;"); break;
                case ',': builder.Append(@"\,"); break;
                case '\r':
                    builder.Append(@"\n");
                    if (i + 1 < text.Length && text[i + 1] == '\n') i++;
                    break;
                case '\n': builder.Append(@"\n"); break;
                default:
                    // Other control characters aren't allowed in a TEXT value.
                    if ((c >= ' ' && c != '\u007f') || c == '\t') builder.Append(c);
                    break;
            }
        }
        return builder.ToString();
    }

    private static IEnumerable<string> Unfold(string text)
    {
        var current = new StringBuilder();
        var have = false;
        foreach (var piece in text.Split('\n'))
        {
            var line = piece.EndsWith('\r') ? piece[..^1] : piece;
            if (line.Length > 0 && (line[0] == ' ' || line[0] == '\t'))
            {
                if (have) current.Append(line, 1, line.Length - 1);
                continue;
            }
            if (have && current.Length > 0) yield return current.ToString();
            current.Clear().Append(line);
            have = true;
        }
        if (have && current.Length > 0) yield return current.ToString();
    }

    /// <summary>The most parameter values one content line may carry; real ones have a handful.</summary>
    public const int MaxParameterValues = 64;

    private static CalProperty ParseLine(string line)
    {
        // A CR left inside a line (not part of a CRLF) could pose as a line break to the next
        // reader, so a line holding one isn't taken.
        if (line.Contains('\r', StringComparison.Ordinal)) throw new CalendarFormatException("a stray carriage return");
        var given = 0;
        var i = 0;
        while (i < line.Length && line[i] != ';' && line[i] != ':') i++;
        if (i == 0 || i == line.Length) throw new CalendarFormatException("not a content line");
        var name = line[..i];
        var parameters = new List<CalParameter>();
        while (line[i] == ';')
        {
            var start = ++i;
            while (i < line.Length && line[i] != '=') i++;
            if (i == line.Length) throw new CalendarFormatException("parameter without a value");
            var paramName = line[start..i].ToUpperInvariant();
            var values = new List<string>();
            do
            {
                if (++given > MaxParameterValues) throw new CalendarFormatException("too many parameters on one line");
                i++;
                if (i < line.Length && line[i] == '"')
                {
                    var close = line.IndexOf('"', i + 1);
                    if (close < 0) throw new CalendarFormatException("unterminated quoted parameter");
                    values.Add(line[(i + 1)..close]);
                    i = close + 1;
                }
                else
                {
                    start = i;
                    while (i < line.Length && line[i] != ',' && line[i] != ';' && line[i] != ':') i++;
                    values.Add(line[start..i]);
                }
                if (i == line.Length) throw new CalendarFormatException("content line without a value");
            } while (line[i] == ',');
            parameters.Add(new CalParameter(paramName, values));
        }
        if (line[i] != ':') throw new CalendarFormatException("content line without a value");
        return new CalProperty(name, line[(i + 1)..], parameters, line);
    }

    private static void WriteComponent(StringBuilder builder, CalComponent component)
    {
        WriteLine(builder, "BEGIN:" + component.Name);
        foreach (var property in component.Properties) WriteLine(builder, property.Raw ?? Line(property));
        foreach (var child in component.Children) WriteComponent(builder, child);
        WriteLine(builder, "END:" + component.Name);
    }

    /// <summary>One property as an unfolded content line (<c>EXDATE;TZID=Europe/Berlin:20261204T090000</c>).</summary>
    public static string ContentLine(CalProperty property) => property.Raw ?? Line(property);

    private static string Line(CalProperty property)
    {
        Plain(property.Name, "property name");
        Plain(property.Value, "value of " + property.Name);
        var builder = new StringBuilder(property.Name);
        foreach (var parameter in property.Parameters)
        {
            builder.Append(';').Append(parameter.Name).Append('=');
            for (var v = 0; v < parameter.Values.Count; v++)
            {
                if (v > 0) builder.Append(',');
                // A DQUOTE can't appear inside a parameter value at all; control characters neither.
                var text = new string(parameter.Values[v].Where(c => c != '"' && (c >= ' ' || c == '\t')).ToArray());
                var quote = text.AsSpan().IndexOfAny(";:,") >= 0;
                if (quote) builder.Append('"');
                builder.Append(text);
                if (quote) builder.Append('"');
            }
        }
        return builder.Append(':').Append(property.Value).ToString();
    }

    // A raw value with a line break (or a bare CR some reader takes for one) would end the line
    // early and let the rest pose as a new property: values built from outside text must go
    // through Escape first. No other control character belongs in a content line either.
    private static void Plain(string text, string what)
    {
        foreach (var c in text)
            if ((c < ' ' && c != '\t') || c == '\u007f') throw new ArgumentException($"a control character in the {what}");
    }

    private static void WriteLine(StringBuilder builder, string line)
    {
        // Fold at 75 octets of UTF-8 (RFC 5545 3.1), never inside a character.
        var octets = 0;
        var limit = 75;
        foreach (var rune in line.EnumerateRunes())
        {
            var size = rune.Utf8SequenceLength;
            if (octets + size > limit)
            {
                builder.Append("\r\n ");
                octets = 1;
                limit = 75;
            }
            builder.Append(rune.ToString());
            octets += size;
        }
        builder.Append("\r\n");
    }
}
