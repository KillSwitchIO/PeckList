import { addDays } from '../../core/dates.ts';
import type { CalendarMode } from '../../ports/calendarView.ts';
import { formatMonth } from '../format.ts';

/**
 * The calendar's heading: "October", "Oct 19 - 25", "Thursday, Oct 22", with the year only when it
 * is not this one ("October 2027", "Dec 28, 2026 - Jan 3, 2027").
 */
export function calendarTitle(
  mode: CalendarMode,
  date: string,
  weekStart: 0 | 1,
  today: string,
  locale?: string,
): string {
  const at = (day: string) => new Date(`${day}T12:00:00Z`);
  const format = (day: string, options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(at(day));
  const thisYear = today.slice(0, 4);
  if (mode === 'month') return formatMonth(date.slice(0, 7), today, locale);
  if (mode === 'day') {
    const year = date.slice(0, 4) === thisYear ? undefined : 'numeric';
    return format(date, { weekday: 'long', month: 'short', day: 'numeric', year });
  }
  const lead = (at(date).getUTCDay() - weekStart + 7) % 7;
  const first = addDays(date, -lead);
  const last = addDays(first, 6);
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
