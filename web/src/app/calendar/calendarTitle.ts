import { addDays } from '../../core/dates.ts';
import { formatMonth } from '../format.ts';
import { dateTimeFormat } from '../../core/intl.ts';

/**
 * The calendar's heading: "October" for the month view; for the Days view "Thursday, Oct 22" (one
 * day) or "Oct 22 - 28" (several), with the year only when it is not this one ("October 2027").
 * Days across a new year name it once, at the end ("Dec 28 - Jan 3, 2027").
 * The year view is always just its year. `narrow`, for the phone's row of buttons: a month in
 * another year is "Sep 2027", as there is no room for "September 2027". Days within one month of
 * another year name it short ("Jan 18 - 29 ’27"; Ben, 2026-11-21); days across two months leave
 * the year off ("Dec 28 - Jan 3"), as even the short year would cut the end date at 360 px. One day
 * is "Wed, Oct 22", or "Oct 22, 2027" in another year. The date picker's label keeps them whole.
 * Runs of days are put together by Intl in the language's own order ("19.-25. Okt.", "31 oct. -
 * 2 nov."; PL-148), with the same rules for the year. `compact`: the months as numbers ("28.11. -
 * 11.12."), for a phone whose row the short months don't fit (CalendarPage measures; German's
 * "28. Nov. - 11. Dez." at 360 px).
 */
export function calendarTitle(
  mode: 'month' | 'days' | 'year',
  date: string,
  count: number,
  today: string,
  locale?: string,
  narrow = false,
  compact = false,
): string {
  const at = (day: string) => new Date(`${day}T12:00:00Z`);
  const format = (day: string, options: Intl.DateTimeFormatOptions) =>
    dateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(at(day));
  const thisYear = today.slice(0, 4);
  if (mode === 'year') return format(date, { year: 'numeric' });
  if (mode === 'month') {
    return narrow && date.slice(0, 4) !== thisYear
      ? format(date, { month: 'short', year: 'numeric' })
      : formatMonth(date.slice(0, 7), today, locale);
  }
  if (count <= 1) {
    const year = date.slice(0, 4) === thisYear ? undefined : 'numeric';
    if (!narrow) return format(date, { weekday: 'long', month: 'short', day: 'numeric', year });
    // A phone's row has room for "Wed, May 20", or "May 20, 2027" in another year.
    return format(
      date,
      year
        ? { month: 'short', day: 'numeric', year }
        : { weekday: 'short', month: 'short', day: 'numeric' },
    );
  }
  const first = date;
  const last = addDays(first, count - 1);
  const sameMonth = first.slice(5, 7) === last.slice(5, 7);
  const year =
    last.slice(0, 4) === thisYear || (narrow && !sameMonth) ? 'none' : narrow ? 'short' : 'end';
  if (!compact && first.slice(0, 4) !== last.slice(0, 4)) {
    // Across a new year Intl writes two whole dates, with a year word for both ends ("2027 рр.",
    // Ukrainian's plural; Kyrgyz's "-ж." even with no year asked for): each end is its own date
    // anyway, so each is written as one, the year on the end only ("28 груд. - 3 січ. 2027 р.").
    const shown = (day: string, withYear: boolean) =>
      format(day, { month: 'short', day: 'numeric', ...(withYear ? { year: 'numeric' } : {}) });
    return `${shown(first, false)} - ${shown(last, year === 'end')}`;
  }
  // The language's own range (PL-148): "Oct 19 - 25", "19.-25. Okt.", "31 oct. - 2 nov.". Asked
  // without a year when none shows, as some languages shape a date with one differently; across a
  // new year Intl names both anyway, and rangeText takes them out.
  const parts = dateTimeFormat(locale, {
    month: compact ? 'numeric' : 'short',
    day: 'numeric',
    ...(year === 'none' ? {} : { year: 'numeric' }),
    timeZone: 'UTC',
  }).formatRangeToParts(at(first), at(last));
  return rangeText(parts, year);
}

type RangePart = Intl.DateTimeRangeFormatPart;

/** The range's own separator: the shared literal between its start and its end ("–"). */
function separatorAt(parts: RangePart[]): number {
  const end = parts.findIndex((part) => part.source === 'endRange');
  for (let i = end - 1; i >= 0; i--) {
    if (parts[i]!.type === 'literal' && parts[i]!.source === 'shared') return i;
  }
  return -1;
}

/**
 * A run of days from Intl's parts, with the year as the calendar wants it: `none` leaves it off,
 * `end` names it once, at the end (Intl names both ends across a new year), and `short` writes
 * the phone's "’27" (Ben, 2026-11-21). Intl's en dash between thin spaces becomes the app's own
 * " - ", as the rest of PeckList writes ranges.
 */
function rangeText(parts: RangePart[], year: 'none' | 'end' | 'short'): string {
  const kept = parts.map((part) => ({ ...part }));
  const separator = separatorAt(kept);
  const drop = new Set<number>();
  // Numeric dates are never merged ("1/18/2027 - 1/29/2027"): the year is named once, at the end.
  const endHasYear = kept.some((part) => part.type === 'year' && part.source === 'endRange');
  kept.forEach((part, i) => {
    if (part.type !== 'year') return;
    if (year === 'end' && part.source !== 'startRange') return;
    // Its joining literal goes with it: the one before ("Oct 19, 2026", "19. Okt. 2026"), or,
    // with the year first or after the separator, the one after ("2026年").
    const joinBefore = i > 0 && kept[i - 1]!.type === 'literal' && i - 1 !== separator;
    const joinAfter = kept[i + 1]?.type === 'literal' && i + 1 !== separator;
    if (year === 'short' && (part.source !== 'startRange' || !endHasYear)) {
      part.value = `’${part.value.slice(-2)}`;
      if (joinBefore) kept[i - 1]!.value = kept[i - 1]!.value.replace(/^[,\s]+$/, ' ');
      return;
    }
    drop.add(i);
    if (joinBefore) {
      drop.add(i - 1);
      // A year's own word goes too, at the start of the literal after it, which may be the
      // separator itself: Russian's "2026 г. – " leaves " – " (Dev 1).
      const next = kept[i + 1];
      if (next?.type === 'literal') next.value = next.value.replace(/^\s*\p{L}+\.?/u, '');
    } else if (joinAfter) drop.add(i + 1);
  });
  if (separator >= 0) {
    // An unspaced dash stays Intl's own where the dates have hyphens of their own (Swedish
    // "2027-01-18–29"), or the two would read as one date (Dev 1).
    const hyphenated = kept.some((part, i) => i !== separator && part.value.includes('-'));
    kept[separator]!.value = kept[separator]!.value.replace(/\s*–\s*/, (dash) =>
      dash.trim() !== dash ? ' - ' : hyphenated ? dash : '-',
    );
  }
  return kept
    .filter((_, i) => !drop.has(i))
    .map((part) => part.value)
    .join('');
}
