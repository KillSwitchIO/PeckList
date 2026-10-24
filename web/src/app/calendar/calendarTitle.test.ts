import { describe, expect, it } from 'vitest';
import { calendarTitle } from './calendarTitle.ts';

const TODAY = '2026-10-22';

describe('calendar title', () => {
  it('names the month, the week and the day, leaving this year off', () => {
    expect(calendarTitle('month', '2026-10-22', 0, TODAY, 'en-US')).toBe('October');
    expect(calendarTitle('day', '2026-10-22', 0, TODAY, 'en-US')).toBe('Thursday, Oct 22');
    expect(calendarTitle('week', '2026-10-22', 1, TODAY, 'en-US')).toBe('Oct 19 - 25');
    expect(calendarTitle('week', '2026-10-22', 0, TODAY, 'en-US')).toBe('Oct 18 - 24');
    expect(calendarTitle('week', '2026-10-29', 1, TODAY, 'en-US')).toBe('Oct 26 - Nov 1');
    // Three days start on the day itself.
    expect(calendarTitle('threeDays', '2026-10-22', 1, TODAY, 'en-US')).toBe('Oct 22 - 24');
    expect(calendarTitle('threeDays', '2026-10-31', 0, TODAY, 'en-US')).toBe('Oct 31 - Nov 2');
  });

  it('shows the year for other years', () => {
    expect(calendarTitle('month', '2027-01-04', 0, TODAY, 'en-US')).toBe('January 2027');
    expect(calendarTitle('day', '2027-01-04', 0, TODAY, 'en-US')).toBe('Monday, Jan 4, 2027');
    expect(calendarTitle('week', '2027-01-06', 1, TODAY, 'en-US')).toBe('Jan 4 - 10, 2027');
    expect(calendarTitle('week', '2026-12-31', 1, TODAY, 'en-US')).toBe(
      'Dec 28, 2026 - Jan 3, 2027',
    );
  });
});
