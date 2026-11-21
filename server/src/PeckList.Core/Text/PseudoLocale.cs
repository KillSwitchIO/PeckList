using System.Text;

namespace PeckList.Core.Text;

/// <summary>
/// A pseudo-language for tests (PL-148): every word of the English catalog accented and the whole
/// message bracketed, "[Ðüé ŧöđàý]", with the ICU syntax (parameters, plural and select keywords,
/// <c>#</c>, quotes) left as it is. Text that shows up unaccented never went through the catalog.
/// Keys ending in <c>Pattern</c> are date patterns (<see cref="Push.DatePattern"/>), kept as they are.
/// </summary>
public static class PseudoLocale
{
    public const string Tag = "en-XA";

    private const string Plain = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    private const string Accented = "àƀçđéƒğħîĵķļɱñöþǫŕšŧûṽŵẋýžÀƁÇĐÉƑĞĦÎĴĶĻṀÑÖÞǪŔŠŦÛṼŴẊÝŽ";

    /// <summary>The pseudo-language's catalog for <paramref name="english"/>.</summary>
    public static IReadOnlyDictionary<string, string> Of(IReadOnlyDictionary<string, string> english) =>
        english.ToDictionary(pair => pair.Key, pair => pair.Key.EndsWith("Pattern", StringComparison.Ordinal) ? pair.Value : Message(pair.Value), StringComparer.Ordinal);

    /// <summary>One message, accented and bracketed.</summary>
    public static string Message(string message)
    {
        var at = 0;
        var text = new StringBuilder("[");
        Body(message, ref at, text, inPlural: false, nested: false);
        return text.Append(']').ToString();
    }

    /// <summary>Whether <paramref name="text"/> has an unaccented ASCII letter: text that skipped the catalog.</summary>
    public static bool HasPlainLetters(string text) => text.Any(each => Plain.Contains(each));

    // Text up to the end of the message, or to the '}' that closes a branch (left for the caller).
    private static void Body(string message, ref int at, StringBuilder text, bool inPlural, bool nested)
    {
        while (at < message.Length)
        {
            var each = message[at];
            if (each == '}' && nested) return;
            if (each == '{')
            {
                Argument(message, ref at, text);
                continue;
            }
            if (each == '\'')
            {
                Quoted(message, ref at, text);
                continue;
            }
            text.Append(each == '#' && inPlural ? '#' : Accent(each));
            at++;
        }
    }

    // {name}, {name, plural|select|selectordinal, key {body} ...}, or another typed argument as it is.
    private static void Argument(string message, ref int at, StringBuilder text)
    {
        var start = at;
        var comma = message.IndexOf(',', at);
        var close = message.IndexOf('}', at);
        if (close < 0) { text.Append(message, at, message.Length - at); at = message.Length; return; }
        if (comma < 0 || close < comma) { text.Append(message, start, close - start + 1); at = close + 1; return; }
        var typeEnd = message.IndexOfAny([',', '}'], comma + 1);
        var type = message[(comma + 1)..(typeEnd < 0 ? message.Length : typeEnd)].Trim();
        if (type is not ("plural" or "select" or "selectordinal") || typeEnd < 0 || message[typeEnd] != ',')
        {
            var end = Matching(message, start);
            text.Append(message, start, end - start + 1);
            at = end + 1;
            return;
        }
        text.Append(message, start, typeEnd + 1 - start);
        at = typeEnd + 1;
        while (at < message.Length && message[at] != '}')
        {
            // A key (one, other, =1, offset:1) up to its body.
            var open = message.IndexOf('{', at);
            if (open < 0) break;
            text.Append(message, at, open - at + 1);
            at = open + 1;
            Body(message, ref at, text, inPlural: type != "select", nested: true);
            if (at < message.Length) text.Append(message[at++]);
            while (at < message.Length && char.IsWhiteSpace(message[at])) text.Append(message[at++]);
        }
        if (at < message.Length) text.Append(message[at++]);
    }

    // ICU quoting: '' is an apostrophe; '{...}' is text as it is.
    private static void Quoted(string message, ref int at, StringBuilder text)
    {
        if (at + 1 < message.Length && message[at + 1] == '\'') { text.Append("''"); at += 2; return; }
        if (at + 1 < message.Length && message[at + 1] is '{' or '}' or '#' or '|')
        {
            var end = message.IndexOf('\'', at + 1);
            end = end < 0 ? message.Length - 1 : end;
            text.Append(message, at, end - at + 1);
            at = end + 1;
            return;
        }
        text.Append('\'');
        at++;
    }

    private static int Matching(string message, int open)
    {
        var depth = 0;
        for (var at = open; at < message.Length; at++)
        {
            if (message[at] == '{') depth++;
            else if (message[at] == '}' && --depth == 0) return at;
        }
        return message.Length - 1;
    }

    private static char Accent(char each) => Plain.IndexOf(each) is var at and >= 0 ? Accented[at] : each;
}
