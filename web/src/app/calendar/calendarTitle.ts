import { addDays } from '../../core/dates.ts';
import { formatMonth } from '../format.ts';

/**
 * The calendar's heading: "October" for the month view; for the Days view "Thursday, Oct 22" (one
 * day) or "Oct 22 - 28" (several), with the year only when it is not this one ("October 2027",
 * "Dec 28, 2026 - Jan 3, 2027").
 */
export function calendarTitle(
  mode: 'month' | 'days',
  date: string,
  count: number,
  today: string,
  locale?: string,
): string {
  const at = (day: string) => new Date(`${day}T12:00:00Z`);
  const format = (day: string, options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(at(day));
  const thisYear = today.slice(0, 4);
  if (mode === 'month') return formatMonth(date.slice(0, 7), today, locale);
  if (count <= 1) {
    const year = date.slice(0, 4) === thisYear ? undefined : 'numeric';
    return format(date, { weekday: 'long', month: 'short', day: 'numeric', year });
  }
  const first = date;
  const last = addDays(first, count - 1);
  const start = format(first, { month: 'short', day: 'numeric' });
  const year = last.slice(0, 4);
  if (first.slice(0, 4) !== year)
    return `${format(first, { month: 'short', day: 'numeric', year: 'numeric' })} - ${format(last, { month: 'short', day: 'numeric', year: 'numeric' })}`;
  const end =
    first.slice(5, 7) === last.slice(5, 7)
      ? String(Number(last.slice(8, 10)))
      : format(last, { month: 'short', day: 'numeric' });
  return year === thisYear ? `${start} - ${end}` : `${start} - ${end}, ${year}`;
}
