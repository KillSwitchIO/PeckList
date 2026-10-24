import { describe, expect, it } from 'vitest';
import { dayHeading, dayPath } from './dayLabels.ts';

describe('day labels', () => {
  it('heads a day page with the weekday and date, the year only in another year', () => {
    expect(dayHeading('2026-10-26', '2026-10-23')).toBe('Monday, October 26');
    expect(dayHeading('2027-01-04', '2026-10-23')).toBe('Monday, January 4, 2027');
  });

  it('opens today as Today and any other day as its own page', () => {
    expect(dayPath('2026-10-23', '2026-10-23')).toBe('/today');
    expect(dayPath('2026-10-26', '2026-10-23')).toBe('/day/2026-10-26');
  });
});
