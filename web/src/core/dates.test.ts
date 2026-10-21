import { describe, expect, it } from 'vitest';
import { addMonths, joinDateTime, monthGrid, monthOf, weekday } from './dates.ts';

describe('calendar helpers', () => {
  it('shifts months across years and finds weekdays', () => {
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-01');
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-01');
    expect(monthOf('2026-07-21')).toBe('2026-07');
    expect(weekday('2026-07-21')).toBe(2);
  });

  it('builds a 6-week grid starting on the chosen weekday', () => {
    const sunday = monthGrid('2026-07-21');
    expect(sunday).toHaveLength(42);
    expect(sunday[0]).toBe('2026-06-28');
    expect(sunday[3]).toBe('2026-07-01');
    const monday = monthGrid('2026-07-21', 1);
    expect(monday[0]).toBe('2026-06-29');
  });

  it('joins dates and times', () => {
    expect(joinDateTime('2026-07-21', '09:30')).toBe('2026-07-21T09:30');
    expect(joinDateTime('2026-07-21', null)).toBe('2026-07-21');
  });
});
