// Dates other apps export as words (Todoist's "every monday at 9am", "Nov 4 2026"), read the way
// quick add reads them (spec: PL-022, PL-063), and ours written back as words those apps read.

import type { DateParser } from '../../ports/dateParser.ts';
import { addDays, datePart, localDayOf, timePart, wallClock } from '../dates.ts';
import { parseQuickAdd } from '../quickAdd.ts';
import { formatRule, nextOccurrence, parseRule, type Recurrence } from '../recurrence.ts';
import type { Schedule, WorkspaceFile } from '../types.ts';

export interface ReadDate {
  schedule: Schedule | null;
  recurrence: string | null;
  /**
   * A repeat whose text names no date its series can be counted from (every 2 days, every 6
   * months, every! 2 weeks, every 2 weeks tue): it starts on the reference day, a guess.
   */
  guessed?: boolean;
}

/** Reads date text, or null when it holds no date or repeat. */
export type DateReader = (text: string) => ReadDate | null;

// A time of day with no day: "at 5:00 pm", "17:00", "at noon", "in the evening", "tonight".
const TIME_ONLY =
  /^(?:(?:at\s+)?(?:\d{1,2}(?::\d{2})?\s*(?:[ap]\.?m\.?)?|noon|midnight)|(?:in\s+the\s+)?(?:morning|afternoon|evening)|tonight)$/i;
const ISO = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?)?$/;

/** A reader in `timeZone`, relative to `reference` (for "tomorrow" or a bare weekday). */
export function dateReader(options: {
  workspace: WorkspaceFile;
  parser: DateParser;
  reference: Date;
  timeZone: string;
}): DateReader {
  const reference = wallClock(options.timeZone, options.reference);
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
    // Todoist's "every!" counts from when it was done; "starting <date>" is a repeat's first day,
    // "until <date>" or "ending <date>" its last.
    const fromCompletion = /\bevery!/i.test(clean);
    const words = clean.replace(/\bevery!/gi, 'every');
    const [repeatText, untilText] = /^every\b/i.test(words)
      ? words.split(/\s+(?:until|ending)\s+/i)
      : [words];
    const [rest, startingText] = repeatText!.split(/\s+starting\s+/i);
    const monthly = monthlyRepeat(rest!, options);
    const quick = monthly
      ? null
      : parseQuickAdd(rest!, {
          workspace: options.workspace,
          parser: options.parser,
          reference,
        });
    const parsed = monthly ?? quick!;
    let at = parsed.schedule ?? (parsed.due ? { start: parsed.due, end: null } : null);
    const starting = startingText
      ? options.parser.find(startingText, reference)[0]?.start
      : undefined;
    if (starting) at = { start: { date: starting.date, time: at?.start.time ?? null }, end: null };
    if (!at && !parsed.recurrence) return null;
    let recurrence = parsed.recurrence;
    const until = untilText ? options.parser.find(untilText, reference)[0]?.start : null;
    if (recurrence && (fromCompletion || until)) {
      const rule = parseRule(recurrence);
      if (rule) {
        recurrence = formatRule({
          ...rule,
          ...(fromCompletion ? { fromCompletion: true } : {}),
          ...(until ? { until: until.date } : {}),
        });
      }
    }
    // A day in the text ("at 5:00 pm" alone is a time, not a day), or a rule whose days fix
    // it (every tue, every day, every 15th).
    const dated =
      Boolean(starting) ||
      Boolean(
        quick?.tokens.some(
          (token) =>
            (token.kind === 'date' || token.kind === 'due') && !TIME_ONLY.test(token.text.trim()),
        ),
      );
    const rule = recurrence ? parseRule(recurrence) : null;
    const guessed = rule !== null && !dated && !countsFromItsDays(rule);
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
      ...(guessed ? { guessed } : {}),
    };
  };
}

/**
 * Whether any day the rule falls on is a right start: every day, every tuesday, every weekday,
 * every 15th, every last friday. Not with an interval (which of them is a guess), from completion,
 * or with no day of its own (every 6 months, every year).
 */
function countsFromItsDays(rule: Recurrence): boolean {
  if (rule.fromCompletion || rule.interval !== 1) return false;
  return rule.freq === 'DAILY' || Boolean(rule.byDay?.length || rule.byMonthDay?.length);
}

const ORDINALS: Record<string, number> = {
  first: 1,
  '1st': 1,
  second: 2,
  '2nd': 2,
  third: 3,
  '3rd': 3,
  fourth: 4,
  '4th': 4,
  fifth: 5,
  '5th': 5,
  last: -1,
};
const MONTH_DAY = new RegExp(
  String.raw`^every\s+(?:(\d{1,2})\s+months?\s+on\s+the\s+|month\s+on\s+the\s+)?` +
    String.raw`(last|\d{1,2}(?:st|nd|rd|th))(?:\s+day)?(?:\s+of\s+(?:the\s+|each\s+)?month)?(?=$|\s)(.*)$`,
  'i',
);
const NTH_WEEKDAY =
  /^every\s+(first|second|third|fourth|fifth|last|1st|2nd|3rd|4th|5th)\s+(sun|mon|tue|wed|thu|fri|sat)[a-z]*(?:\s+of\s+(?:the\s+|each\s+)?month)?(?=$|\s)(.*)$/i;
const SHORT_DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/**
 * The monthly repeats quick add does not read, as Todoist writes them: "every last day", "every
 * month on the last day", "every 15th", "every 3 months on the 1st", "every last friday", "every
 * 2nd tuesday", each perhaps "at 9am". It starts on the first date on or after the reference.
 */
function monthlyRepeat(
  text: string,
  options: { parser: DateParser; reference: Date; timeZone: string },
): Pick<ReturnType<typeof parseQuickAdd>, 'schedule' | 'due' | 'recurrence'> | null {
  let rule: Recurrence | null = null;
  let tail = '';
  // "every last friday" before "every last day".
  const nth = NTH_WEEKDAY.exec(text.trim());
  const day = nth ? null : MONTH_DAY.exec(text.trim());
  if (day) {
    const which = day[2]!.toLowerCase();
    const date = which === 'last' ? -1 : parseInt(which, 10);
    if (date === 0 || date > 31) return null;
    rule = { freq: 'MONTHLY', interval: Number(day[1] ?? 1) || 1, byMonthDay: [date] };
    tail = day[3] ?? '';
  } else if (nth) {
    const weekday = SHORT_DAYS.indexOf(nth[2]!.toLowerCase());
    rule = {
      freq: 'MONTHLY',
      interval: 1,
      byDay: [{ weekday, nth: ORDINALS[nth[1]!.toLowerCase()]! }],
    };
    tail = nth[3] ?? '';
  }
  if (!rule) return null;
  // Anything after it must be a time ("at 9am"), or it is some other kind of date.
  const time = tail.trim()
    ? options.parser.find(tail, wallClock(options.timeZone, options.reference))[0]
    : undefined;
  if (tail.trim() && !time?.start.time) return null;
  const today = localDayOf(options.reference.toISOString(), options.timeZone);
  const first = nextOccurrence(rule, today, addDays(today, -1)) ?? today;
  return {
    schedule: { start: { date: first, time: time?.start.time ?? null }, end: null },
    due: null,
    recurrence: formatRule(rule),
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
