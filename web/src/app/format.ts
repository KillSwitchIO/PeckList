// Locale-aware display of local dates and times.
import { addDays, datePart, timePart } from '../core/dates.ts';
import { DATE_FORMAT_AUTO, formatDatePattern, isDatePattern } from '../core/dateFormat.ts';
import { t } from './i18n/i18n.ts';
import { dateTimeFormat } from '../core/intl.ts';

function toDate(date: string): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d, 12));
}

/**
 * "Today", "Tomorrow", "Yesterday", "Thu, Oct 22" or "Oct 22, 2027" for other years; other days
 * in the user's own date format when they picked one (Settings > Dates).
 */
export function formatDay(date: string, today: string, locale?: string): string {
  if (date === today) return t('date.today');
  if (date === addDays(today, 1)) return t('date.tomorrow');
  if (date === addDays(today, -1)) return t('date.yesterday');
  if (display.dateFormat) return formatDatePattern(date, display.dateFormat, locale);
  const sameYear = date.slice(0, 4) === today.slice(0, 4);
  return dateTimeFormat(locale, {
    timeZone: 'UTC',
    weekday: sameYear ? 'short' : undefined,
    month: 'short',
    day: 'numeric',
    year: sameYear ? undefined : 'numeric',
  }).format(toDate(date));
}

/** "October" for a month of this year, "October 2027" for other years. `month` is `YYYY-MM`. */
export function formatMonth(month: string, today: string, locale?: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return dateTimeFormat(locale, {
    timeZone: 'UTC',
    month: 'long',
    year: month.slice(0, 4) === today.slice(0, 4) ? undefined : 'numeric',
  }).format(new Date(Date.UTC(y, m - 1, 15)));
}

// How the user likes dates shown (Settings, PL-025): set from the open workspace's settings
// (WorkspaceTheme) before anything renders, like the locale.
const display = { clock24: false, weekStart: 0 as 0 | 1, dateFormat: null as string | null };

export function setDisplayPreferences(settings: {
  clockFormat?: '12h' | '24h' | undefined;
  weekStart?: 0 | 1 | undefined;
  dateFormat?: string | undefined;
}) {
  display.clock24 = settings.clockFormat === '24h';
  display.weekStart = settings.weekStart ?? 0;
  const pattern = settings.dateFormat;
  display.dateFormat =
    pattern && pattern !== DATE_FORMAT_AUTO && isDatePattern(pattern) ? pattern : null;
}

/** Whether dates follow a pattern the user typed (not the automatic style). */
export const customDateFormat = () => display.dateFormat !== null;

/** Whether times show on a 24-hour clock. */
export const clockIs24 = () => display.clock24;

/** The first day of the week in calendars: 0 Sunday, 1 Monday. */
export const weekStart = () => display.weekStart;

/** Display a 24-hour `HH:mm` on the user's clock: "9:00 AM", or "09:00" on a 24-hour clock. */
export function formatTime(time: string, locale?: string, hour12 = !display.clock24): string {
  const [h, m] = time.split(':').map(Number) as [number, number];
  return dateTimeFormat(locale, {
    timeZone: 'UTC',
    hour: hour12 ? 'numeric' : '2-digit',
    minute: '2-digit',
    hour12,
  }).format(new Date(Date.UTC(2000, 0, 1, h, m)));
}

/** An hour on the time grid's edge: "10 PM", or "22:00" on a 24-hour clock. */
export function formatHour(hour: number, locale?: string): string {
  if (display.clock24) return `${String(hour).padStart(2, '0')}:00`;
  return dateTimeFormat(locale, { timeZone: 'UTC', hour: 'numeric', hour12: true }).format(
    new Date(Date.UTC(2000, 0, 1, hour)),
  );
}

/** A local date or date-time for display: "Today 9:00 AM", "Thu, Oct 22". */
export function formatWhen(value: string, today: string, locale?: string): string {
  const day = formatDay(datePart(value), today, locale);
  const time = timePart(value);
  return time ? `${day} ${formatTime(time, locale)}` : day;
}

/**
 * A time span for display: "Today 9:00 AM - 11:00 AM" on one day, "Today - Thu, Oct 22" all day
 * over several days, "Today 9:00 AM - Thu, Oct 22 5:00 PM" otherwise.
 */
export function formatSpan(start: string, end: string, today: string, locale?: string): string {
  const startText = formatWhen(start, today, locale);
  const endTime = timePart(end);
  if (datePart(start) === datePart(end)) {
    return endTime ? `${startText} - ${formatTime(endTime, locale)}` : startText;
  }
  return `${startText} - ${formatWhen(end, today, locale)}`;
}

/** A size for display: "512 B", "12 KB", "3.4 MB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}
