// How this device likes the calendar (spec: PL-093): the view, how many days, how many weeks a
// month shows, how tall an hour is. Kept per device, like other view choices.

import { MAX_DAYS, MIN_DAYS } from '../../core/calendarLayout.ts';

export type CalendarMode = 'month' | 'days';

export interface CalendarPrefs {
  mode: CalendarMode;
  /** Days side by side in the Days view */
  days: number;
  /** Weeks the month view shows at once */
  weeks: 4 | 5 | 6;
  /** Pixels per hour in the Days view */
  hourHeight: number;
}

export const MIN_HOUR = 24;
export const MAX_HOUR = 160;
const KEY = 'punchlist.calendar';
/** Before PL-093: month, week, threeDays or day. */
const OLD_MODE_KEY = 'punchlist.calendar.mode';
const OLD_DAYS: Record<string, number> = { week: 7, threeDays: 3, day: 1 };

export function defaultPrefs(phone: boolean): CalendarPrefs {
  return { mode: 'month', days: phone ? 3 : 7, weeks: 6, hourHeight: 48 };
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

export function loadPrefs(phone: boolean): CalendarPrefs {
  const base = defaultPrefs(phone);
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<CalendarPrefs>;
      return {
        mode: saved.mode === 'days' ? 'days' : 'month',
        days: clamp(Math.round(Number(saved.days) || base.days), MIN_DAYS, MAX_DAYS),
        weeks: saved.weeks === 4 || saved.weeks === 5 ? saved.weeks : 6,
        hourHeight: clamp(Number(saved.hourHeight) || base.hourHeight, MIN_HOUR, MAX_HOUR),
      };
    }
    const old = localStorage.getItem(OLD_MODE_KEY);
    if (old && old in OLD_DAYS) return { ...base, mode: 'days', days: OLD_DAYS[old]! };
  } catch {
    // Storage unavailable: the defaults.
  }
  return base;
}

export function savePrefs(prefs: CalendarPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // Remembering is a nicety.
  }
}

/** A view the address asks for (`?view=day&date=...`, from the mini calendar and older links). */
export function askedFor(params: URLSearchParams): {
  date: string | null;
  mode: CalendarMode | null;
  days: number | null;
} {
  const date = params.get('date');
  const view = params.get('view') ?? '';
  const days = Number(params.get('days'));
  return {
    date: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
    mode: view === 'month' ? 'month' : view === 'days' || view in OLD_DAYS ? 'days' : null,
    days:
      view in OLD_DAYS
        ? OLD_DAYS[view]!
        : Number.isInteger(days) && days >= MIN_DAYS && days <= MAX_DAYS
          ? days
          : null,
  };
}
