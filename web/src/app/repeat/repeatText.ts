import { parseRule, type ByDay, type Recurrence } from '../../core/recurrence.ts';
import { formatDay } from '../format.ts';
import { t } from '../i18n/i18n.ts';
import { dateTimeFormat } from '../../core/intl.ts';

const sunday = Date.UTC(2026, 0, 4, 12);

/** A weekday's name: "Friday", or "Fri" short. */
export function weekdayName(day: number, short = false, locale?: string): string {
  return dateTimeFormat(locale, {
    timeZone: 'UTC',
    weekday: short ? 'short' : 'long',
  }).format(new Date(sunday + day * 86_400_000));
}

/** "Oct 24" for a month and day, whatever the year. */
function monthDay(month: number, day: number, locale?: string): string {
  return dateTimeFormat(locale, {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
  }).format(new Date(Date.UTC(2000, month - 1, day, 12)));
}

const ORDINALS = {
  1: 'repeat.first',
  2: 'repeat.second',
  3: 'repeat.third',
  4: 'repeat.fourth',
  5: 'repeat.fifth',
  [-1]: 'repeat.last',
} as const;

/** "the second Tuesday", "the last Friday". */
export function nthWeekday(byDay: ByDay): string {
  const nth = t(ORDINALS[byDay.nth as keyof typeof ORDINALS] ?? 'repeat.first');
  return t('repeat.nthWeekday', { nth, day: weekdayName(byDay.weekday) });
}

const WEEKDAYS = [1, 2, 3, 4, 5];
const isWeekdays = (days: ByDay[] | undefined) =>
  days?.length === 5 &&
  days.every((day) => day.nth === undefined) &&
  WEEKDAYS.every((wanted) => days.some((day) => day.weekday === wanted));

/** How often, without the ending: "Daily", "Every 2 weeks on Mon, Thu", "Monthly on day 15". */
function cadence(rule: Recurrence): string {
  const n = rule.interval;
  switch (rule.freq) {
    case 'DAILY':
      return n === 1 ? t('repeat.daily') : t('repeat.everyDays', { n });
    case 'WEEKLY': {
      if (n === 1 && isWeekdays(rule.byDay)) return t('repeat.weekdays');
      const base = n === 1 ? t('repeat.weekly') : t('repeat.everyWeeks', { n });
      if (!rule.byDay?.length) return base;
      const sorted = [...rule.byDay].sort((a, b) => ((a.weekday + 6) % 7) - ((b.weekday + 6) % 7));
      const short = sorted.length > 1;
      return t('repeat.on', {
        base,
        when: sorted.map((day) => weekdayName(day.weekday, short)).join(', '),
      });
    }
    case 'MONTHLY': {
      const base = n === 1 ? t('repeat.monthly') : t('repeat.everyMonths', { n });
      const day = rule.byMonthDay?.[0];
      if (day === -1) return t('repeat.on', { base, when: t('repeat.lastDay') });
      if (day) return t('repeat.on', { base, when: t('repeat.dayN', { day }) });
      const byDay = rule.byDay?.[0];
      if (byDay?.nth) return t('repeat.on', { base, when: nthWeekday(byDay) });
      return base;
    }
    case 'YEARLY': {
      const base = n === 1 ? t('repeat.yearly') : t('repeat.everyYears', { n });
      const month = rule.byMonth?.[0];
      const day = rule.byMonthDay?.[0];
      return month && day && day > 0 ? t('repeat.on', { base, when: monthDay(month, day) }) : base;
    }
  }
}

/**
 * A repeat rule in words: "Weekdays", "Every 3 days, after it's done", "Monthly on the last
 * Friday, 4 more times", "Weekly on Monday, until Nov 15". Text we cannot read: "Custom".
 */
export function repeatLabel(text: string | null, today: string): string {
  if (!text) return t('repeat.none');
  const rule = parseRule(text);
  if (!rule) return t('repeat.unknown');
  const parts = [cadence(rule)];
  if (rule.fromCompletion) parts.push(t('repeat.afterDone'));
  if (rule.count !== undefined) {
    parts.push(rule.count === 1 ? t('repeat.lastTime') : t('repeat.timesLeft', { n: rule.count }));
  }
  if (rule.until) parts.push(t('repeat.until', { date: formatDay(rule.until, today) }));
  return parts.join(', ');
}
