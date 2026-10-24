import { describe, expect, it } from 'vitest';
import { calendarTitle } from './calendarTitle.ts';

describe('calendar title', () => {
  it('names the month, the week and the day', () => {
    expect(calendarTitle('month', '2026-10-22', 0, 'en-US')).toBe('October 2026');
    expect(calendarTitle('day', '2026-10-22', 0, 'en-US')).toBe('Thursday, Oct 22');
    expect(calendarTitle('week', '2026-10-22', 1, 'en-US')).toBe('Oct 19 - 25, 2026');
    expect(calendarTitle('week', '2026-10-22', 0, 'en-US')).toBe('Oct 18 - 24, 2026');
    expect(calendarTitle('week', '2026-10-29', 1, 'en-US')).toBe('Oct 26 - Nov 1, 2026');
    expect(calendarTitle('week', '2026-12-31', 1, 'en-US')).toBe('Dec 28, 2026 - Jan 3, 2027');
  });
});
