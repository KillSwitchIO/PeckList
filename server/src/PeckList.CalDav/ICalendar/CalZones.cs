using System.Globalization;

namespace PeckList.CalDav.ICalendar;

/// <summary>
/// Time zones in calendar objects. PeckList keeps a schedule's zone as an IANA name (spec: Dates
/// and Times), so a TZID that is one, or ends in one, is kept by name. Anything else (an Outlook
/// zone name, a made-up TZID) is read through the object's own VTIMEZONE and the time reported in
/// UTC. When writing, each IANA zone an event uses gets a VTIMEZONE built from the zone's rules,
/// as RFC 5545 3.6.5 asks.
/// </summary>
public static class CalZones
{
    /// <summary>
    /// The IANA name a TZID stands for, or null. Takes the name itself (<c>Europe/Berlin</c>), the
    /// UTC spellings, and a name behind a vendor prefix (<c>/mozilla.org/20050126_1/America/New_York</c>).
    /// </summary>
    public static string? IanaName(string tzid)
    {
        var name = tzid.Trim();
        if (name.Length is 0 or > 128) return null;
        if (name is "Z" or "UTC" or "GMT" or "Etc/UTC" or "Etc/GMT" or "UCT" or "Zulu") return EventTime.Utc;
        if (IsIana(name)) return name;
        var segments = name.Split('/', StringSplitOptions.RemoveEmptyEntries);
        for (var take = Math.Min(3, segments.Length - 1); take >= 1; take--)
        {
            var tail = string.Join('/', segments[^take..]);
            if (tail.Contains('/', StringComparison.Ordinal) && IsIana(tail)) return tail;
        }
        return null;
    }

    /// <summary>The zone for an IANA name, or null when this system doesn't know it.</summary>
    public static TimeZoneInfo? Find(string iana) =>
        iana == EventTime.Utc ? TimeZoneInfo.Utc
        : TimeZoneInfo.TryFindSystemTimeZoneById(iana, out var zone) && zone.HasIanaId ? zone : null;

    // HasIanaId keeps out a Windows name the runtime converted, which the apps couldn't use.
    private static bool IsIana(string name) => Find(name) is not null;

    /// <summary>
    /// The UTC offset a VTIMEZONE gives a local clock reading: the observance (STANDARD or
    /// DAYLIGHT) whose latest onset is at or before it. Null when the component has no usable
    /// observance.
    /// </summary>
    public static TimeSpan? Offset(CalComponent vtimezone, DateTime local)
    {
        (DateTime Onset, TimeSpan To)? best = null;
        (DateTime Onset, TimeSpan From)? earliest = null;
        foreach (var observance in vtimezone.Children.Where(c => c.Name is "STANDARD" or "DAYLIGHT"))
        {
            try
            {
                var start = observance.Property("DTSTART")?.Value;
                var fromText = observance.Property("TZOFFSETFROM")?.Value;
                var toText = observance.Property("TZOFFSETTO")?.Value;
                if (start is null || toText is null) continue;
                var first = CalValues.ParseDateTime(start).Value;
                var to = CalValues.ParseOffset(toText);
                var from = fromText is null ? to : CalValues.ParseOffset(fromText);
                if (earliest is null || first < earliest.Value.Onset) earliest = (first, from);
                foreach (var onset in Onsets(observance, first, local.Year))
                {
                    if (onset <= local && (best is null || onset > best.Value.Onset)) best = (onset, to);
                }
            }
            catch (Exception e) when (e is CalendarFormatException or ArgumentException or FormatException or OverflowException)
            {
                // One broken observance shouldn't hide the others.
            }
        }
        return best?.To ?? earliest?.From;
    }

