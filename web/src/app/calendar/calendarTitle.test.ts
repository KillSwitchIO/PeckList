import { describe, expect, it } from 'vitest';
import { calendarTitle } from './calendarTitle.ts';

const TODAY = '2026-10-22';

describe('calendar title', () => {
  it('names the month, a day, or a run of days, leaving this year off', () => {
    expect(calendarTitle('month', '2026-10-22', 7, TODAY, 'en-US')).toBe('October');
    expect(calendarTitle('days', '2026-10-22', 1, TODAY, 'en-US')).toBe('Thursday, Oct 22');
    expect(calendarTitle('days', '2026-10-19', 7, TODAY, 'en-US')).toBe('Oct 19 - 25');
    expect(calendarTitle('days', '2026-10-22', 3, TODAY, 'en-US')).toBe('Oct 22 - 24');
    expect(calendarTitle('days', '2026-10-31', 3, TODAY, 'en-US')).toBe('Oct 31 - Nov 2');
  });

  it('shortens only a month in another year on a narrow screen', () => {
    expect(calendarTitle('month', '2027-09-15', 7, TODAY, 'en-US', true)).toBe('Sep 2027');
    expect(calendarTitle('month', '2026-09-15', 7, TODAY, 'en-US', true)).toBe('September');
    expect(calendarTitle('month', '2027-09-15', 7, TODAY, 'en-US')).toBe('September 2027');
  });

  it('names the year in the year view, this one too', () => {
    expect(calendarTitle('year', '2026-10-22', 7, TODAY, 'en-US')).toBe('2026');
    expect(calendarTitle('year', '2027-01-04', 7, TODAY, 'en-US')).toBe('2027');
  });

  it('shows the year for other years', () => {
    expect(calendarTitle('month', '2027-01-04', 7, TODAY, 'en-US')).toBe('January 2027');
    expect(calendarTitle('days', '2027-01-04', 1, TODAY, 'en-US')).toBe('Monday, Jan 4, 2027');
    expect(calendarTitle('days', '2027-01-04', 7, TODAY, 'en-US')).toBe('Jan 4 - 10, 2027');
  });

  it('names a new year once, at the end of the days that cross it', () => {
    expect(calendarTitle('days', '2026-12-28', 7, TODAY, 'en-US')).toBe('Dec 28 - Jan 3, 2027');
    expect(calendarTitle('days', '2026-12-28', 7, '2027-01-02', 'en-US')).toBe('Dec 28 - Jan 3');
  });

  it('shortens one day on a narrow screen: the short weekday, or the year in place of it', () => {
    expect(calendarTitle('days', '2026-10-22', 1, TODAY, 'en-US', true)).toBe('Thu, Oct 22');
    expect(calendarTitle('days', '2027-01-04', 1, TODAY, 'en-US', true)).toBe('Jan 4, 2027');
  });

  it('writes another year short on a narrow screen, for days within one month', () => {
    expect(calendarTitle('days', '2027-01-18', 12, TODAY, 'en-US', true)).toBe('Jan 18 - 29 ’27');
    expect(calendarTitle('days', '2025-03-06', 14, TODAY, 'en-US', true)).toBe('Mar 6 - 19 ’25');
    expect(calendarTitle('days', '2026-10-22', 3, TODAY, 'en-US', true)).toBe('Oct 22 - 24');
    // A computer keeps the whole year.
    expect(calendarTitle('days', '2027-01-18', 12, TODAY, 'en-US')).toBe('Jan 18 - 29, 2027');
  });

  it('keeps both ends of days across two months on a narrow screen, not the year', () => {
    // Even the short year would cut the end date at 360 px (Manager, 2026-11-21).
    expect(calendarTitle('days', '2026-12-28', 7, TODAY, 'en-US', true)).toBe('Dec 28 - Jan 3');
    expect(calendarTitle('days', '2027-01-28', 7, TODAY, 'en-US', true)).toBe('Jan 28 - Feb 3');
    expect(calendarTitle('days', '2026-10-31', 3, TODAY, 'en-US', true)).toBe('Oct 31 - Nov 2');
    expect(calendarTitle('days', '2027-01-28', 7, TODAY, 'en-US')).toBe('Jan 28 - Feb 3, 2027');
  });
});
