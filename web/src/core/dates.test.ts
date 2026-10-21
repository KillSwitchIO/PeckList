import { describe, expect, it } from 'vitest';
import {
  addMonths,
  instantOf,
  joinDateTime,
  localDateTimeOf,
  monthGrid,
  monthOf,
  shiftMonths,
  weekday,
} from './dates.ts';

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

describe('instants and wall clocks', () => {
  it('shows an instant in a time zone and converts back', () => {
    expect(localDateTimeOf('2026-10-21T15:30:00.000Z', 'America/Chicago')).toBe('2026-10-21T10:30');
    expect(localDateTimeOf('2026-10-21T15:30:00.000Z', 'UTC')).toBe('2026-10-21T15:30');
    expect(instantOf('2026-10-21', '10:30', 'America/Chicago')).toBe('2026-10-21T15:30:00.000Z');
    // Across a daylight-saving change (CST in December).
    expect(instantOf('2026-12-01', '09:00', 'America/Chicago')).toBe('2026-12-01T15:00:00.000Z');
    expect(instantOf('2026-10-21', '00:00', 'Asia/Tokyo')).toBe('2026-10-20T15:00:00.000Z');
  });
});

describe('shiftMonths', () => {
  it('keeps the day, clamped to the end of shorter months', () => {
    expect(shiftMonths('2026-10-21', 1)).toBe('2026-11-21');
    expect(shiftMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(shiftMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(shiftMonths('2026-12-15', 1)).toBe('2027-01-15');
  });
});
