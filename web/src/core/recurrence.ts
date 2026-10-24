// Repeating tasks (spec: PL-060): RFC 5545 RRULE text in `task.recurrence`, worked out on the
// task's local dates, so a 9:00 task stays at 9:00 through clock changes. Covers what the picker
// offers: FREQ (daily, weekly, monthly, yearly), INTERVAL, BYDAY (with an ordinal for months:
// 2TU, -1FR), BYMONTHDAY (negative from the month's end), BYMONTH, COUNT and UNTIL, plus
// X-PL-FROM=COMPLETION for TickTick's "repeat from the completion date".

import { addDays, daysBetween, weekday } from './dates.ts';

export type Frequency = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';

/** A weekday (0 Sunday) and, in a month or year, which one (1 first, -1 last). */
export interface ByDay {
  weekday: number;
  nth?: number;
}

export interface Recurrence {
  freq: Frequency;
  interval: number;
  byDay?: ByDay[];
  byMonthDay?: number[];
  byMonth?: number[];
  /** Occurrences left, this one included */
  count?: number;
  /** Last date it may fall on (YYYY-MM-DD) */
  until?: string;
  /** The next date counts from when it was done, not from its date */
  fromCompletion?: boolean;
}

const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;
const FREQS: readonly Frequency[] = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'];

/** A rule from RRULE text (with or without the "RRULE:" prefix), or null when it is not one we keep. */
export function parseRule(text: string | null | undefined): Recurrence | null {
  if (!text) return null;
  const parts = new Map(
    text
      .replace(/^RRULE:/i, '')
      .split(';')
      .map((part) => part.split('=') as [string, string])
      .filter(([key, value]) => key && value !== undefined)
      .map(([key, value]) => [key.toUpperCase(), value.toUpperCase()]),
  );
  const freq = parts.get('FREQ') as Frequency | undefined;
  if (!freq || !FREQS.includes(freq)) return null;
  const interval = Number(parts.get('INTERVAL') ?? 1);
  if (!Number.isInteger(interval) || interval < 1) return null;
  const rule: Recurrence = { freq, interval };
  const byDay = parts.get('BYDAY');
  if (byDay) {
    const days = byDay.split(',').map((each) => {
      const match = /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/.exec(each);
      if (!match) return null;
      const found: ByDay = { weekday: DAY_CODES.indexOf(match[2] as (typeof DAY_CODES)[number]) };
      if (match[1]) found.nth = Number(match[1]);
      return found;
    });
    if (days.some((each) => each === null)) return null;
    rule.byDay = days as ByDay[];
  }
  const numbers = (key: string, ok: (value: number) => boolean) => {
    const value = parts.get(key);
    if (!value) return undefined;
    const list = value.split(',').map(Number);
    return list.every((each) => Number.isInteger(each) && ok(each)) ? list : null;
  };
  const byMonthDay = numbers('BYMONTHDAY', (day) => day !== 0 && day >= -31 && day <= 31);
  const byMonth = numbers('BYMONTH', (month) => month >= 1 && month <= 12);
  if (byMonthDay === null || byMonth === null) return null;
  if (byMonthDay) rule.byMonthDay = byMonthDay;
  if (byMonth) rule.byMonth = byMonth;
  const count = parts.get('COUNT');
  if (count) {
    const value = Number(count);
    if (!Number.isInteger(value) || value < 1) return null;
    rule.count = value;
  }
  const until = parts.get('UNTIL');
  if (until) {
    const match = /^(\d{4})(\d{2})(\d{2})/.exec(until);
    if (!match) return null;
    rule.until = `${match[1]}-${match[2]}-${match[3]}`;
  }
  if (parts.get('X-PL-FROM') === 'COMPLETION') rule.fromCompletion = true;
  return rule;
}

/** RRULE text for a rule (in a stable order, so the same rule is the same text). */
export function formatRule(rule: Recurrence): string {
  const parts = [`FREQ=${rule.freq}`];
  if (rule.interval !== 1) parts.push(`INTERVAL=${rule.interval}`);
  if (rule.byDay?.length) {
    parts.push(
      `BYDAY=${rule.byDay.map((day) => `${day.nth ?? ''}${DAY_CODES[day.weekday]}`).join(',')}`,
    );
  }
  if (rule.byMonthDay?.length) parts.push(`BYMONTHDAY=${rule.byMonthDay.join(',')}`);
  if (rule.byMonth?.length) parts.push(`BYMONTH=${rule.byMonth.join(',')}`);
  if (rule.count !== undefined) parts.push(`COUNT=${rule.count}`);
  if (rule.until) parts.push(`UNTIL=${rule.until.replace(/-/g, '')}`);
  if (rule.fromCompletion) parts.push('X-PL-FROM=COMPLETION');
  return parts.join(';');
}

