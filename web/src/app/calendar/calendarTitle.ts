import { addDays } from '../../core/dates.ts';
import type { CalendarMode } from '../../ports/calendarView.ts';

/** The calendar's heading: "October 2026", "Oct 19 - 25, 2026", "Thursday, Oct 22". */
export function calendarTitle(
  mode: CalendarMode,
  date: string,
  weekStart: 0 | 1,
  locale?: string,
): string {
  const at = (day: string) => new Date(`${day}T12:00:00Z`);
  const format = (day: string, options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(at(day));
  if (mode === 'month') return format(date, { month: 'long', year: 'numeric' });
  if (mode === 'day') return format(date, { weekday: 'long', month: 'short', day: 'numeric' });
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
  return `${start} - ${end}, ${year}`;
}
