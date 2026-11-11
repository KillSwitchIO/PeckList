using System.Globalization;
using System.Text.RegularExpressions;

namespace PeckList.Core.Api;

/// <summary>Something quick add recognised: what kind, and where it sits in the text (<c>End</c> exclusive).</summary>
public sealed record QuickToken(string Kind, int Start, int End, string Text);

/// <summary>A tag quick add names: an existing one by id, or a new one by name (id null).</summary>
public sealed record QuickTag(string? Id, string Name);

/// <summary>Someone <c>@</c> can name: the assignee picker's people.</summary>
public sealed record QuickPerson(string Principal, string Name, string? Handle);

/// <summary>A list <c>^</c> can name, in the order the app shows them (the inbox first).</summary>
public sealed record QuickList(string Id, string Name);

/// <summary>What quick add has to go on: the person's lists, tags and people, and their wall clock now.</summary>
public sealed record QuickAddContext(IReadOnlyList<QuickList> Lists, IReadOnlyList<(string Id, string Name)> Tags, IReadOnlyList<QuickPerson> People, DateTime Reference);

public sealed record QuickSchedule(QuickMoment Start, QuickMoment? End);

/// <summary>A line of text read as a task.</summary>
public sealed record QuickAddResult(
    string Title,
    IReadOnlyList<QuickToken> Tokens,
    QuickSchedule? Schedule,
    QuickMoment? Due,
    int? Priority,
    string? ListId,
    IReadOnlyList<QuickTag> Tags,
    IReadOnlyList<string> Assignees,
    string? Recurrence);

/// <summary>
/// Quick add on the server (PL-137): a C# port of <c>web/src/core/quickAdd.ts</c>. Dates and times
/// set the start, "due ..." the due date; #tag, ^list, !priority and @person pick those, and
/// "every ..." makes it repeat. Pinned to the app by <c>schema/fixtures/quick-add/cases.json</c>.
/// </summary>
public static partial class QuickAdd
{
    /// <summary>The longest text read; longer is refused before parsing.</summary>
    public const int MaxText = 1000;

    private const RegexOptions Options = RegexOptions.IgnoreCase | RegexOptions.CultureInvariant;

    private static readonly Dictionary<string, int> PriorityWords = new(StringComparer.Ordinal)
    {
        ["high"] = 3, ["h"] = 3, ["1"] = 3,
        ["medium"] = 2, ["med"] = 2, ["m"] = 2, ["2"] = 2,
        ["low"] = 1, ["l"] = 1, ["3"] = 1,
        ["none"] = 0, ["0"] = 0,
    };

    private static readonly string[] DayNames = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
    private static readonly string[] DayCodes = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

    private const string DayWord = @"(?:sun|mon|tues?|wed(?:nes)?|thu(?:rs?)?|fri|sat(?:ur)?)(?:day)?s?";

    [GeneratedRegex(@"(^|\s)every\s+(?:(other)\s+|(\d{1,3})\s+)?(weekdays?|(?:day|week|month|year)s?|" + DayWord + @"(?:(?:\s*,\s*|\s*,?\s+(?:and|&)\s+)" + DayWord + @")*)(?=$|[\s,.;!?])", Options, 200)]
    private static partial Regex Repeat();

    [GeneratedRegex(@"(^|\s)(due(\s+(by|on))?)\s+$", Options, 200)]
    private static partial Regex DueLead();

    [GeneratedRegex(@"[\s_-]+", RegexOptions.CultureInvariant, 200)]
    private static partial Regex Compactable();

    [GeneratedRegex(@"\s*,\s*|\s+(?:and|&)\s+|\s+", Options, 200)]
    private static partial Regex DaySeparator();

    [GeneratedRegex(@"\s+", RegexOptions.CultureInvariant, 200)]
    private static partial Regex Spaces();

    private static string Compact(string text) => Compactable().Replace(text.ToLowerInvariant(), "");