    // The onsets of one observance that could be the latest before a time in `year`: its first
    // onset, its RDATEs, and its yearly rule's onsets in that year and the one before.
    private static IEnumerable<DateTime> Onsets(CalComponent observance, DateTime first, int year)
    {
        yield return first;
        foreach (var rdate in observance.All("RDATE"))
        {
            foreach (var part in rdate.Value.Split(','))
            {
                if (part.Contains('/', StringComparison.Ordinal)) continue; // a PERIOD, never used here
                yield return CalValues.ParseDateTime(part).Value;
            }
        }
        if (observance.Property("RRULE")?.Value is not { } rule) yield break;
        var parts = rule.Split(';').Select(p => p.Split('=', 2)).Where(p => p.Length == 2)
            .ToDictionary(p => p[0].Trim().ToUpperInvariant(), p => p[1].Trim(), StringComparer.Ordinal);
        if (!parts.TryGetValue("FREQ", out var freq) || !string.Equals(freq, "YEARLY", StringComparison.OrdinalIgnoreCase)) yield break;
        DateTime? until = parts.TryGetValue("UNTIL", out var u) ? CalValues.ParseDateTime(u).Value : null;
        int? count = parts.TryGetValue("COUNT", out var c) && int.TryParse(c, NumberStyles.None, CultureInfo.InvariantCulture, out var n) ? n : null;
        var month = parts.TryGetValue("BYMONTH", out var m) && int.TryParse(m, NumberStyles.None, CultureInfo.InvariantCulture, out var bm) && bm is >= 1 and <= 12 ? bm : first.Month;
        for (var y = Math.Max(1, year - 1); y <= Math.Min(9999, year); y++)
        {
            if (y < first.Year || (count is not null && y - first.Year >= count)) continue;
            var day = RuleDay(parts, y, month, first.Day);
            if (day is null) continue;
            var onset = day.Value.ToDateTime(TimeOnly.FromDateTime(first));
            // UNTIL is usually in UTC; within a day of the onset either reading picks the same years.
            if (onset < first || (until is not null && onset.AddDays(-1) > until.Value)) continue;
            yield return onset;
        }
    }

    private static DateOnly? RuleDay(Dictionary<string, string> parts, int year, int month, int firstDay)
    {
        var days = DateTime.DaysInMonth(year, month);
        var monthDays = parts.TryGetValue("BYMONTHDAY", out var md)
            ? md.Split(',').Select(d => int.TryParse(d, NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out var v) ? v : 0)
                .Where(v => v != 0).Select(v => v > 0 ? v : days + v + 1).Where(v => v >= 1 && v <= days).Order().ToList()
            : null;
        if (!parts.TryGetValue("BYDAY", out var byDay))
        {
            var only = monthDays?.FirstOrDefault() ?? Math.Min(firstDay, days);
            return only == 0 ? null : new DateOnly(year, month, only);
        }
        var token = byDay.Split(',')[0].Trim();
        if (token.Length < 2 || !Weekdays.TryGetValue(token[^2..].ToUpperInvariant(), out var weekday)) return null;
        var ordinalText = token[..^2];
        if (monthDays is not null)
        {
            // "Sunday on or after the 8th": BYMONTHDAY=8,9,...,14;BYDAY=SU.
            foreach (var d in monthDays)
                if (new DateOnly(year, month, d).DayOfWeek == weekday) return new DateOnly(year, month, d);
            return null;
        }
        var ordinal = 1;
        if (ordinalText.Length > 0 && !int.TryParse(ordinalText, NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out ordinal)) return null;
        // A month has five of each weekday at most.
        if (ordinal is 0 or > 5 or < -5) return null;
        if (ordinal > 0)
        {
            var firstOfMonth = new DateOnly(year, month, 1);
            var offset = ((int)weekday - (int)firstOfMonth.DayOfWeek + 7) % 7;
            var dayNumber = 1 + offset + (ordinal - 1) * 7;
            return dayNumber <= days ? new DateOnly(year, month, dayNumber) : null;
        }
        var last = new DateOnly(year, month, days);
        var back = ((int)last.DayOfWeek - (int)weekday + 7) % 7;
        var result = days - back + (ordinal + 1) * 7;
        return result >= 1 ? new DateOnly(year, month, result) : null;
    }

    private static readonly Dictionary<string, DayOfWeek> Weekdays = new(StringComparer.Ordinal)
    {
        ["SU"] = DayOfWeek.Sunday, ["MO"] = DayOfWeek.Monday, ["TU"] = DayOfWeek.Tuesday, ["WE"] = DayOfWeek.Wednesday,
        ["TH"] = DayOfWeek.Thursday, ["FR"] = DayOfWeek.Friday, ["SA"] = DayOfWeek.Saturday,
    };

    private static readonly string[] WeekdayCodes = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

