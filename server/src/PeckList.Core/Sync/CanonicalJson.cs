using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace PeckList.Core.Sync;

/// <summary>
/// JSON with object keys sorted by UTF-16 code units, written the way JavaScript's
/// <c>JSON.stringify</c> writes values, so it matches <c>canonicalJson</c> in web/src/core/merge.ts.
/// Only used to break ties, so the rare float JavaScript prints differently is harmless.
/// </summary>
public static class CanonicalJson
{
    public static string Write(JsonNode? node)
    {
        var builder = new StringBuilder();
        Write(node, builder);
        return builder.ToString();
    }

    private static void Write(JsonNode? node, StringBuilder output)
    {
        switch (node)
        {
            case null:
                output.Append("null");
                break;
            case JsonObject obj:
                output.Append('{');
                var first = true;
                foreach (var (key, value) in obj.OrderBy(pair => pair.Key, StringComparer.Ordinal))
                {
                    if (!first) output.Append(',');
                    first = false;
                    WriteString(key, output);
                    output.Append(':');
                    Write(value, output);
                }
                output.Append('}');
                break;
            case JsonArray array:
                output.Append('[');
                for (var index = 0; index < array.Count; index++)
                {
                    if (index > 0) output.Append(',');
                    Write(array[index], output);
                }
                output.Append(']');
                break;
            case JsonValue value:
                WriteValue(value, output);
                break;
        }
    }

    private static void WriteValue(JsonValue value, StringBuilder output)
    {
        switch (value.GetValueKind())
        {
            case JsonValueKind.String:
                WriteString(value.GetValue<string>(), output);
                break;
            case JsonValueKind.True:
                output.Append("true");
                break;
            case JsonValueKind.False:
                output.Append("false");
                break;
            case JsonValueKind.Number:
                // Through the JSON text: a value built in code may hold an int, which will not convert.
                output.Append(Number(double.Parse(value.ToJsonString(), CultureInfo.InvariantCulture)));
                break;
            default:
                output.Append("null");
                break;
        }
    }

    /// <summary>A number as JavaScript prints it (integers in full below 1e21, otherwise shortest round-trip).</summary>
    private static string Number(double number)
    {
        if (double.IsNaN(number) || double.IsInfinity(number)) return "null";
        if (number == 0) return "0";
        if (Math.Abs(number) < 1e21 && Math.Floor(number) == number)
        {
            return number.ToString("F0", CultureInfo.InvariantCulture);
        }
        var text = number.ToString("R", CultureInfo.InvariantCulture);
        var e = text.IndexOf('E');
        if (e < 0) return text;
        var exponent = int.Parse(text[(e + 1)..], CultureInfo.InvariantCulture);
        return $"{text[..e]}e{(exponent > 0 ? "+" : "-")}{Math.Abs(exponent)}";
    }

    private static void WriteString(string text, StringBuilder output)
    {
        output.Append('"');
        for (var index = 0; index < text.Length; index++)
        {
            var c = text[index];
            switch (c)
            {
                case '"': output.Append("\\\""); break;
                case '\\': output.Append("\\\\"); break;
                case '\b': output.Append("\\b"); break;
                case '\f': output.Append("\\f"); break;
                case '\n': output.Append("\\n"); break;
                case '\r': output.Append("\\r"); break;
                case '\t': output.Append("\\t"); break;
                default:
                    if (c < 0x20 || LoneSurrogate(text, index))
                    {
                        output.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                    }
                    else
                    {
                        output.Append(c);
                    }
                    break;
            }
        }
        output.Append('"');
    }

    private static bool LoneSurrogate(string text, int index)
    {
        var c = text[index];
        if (char.IsHighSurrogate(c)) return index + 1 >= text.Length || !char.IsLowSurrogate(text[index + 1]);
        if (char.IsLowSurrogate(c)) return index == 0 || !char.IsHighSurrogate(text[index - 1]);
        return false;
    }
}
