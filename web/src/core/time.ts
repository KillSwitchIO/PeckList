// Free-form time entry. Accepts what people naturally type and returns 24-hour `HH:mm`.
//
//   9, 09        -> 09:00        missing minutes are 00
//   930, 0930    -> 09:30        3-4 digits are H(H)MM
//   9:30, 9.30   -> 09:30
//   22, 2200     -> 22:00        hours 13-23 are 24-hour ("military") time
//   10pm, 10 p   -> 22:00        am/pm suffix (a, am, p, pm, a.m., p.m.)
//   12am         -> 00:00
//
// Returns null for anything that is not a real time (25, 9:75, 13pm, text).

const PATTERN = /^(\d{1,2})(?:[:.]?(\d{2}))?(a|am|p|pm)?$/;

export function parseTime(input: string): string | null {
  const cleaned = input
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/\./g, (_dot, offset: number, whole: string) =>
      // keep "9.30" as a separator, drop the dots in "a.m." / "p.m."
      /\d/.test(whole.charAt(offset - 1)) && /\d/.test(whole.charAt(offset + 1)) ? ':' : '',
    );
  if (!cleaned) return null;

  // "930" / "0930" / "2130": split the last two digits off as minutes.
  const compact = /^(\d{3,4})(a|am|p|pm)?$/.exec(cleaned);
  const normalized = compact
    ? `${compact[1]!.slice(0, -2)}:${compact[1]!.slice(-2)}${compact[2] ?? ''}`
    : cleaned;

  const match = PATTERN.exec(normalized);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = match[2] === undefined ? 0 : Number(match[2]);
  const suffix = match[3];
  if (minute > 59) return null;

  if (suffix) {
    if (hour < 1 || hour > 12) return null;
    const pm = suffix.startsWith('p');
    if (hour === 12) hour = pm ? 12 : 0;
    else if (pm) hour += 12;
  } else if (hour > 23) {
    return null;
  }
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}
