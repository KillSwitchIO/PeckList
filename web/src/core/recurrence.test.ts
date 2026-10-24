import { describe, expect, it } from 'vitest';
import {
  advance,
  formatRule,
  nextFromCompletion,
  nextOccurrence,
  parseRule,
} from './recurrence.ts';

/** The next `n` dates of a rule from `start`. */
function series(text: string, start: string, n: number): string[] {
  const rule = parseRule(text)!;
  const found: string[] = [];
  let at = start;
  for (let i = 0; i < n; i += 1) {
    const next = nextOccurrence(rule, start, at);
    if (!next) break;
    found.push(next);
    at = next;
  }
  return found;
}

describe('recurrence rules', () => {
  it('read and write RRULE text, refusing what they cannot keep', () => {
    const text =
      'FREQ=MONTHLY;INTERVAL=2;BYDAY=2TU,-1FR;COUNT=5;UNTIL=20271231;X-PL-FROM=COMPLETION';
    const rule = parseRule(`RRULE:${text}`)!;
    expect(rule).toEqual({
      freq: 'MONTHLY',
      interval: 2,
      byDay: [
        { weekday: 2, nth: 2 },
        { weekday: 5, nth: -1 },
      ],
      count: 5,
      until: '2027-12-31',
      fromCompletion: true,
    });
    expect(formatRule(rule)).toBe(text);
    expect(formatRule(parseRule('freq=daily')!)).toBe('FREQ=DAILY');
    for (const bad of [
      '',
      'FREQ=HOURLY',
      'FREQ=DAILY;INTERVAL=0',
      'FREQ=WEEKLY;BYDAY=XX',
      'FREQ=MONTHLY;BYMONTHDAY=0',
    ]) {
      expect(parseRule(bad)).toBeNull();
    }
  });

  it('repeat daily, every few days, and on weekdays', () => {
    expect(series('FREQ=DAILY', '2026-10-30', 3)).toEqual([
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
    ]);
    expect(series('FREQ=DAILY;INTERVAL=3', '2026-10-30', 2)).toEqual(['2026-11-02', '2026-11-05']);
    // Friday to Monday: weekdays only.
    expect(series('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', '2026-10-30', 2)).toEqual([
      '2026-11-02',
      '2026-11-03',
    ]);
  });

  it('repeat weekly on the same day, or on several, every other week', () => {
    expect(series('FREQ=WEEKLY', '2026-10-28', 2)).toEqual(['2026-11-04', '2026-11-11']);
    // Every two weeks on Monday and Thursday, from a Monday.
    expect(series('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH', '2026-10-26', 4)).toEqual([
      '2026-10-29',
      '2026-11-09',
      '2026-11-12',
      '2026-11-23',
    ]);
  });

  it('repeat monthly on a day, skipping months without it, or on the last day', () => {
    expect(series('FREQ=MONTHLY', '2026-01-31', 3)).toEqual([
      '2026-03-31',
      '2026-05-31',
      '2026-07-31',
    ]);
    expect(series('FREQ=MONTHLY;BYMONTHDAY=-1', '2026-01-31', 3)).toEqual([
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
    ]);
    // A leap year's February.
    expect(series('FREQ=MONTHLY;BYMONTHDAY=-1', '2028-01-31', 1)).toEqual(['2028-02-29']);
  });

  it('repeat monthly on the second Tuesday and the last Friday', () => {
    expect(series('FREQ=MONTHLY;BYDAY=2TU', '2026-10-13', 3)).toEqual([
      '2026-11-10',
      '2026-12-08',
      '2027-01-12',
    ]);
    expect(series('FREQ=MONTHLY;BYDAY=-1FR', '2026-10-30', 2)).toEqual([
      '2026-11-27',
      '2026-12-25',
    ]);
  });

  it('repeat yearly, Feb 29 only in leap years', () => {
    expect(series('FREQ=YEARLY', '2026-10-24', 2)).toEqual(['2027-10-24', '2028-10-24']);
    expect(series('FREQ=YEARLY', '2028-02-29', 2)).toEqual(['2032-02-29', '2036-02-29']);
    expect(series('FREQ=YEARLY;INTERVAL=2', '2026-03-01', 1)).toEqual(['2028-03-01']);
  });

  it('end on a date', () => {
    expect(series('FREQ=WEEKLY;UNTIL=20261115', '2026-10-28', 5)).toEqual([
      '2026-11-04',
      '2026-11-11',
    ]);
  });

  it('count from completion: every so often after it was done, month ends kept in bounds', () => {
    const every = (text: string, done: string) => nextFromCompletion(parseRule(text)!, done);
    expect(every('FREQ=DAILY;INTERVAL=3', '2026-10-24')).toBe('2026-10-27');
    expect(every('FREQ=WEEKLY;INTERVAL=2', '2026-10-24')).toBe('2026-11-07');
    expect(every('FREQ=MONTHLY', '2026-01-31')).toBe('2026-02-28');
    expect(every('FREQ=MONTHLY;INTERVAL=13', '2026-12-15')).toBe('2028-01-15');
    expect(every('FREQ=YEARLY', '2028-02-29')).toBe('2029-02-28');
  });

  it('advance after one is done: the next date, one fewer to go, and an end', () => {
    const rule = parseRule('FREQ=DAILY;COUNT=2')!;
    const first = advance(rule, '2026-10-24', '2026-10-24')!;
    expect(first).toEqual({ date: '2026-10-25', rule: { freq: 'DAILY', interval: 1, count: 1 } });
    expect(advance(first.rule, first.date, first.date)).toBeNull();
    // Done late, from completion: counts from the day it was done.
    expect(
      advance(parseRule('FREQ=WEEKLY;X-PL-FROM=COMPLETION')!, '2026-10-01', '2026-10-24')!.date,
    ).toBe('2026-10-31');
    expect(advance(parseRule('FREQ=DAILY;UNTIL=20261024')!, '2026-10-24', '2026-10-24')).toBeNull();
  });
});
