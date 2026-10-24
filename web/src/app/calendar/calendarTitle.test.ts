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

  it('shows the year for other years', () => {
    expect(calendarTitle('month', '2027-01-04', 7, TODAY, 'en-US')).toBe('January 2027');
    expect(calendarTitle('days', '2027-01-04', 1, TODAY, 'en-US')).toBe('Monday, Jan 4, 2027');
    expect(calendarTitle('days', '2027-01-04', 7, TODAY, 'en-US')).toBe('Jan 4 - 10, 2027');
    expect(calendarTitle('days', '2026-12-28', 7, TODAY, 'en-US')).toBe(
      'Dec 28, 2026 - Jan 3, 2027',
    );
  });
});