const parts = (date: string) => date.split('-').map(Number) as [number, number, number];
const daysInMonth = (year: number, month: number) =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();
const pad = (value: number) => String(value).padStart(2, '0');

/** Which of its weekday a date is in its month: 1 first ... and -1 last, -2 second to last. */
function nthOfMonth(date: string): { first: number; last: number } {
  const [year, month, day] = parts(date);
  return { first: Math.ceil(day / 7), last: -Math.ceil((daysInMonth(year, month) - day + 1) / 7) };
}

/** RFC 5545 weeks start on Monday unless WKST says otherwise. */
const weekOf = (date: string) => addDays(date, -((weekday(date) + 6) % 7));

/** Whether `date` is an occurrence of the series that `start` is one of. */
function matches(rule: Recurrence, start: string, date: string): boolean {
  const [sy, sm, sd] = parts(start);
  const [y, m, d] = parts(date);
  const day = weekday(date);
  const dayFits = (byDay: ByDay[] | undefined) =>
    byDay?.some((each) => {
      if (each.weekday !== day) return false;
      if (each.nth === undefined) return true;
      const { first, last } = nthOfMonth(date);
      return each.nth === first || each.nth === last;
    }) ?? false;
  const monthDayFits = (byMonthDay: number[] | undefined) =>
    byMonthDay?.some((each) => (each > 0 ? each === d : daysInMonth(y, m) + each + 1 === d)) ??
    false;
  switch (rule.freq) {
    case 'DAILY':
      return daysBetween(start, date) % rule.interval === 0 && (!rule.byDay || dayFits(rule.byDay));
    case 'WEEKLY': {
      const weeks = daysBetween(weekOf(start), weekOf(date)) / 7;
      if (weeks % rule.interval !== 0) return false;
      return rule.byDay?.length ? dayFits(rule.byDay) : day === weekday(start);
    }
    case 'MONTHLY': {
      const months = (y - sy) * 12 + (m - sm);
      if (months % rule.interval !== 0) return false;
      if (rule.byMonthDay?.length) return monthDayFits(rule.byMonthDay);
      if (rule.byDay?.length) return dayFits(rule.byDay);
      return d === sd;
    }
    case 'YEARLY': {
      if ((y - sy) % rule.interval !== 0) return false;
      if (!(rule.byMonth ?? [sm]).includes(m)) return false;
      if (rule.byMonthDay?.length) return monthDayFits(rule.byMonthDay);
      if (rule.byDay?.length) return dayFits(rule.byDay);
      return d === sd;
    }
  }
}

/** Years, in days, to look ahead: enough for Feb 29 every four years at any interval. */
const LOOK_AHEAD_DAYS = 366 * 8;

/**
 * The date after `after` the series falls on, counted from `start` (the task's date): its next
 * date, or null when the series is over (UNTIL passed, or nothing within reach).
 */
export function nextOccurrence(rule: Recurrence, start: string, after: string): string | null {
  const limit = LOOK_AHEAD_DAYS * rule.interval;
  let date = addDays(after, 1);
  for (let step = 0; step < limit; step += 1, date = addDays(date, 1)) {
    if (rule.until && date > rule.until) return null;
    if (date >= start && matches(rule, start, date)) return date;
  }
  return null;
}

/** "Every interval units" counted from the day it was done (TickTick's from-completion). */
export function nextFromCompletion(rule: Recurrence, done: string): string {
  const [y, m, d] = parts(done);
  switch (rule.freq) {
    case 'DAILY':
      return addDays(done, rule.interval);
    case 'WEEKLY':
      return addDays(done, rule.interval * 7);
    case 'MONTHLY': {
      const months = m - 1 + rule.interval;
      const year = y + Math.floor(months / 12);
      const month = (months % 12) + 1;
      return `${year}-${pad(month)}-${pad(Math.min(d, daysInMonth(year, month)))}`;
    }
    case 'YEARLY': {
      const year = y + rule.interval;
      return `${year}-${pad(m)}-${pad(Math.min(d, daysInMonth(year, m)))}`;
    }
  }
}

/**
 * Where a repeating task goes next when one occurrence is done: its next date, and the rule to
 * keep (COUNT one less), or null when this was the last.
 */
export function advance(
  rule: Recurrence,
  current: string,
  doneOn: string,
): { date: string; rule: Recurrence } | null {
  if (rule.count !== undefined && rule.count <= 1) return null;
  const date = rule.fromCompletion
    ? nextFromCompletion(rule, doneOn)
    : nextOccurrence(rule, current, current);
  if (!date || (rule.until && date > rule.until)) return null;
  const next = { ...rule };
  if (rule.count !== undefined) next.count = rule.count - 1;
  return { date, rule: next };
}

/** The weekday codes in rule order, for labels. */
export const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;
