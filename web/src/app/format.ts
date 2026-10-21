// Locale-aware display of local dates and times.
import { addDays, datePart, timePart } from '../core/dates.ts';
import { t } from './i18n/i18n.ts';

function toDate(date: string): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d, 12));
}

/** "Today", "Tomorrow", "Yesterday", "Thu, Oct 22" or "Oct 22, 2027" for other years. */
export function formatDay(date: string, today: string, locale?: string): string {
  if (date === today) return t('date.today');
  if (date === addDays(today, 1)) return t('date.tomorrow');
  if (date === addDays(today, -1)) return t('date.yesterday');
  const sameYear = date.slice(0, 4) === today.slice(0, 4);
  return new Intl.DateTimeFormat(locale, {
    timeZone: 'UTC',
    weekday: sameYear ? 'short' : undefined,
    month: 'short',
    day: 'numeric',
    year: sameYear ? undefined : 'numeric',
  }).format(toDate(date));
}

/**
 * Display a 24-hour `HH:mm`. Standard (12-hour) clock by default; a Settings toggle for the
 * 24-hour clock is planned (PL-025).
 */
export function formatTime(time: string, locale?: string, hour12 = true): string {
  const [h, m] = time.split(':').map(Number) as [number, number];
  return new Intl.DateTimeFormat(locale, {
    timeZone: 'UTC',
    hour: hour12 ? 'numeric' : '2-digit',
    minute: '2-digit',
    hour12,
  }).format(new Date(Date.UTC(2000, 0, 1, h, m)));
}

/** A local date or date-time for display: "Today 9:00 AM", "Thu, Oct 22". */
export function formatWhen(value: string, today: string, locale?: string): string {
  const day = formatDay(datePart(value), today, locale);
  const time = timePart(value);
  return time ? `${day} ${formatTime(time, locale)}` : day;
}
