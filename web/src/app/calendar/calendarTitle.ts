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
 */
export function calendarTitle(
  mode: 'month' | 'days' | 'year',
  date: string,
  count: number,
  today: string,
  locale?: string,
  narrow = false,
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
  const start = format(first, { month: 'short', day: 'numeric' });
  const year = last.slice(0, 4);
  const sameMonth = first.slice(5, 7) === last.slice(5, 7);
  const end = sameMonth
    ? String(Number(last.slice(8, 10)))
    : format(last, { month: 'short', day: 'numeric' });
  if (year === thisYear || (narrow && !sameMonth)) return `${start} - ${end}`;
  return narrow ? `${start} - ${end} ’${year.slice(2)}` : `${start} - ${end}, ${year}`;
}
