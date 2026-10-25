// Dates other apps export as words (Todoist's "every monday at 9am", "Nov 4 2026"), read the way
// quick add reads them (spec: PL-022, PL-063), and ours written back as words those apps read.

import type { DateParser } from '../../ports/dateParser.ts';
import { datePart, timePart } from '../dates.ts';
import { parseQuickAdd } from '../quickAdd.ts';
import { formatRule, parseRule, type Recurrence } from '../recurrence.ts';
import type { Schedule, WorkspaceFile } from '../types.ts';

export interface ReadDate {
  schedule: Schedule | null;
  recurrence: string | null;
}

/** Reads date text, or null when it holds no date or repeat. */
export type DateReader = (text: string) => ReadDate | null;

const ISO = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?)?$/;

/** A reader in `timeZone`, relative to `reference` (for "tomorrow" or a bare weekday). */
export function dateReader(options: {
  workspace: WorkspaceFile;
  parser: DateParser;
  reference: Date;
  timeZone: string;
}): DateReader {
  return (text) => {
    const clean = text.trim();
    if (!clean) return null;
    const iso = ISO.exec(clean);
    if (iso) {
      const [, date, time] = iso;
      return {
        schedule: {
          start: time ? `${date}T${time}` : date!,
          end: null,
          allDay: !time,
          timeZone: options.timeZone,
        },
        recurrence: null,
      };
    }
    // Todoist's "every!" counts from when it was done; "starting <date>" is a repeat's first day.
    const fromCompletion = /\bevery!/i.test(clean);
    const [rest, startingText] = clean.replace(/\bevery!/gi, 'every').split(/\s+starting\s+/i);
    const parsed = parseQuickAdd(rest!, {
      workspace: options.workspace,
      parser: options.parser,
      reference: options.reference,
    });
    let at = parsed.schedule ?? (parsed.due ? { start: parsed.due, end: null } : null);
    const starting = startingText
      ? options.parser.find(startingText, options.reference)[0]?.start
      : undefined;
    if (starting) at = { start: { date: starting.date, time: at?.start.time ?? null }, end: null };
    if (!at && !parsed.recurrence) return null;
    let recurrence = parsed.recurrence;
    if (recurrence && fromCompletion) {
      const rule = parseRule(recurrence);
      if (rule) recurrence = formatRule({ ...rule, fromCompletion: true });
    }
    const value = (moment: { date: string; time: string | null }) =>
      moment.time ? `${moment.date}T${moment.time}` : moment.date;
    return {
      schedule: at
        ? {
            start: value(at.start),
            end: at.end ? value(at.end) : null,
            allDay: at.start.time === null,
            timeZone: options.timeZone,
          }
        : null,
      recurrence,
    };
  };
}

const DAY_WORDS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const UNITS = { DAILY: 'day', WEEKLY: 'week', MONTHLY: 'month', YEARLY: 'year' } as const;
const ordinal = (n: number) =>
  `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;

/** A rule as English an app like Todoist reads: "every 2 weeks", "every monday, friday". */
export function ruleWords(rule: Recurrence): string {
  const every = rule.fromCompletion ? 'every!' : 'every';
  if (rule.freq === 'WEEKLY' && rule.byDay?.length && rule.byDay.every((day) => !day.nth)) {
    const days = rule.byDay.map((day) => DAY_WORDS[day.weekday]!).join(', ');
    return rule.interval === 2
      ? `${every} other ${days}`
      : rule.interval > 1
        ? `${every} ${rule.interval} weeks on ${days}`
        : `${every} ${days}`;
  }
  if (rule.freq === 'MONTHLY' && rule.byMonthDay?.length === 1 && rule.interval === 1) {
    const day = rule.byMonthDay[0]!;
    return day === -1 ? `${every} last day` : `${every} ${ordinal(day)}`;
  }
  const unit = UNITS[rule.freq];
  return rule.interval > 1 ? `${every} ${rule.interval} ${unit}s` : `${every} ${unit}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-11-04" as "Nov 4 2026". */
export function dateWords(date: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return `${MONTHS[m - 1]} ${d} ${y}`;
}

/** A schedule (and repeat) as words: "Nov 4 2026", "Nov 4 2026 at 14:30", "every monday at 14:30". */
export function scheduleWords(schedule: Schedule | null, recurrence: string | null): string {
  const rule = recurrence ? parseRule(recurrence) : null;
  const time = schedule && !schedule.allDay ? timePart(schedule.start) : null;
  if (rule) {
    const starting = schedule ? ` starting ${dateWords(datePart(schedule.start))}` : '';
    return `${ruleWords(rule)}${time ? ` at ${time}` : ''}${starting}`;
  }
  if (!schedule) return '';
  const day = dateWords(datePart(schedule.start));
  return time ? `${day} at ${time}` : day;
}