    /// <summary>Words that start at a space (or the beginning) and begin with <paramref name="sigil"/>.</summary>
    private static IEnumerable<(int Start, int End, string Word)> SigilWords(string text, char sigil)
    {
        var pattern = new Regex(@"(^|\s)" + Regex.Escape(sigil.ToString()) + @"(\S+)", RegexOptions.CultureInvariant, TimeSpan.FromMilliseconds(200));
        foreach (Match match in pattern.Matches(text))
        {
            var start = match.Index + match.Groups[1].Length;
            yield return (start, start + 1 + match.Groups[2].Length, match.Groups[2].Value);
        }
    }

    private sealed record Rule(string Freq, int Interval, IReadOnlyList<int> ByDay)
    {
        /// <summary><c>formatRule</c> (web/src/core/recurrence.ts) for the parts quick add makes.</summary>
        public string Format()
        {
            var parts = new List<string> { $"FREQ={Freq}" };
            if (Interval != 1) parts.Add($"INTERVAL={Interval.ToString(CultureInfo.InvariantCulture)}");
            if (ByDay.Count > 0) parts.Add("BYDAY=" + string.Join(',', ByDay.Select(day => DayCodes[day])));
            return string.Join(';', parts);
        }
    }

    /// <summary>"every day", "every 3 weeks", "every other monday", "every mon, wed and fri", "every weekday".</summary>
    private static (int Start, int End, Rule Rule)? FindRepeat(string text)
    {
        var match = Repeat().Match(text);
        if (!match.Success) return null;
        var interval = match.Groups[2].Success ? 2 : match.Groups[3].Success ? int.Parse(match.Groups[3].Value, CultureInfo.InvariantCulture) : 1;
        if (interval < 1) return null;
        var what = match.Groups[4].Value.ToLowerInvariant();
        var start = match.Index + match.Groups[1].Length;
        var end = match.Index + match.Length;
        if (what is "weekday" or "weekdays") return (start, end, new Rule("WEEKLY", interval, [1, 2, 3, 4, 5]));
        var unit = what.TrimEnd('s');
        if (unit is "day" or "week" or "month" or "year")
        {
            var freq = unit switch { "day" => "DAILY", "week" => "WEEKLY", "month" => "MONTHLY", _ => "YEARLY" };
            return (start, end, new Rule(freq, interval, []));
        }
        var days = DaySeparator().Split(what).Where(word => word.Length > 0).Distinct()
            .Select(word => Array.IndexOf(DayNames, word.Length >= 3 ? word[..3] : word))
            .Where(day => day >= 0).Distinct().ToList();
        if (days.Count == 0) return null;
        return (start, end, new Rule("WEEKLY", interval, days));
    }

    /// <summary>The first of a weekly rule's days on or after <paramref name="date"/> (any date for other rules).</summary>
    private static string FirstOn(Rule rule, string date)
    {
        if (rule.Freq != "WEEKLY" || rule.ByDay.Count == 0) return date;
        var at = DateOnly.ParseExact(date, "yyyy-MM-dd", CultureInfo.InvariantCulture);
        while (!rule.ByDay.Contains((int)at.DayOfWeek)) at = at.AddDays(1);
        return at.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
    }

    private static string LeafName(string name) => name[(name.LastIndexOf('/') + 1)..];