    /// <summary>
    /// A VTIMEZONE for an IANA zone, from the zone's transitions around <paramref name="year"/>:
    /// one STANDARD and one DAYLIGHT observance with a yearly rule when the zone keeps one, the
    /// transitions themselves when it doesn't, and a single STANDARD observance for a zone with no
    /// changes. Calendar apps mostly go by the TZID; the component is for those that don't.
    /// </summary>
    public static CalComponent Build(string iana, int year)
    {
        var zone = Find(iana) ?? throw new ArgumentException($"unknown time zone {iana}", nameof(iana));
        var component = new CalComponent("VTIMEZONE");
        component.Properties.Add(new CalProperty("TZID", iana));
        var transitions = Transitions(zone, year, 2);
        if (transitions.Count == 0)
        {
            var offset = zone.GetUtcOffset(new DateTimeOffset(year, 7, 1, 0, 0, 0, TimeSpan.Zero));
            component.Children.Add(Observance("STANDARD", new DateTime(1970, 1, 1), offset, offset, null));
            return component;
        }
        var later = Transitions(zone, year + 2, 1);
        foreach (var group in transitions.GroupBy(t => t.Daylight))
        {
            var first = group.First();
            var rule = YearlyRule(first.Onset);
            var next = later.FirstOrDefault(t => t.Daylight == first.Daylight && t.To == first.To && t.From == first.From);
            var holds = rule is not null && group.All(t => Matches(rule.Value, t.Onset, first.Onset))
                && next.Onset != default && Matches(rule.Value, next.Onset, first.Onset);
            if (holds)
            {
                component.Children.Add(Observance(first.Daylight ? "DAYLIGHT" : "STANDARD", first.Onset, first.From, first.To,
                    $"FREQ=YEARLY;BYMONTH={first.Onset.Month.ToString(CultureInfo.InvariantCulture)};BYDAY={RuleText(rule!.Value)}"));
            }
            else
            {
                foreach (var t in group) component.Children.Add(Observance(t.Daylight ? "DAYLIGHT" : "STANDARD", t.Onset, t.From, t.To, null));
            }
        }
        return component;
    }

    private static CalComponent Observance(string kind, DateTime onset, TimeSpan from, TimeSpan to, string? rule)
    {
        var observance = new CalComponent(kind);
        observance.Properties.Add(new CalProperty("DTSTART", CalValues.FormatDateTime(onset)));
        if (rule is not null) observance.Properties.Add(new CalProperty("RRULE", rule));
        observance.Properties.Add(new CalProperty("TZOFFSETFROM", CalValues.FormatOffset(from)));
        observance.Properties.Add(new CalProperty("TZOFFSETTO", CalValues.FormatOffset(to)));
        return observance;
    }

    // The nth (or last, -1) weekday of the month an onset falls on, or null past the 4th week
    // when it isn't also the last.
    private static (int Ordinal, DayOfWeek Day)? YearlyRule(DateTime onset)
    {
        var days = DateTime.DaysInMonth(onset.Year, onset.Month);
        if (onset.Day + 7 > days) return (-1, onset.DayOfWeek);
        var nth = (onset.Day - 1) / 7 + 1;
        return nth <= 4 ? (nth, onset.DayOfWeek) : null;
    }

    private static bool Matches((int Ordinal, DayOfWeek Day) rule, DateTime onset, DateTime first) =>
        onset.Month == first.Month && onset.TimeOfDay == first.TimeOfDay && YearlyRule(onset) == rule;

    private static string RuleText((int Ordinal, DayOfWeek Day) rule) =>
        rule.Ordinal.ToString(CultureInfo.InvariantCulture) + WeekdayCodes[(int)rule.Day];

    private readonly record struct Transition(DateTime Onset, TimeSpan From, TimeSpan To, bool Daylight);

    // The offset changes of a zone in the given years, found by stepping a day at a time and
    // narrowing each change down to the minute. Onset is the local clock reading just before the
    // change, which is how VTIMEZONE writes DTSTART.
    private static List<Transition> Transitions(TimeZoneInfo zone, int year, int years)
    {
        var found = new List<Transition>();
        var at = new DateTimeOffset(year, 1, 1, 0, 0, 0, TimeSpan.Zero);
        var end = at.AddYears(years);
        var offset = zone.GetUtcOffset(at);
        while (at < end)
        {
            var next = at.AddDays(1);
            var nextOffset = zone.GetUtcOffset(next);
            if (nextOffset != offset)
            {
                DateTimeOffset low = at, high = next;
                while (high - low > TimeSpan.FromMinutes(1))
                {
                    var mid = low + (high - low) / 2;
                    mid = new DateTimeOffset(mid.Ticks - mid.Ticks % TimeSpan.TicksPerMinute, TimeSpan.Zero);
                    if (mid <= low) mid = low.AddMinutes(1);
                    if (zone.GetUtcOffset(mid) == offset) low = mid;
                    else high = mid;
                }
                found.Add(new Transition(high.UtcDateTime + offset, offset, nextOffset, zone.IsDaylightSavingTime(high)));
                offset = nextOffset;
            }
            at = next;
        }
        return found;
    }
}