    public static QuickAddResult Parse(string text, QuickAddContext context)
    {
        var tokens = new List<QuickToken>();
        void Take(string kind, int start, int end) => tokens.Add(new QuickToken(kind, start, end, text[start..end]));

        int? priority = null;
        foreach (var (start, end, word) in SigilWords(text, '!'))
        {
            if (PriorityWords.TryGetValue(word.ToLowerInvariant(), out var value) && priority is null)
            {
                Take("priority", start, end);
                priority = value;
            }
        }

        string? listId = null;
        foreach (var (start, end, word) in SigilWords(text, '^'))
        {
            var wanted = Compact(word);
            var list = context.Lists.FirstOrDefault(each => Compact(each.Name) == wanted)
                ?? context.Lists.FirstOrDefault(each => Compact(each.Name).StartsWith(wanted, StringComparison.Ordinal));
            if (list is not null && listId is null)
            {
                Take("list", start, end);
                listId = list.Id;
            }
        }

        var tags = new List<QuickTag>();
        foreach (var (start, end, word) in SigilWords(text, '#'))
        {
            var name = TaskInput.NormalizeTag(word);
            if (name.Length == 0 || tags.Any(tag => tag.Name == name)) continue;
            // A full path, else a unique leaf name ("#yard" for home/yard), else a new tag.
            var exact = context.Tags.Where(tag => tag.Name.Equals(name, StringComparison.OrdinalIgnoreCase)).Select(tag => (string?)tag.Id).FirstOrDefault();
            var leaves = context.Tags.Where(tag => LeafName(tag.Name).Equals(name, StringComparison.OrdinalIgnoreCase)).ToList();
            Take("tag", start, end);
            if (exact is not null) tags.Add(new QuickTag(exact, context.Tags.First(tag => tag.Id == exact).Name));
            else if (leaves.Count == 1) tags.Add(new QuickTag(leaves[0].Id, leaves[0].Name));
            else tags.Add(new QuickTag(null, name));
        }

        var assignees = new List<string>();
        foreach (var (start, end, word) in SigilWords(text, '@'))
        {
            var wanted = word.ToLowerInvariant();
            var person = context.People.FirstOrDefault(each =>
                !each.Principal.StartsWith("invite:", StringComparison.Ordinal)
                && (each.Name.ToLowerInvariant() == wanted
                    || Compact(each.Name) == Compact(word)
                    || each.Handle?.ToLowerInvariant() == wanted
                    || each.Handle?.ToLowerInvariant().Split('@')[0] == wanted));
            if (person is not null && !assignees.Contains(person.Principal))
            {
                Take("person", start, end);
                assignees.Add(person.Principal);
            }
        }

        // "every ...", before the dates so "every monday" is not just next Monday.
        Rule? rule = null;
        if (FindRepeat(text) is { } repeat && !tokens.Any(token => token.Start < repeat.End && repeat.Start < token.End))
        {
            Take("repeat", repeat.Start, repeat.End);
            rule = repeat.Rule;
        }

        // Dates, in the text with the tokens above blanked out (positions stay the same).
        var masked = text.ToCharArray();
        foreach (var token in tokens) for (var at = token.Start; at < token.End; at++) masked[at] = ' ';
        var maskedText = new string(masked);
        QuickSchedule? schedule = null;
        QuickMoment? due = null;
        foreach (var match in QuickDates.Find(maskedText, context.Reference))
        {
            // "due fri", "due by friday": the word belongs to the token.
            var lead = DueLead().Match(maskedText[..match.Index]);
            if (lead.Success && due is null)
            {
                Take("due", lead.Index + lead.Groups[1].Length, match.Index + match.Length);
                due = match.Start;
            }
            else if (!lead.Success && schedule is null)
            {
                Take("date", match.Index, match.Index + match.Length);
                schedule = new QuickSchedule(match.Start, match.End);
            }
        }

        // A repeat counts from a date: the one given, moved to the first of its weekdays, else today.
        if (rule is not null)
        {
            if (schedule is not null)
            {
                var date = FirstOn(rule, schedule.Start.Date);
                schedule = new QuickSchedule(
                    schedule.Start with { Date = date },
                    schedule.End is { } end && schedule.Start.Date == end.Date ? end with { Date = date } : schedule.End);
            }
            else if (due is null)
            {
                var today = DateOnly.FromDateTime(context.Reference).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
                schedule = new QuickSchedule(new QuickMoment(FirstOn(rule, today), null), null);
            }
        }

        tokens.Sort((a, b) => a.Start.CompareTo(b.Start));
        var title = new System.Text.StringBuilder();
        var from = 0;
        foreach (var token in tokens)
        {
            title.Append(text, from, token.Start - from);
            from = token.End;
        }
        title.Append(text, from, text.Length - from);
        var cleaned = Spaces().Replace(title.ToString(), " ").Trim();
        return new QuickAddResult(cleaned, tokens, schedule, due, priority, listId, tags, assignees, rule?.Format());
    }
}
