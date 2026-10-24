import { describe, expect, it } from 'vitest';
import { formatDatePattern, isDatePattern } from './dateFormat.ts';

describe('date patterns', () => {
  it('fill in the parts, in either case where that is not ambiguous', () => {
    const show = (pattern: string) => formatDatePattern('2026-03-05', pattern, 'en-US');
    expect(show('YYYY-MM-DD')).toBe('2026-03-05');
    expect(show('YYYYMMdd')).toBe('20260305');
    expect(show('yyyy/M/d')).toBe('2026/3/5');
    expect(show('DD.MM.YY')).toBe('05.03.26');
    expect(show('dddd, MMMM D')).toBe('Thursday, March 5');
    expect(show('ddd D MMM YYYY')).toBe('Thu 5 Mar 2026');
    expect(show('[Week of] MMM D')).toBe('Week of Mar 5');
  });

  it('need at least one part of a date, and a sensible length', () => {
    expect(isDatePattern('YYYYMMDD')).toBe(true);
    expect(isDatePattern('')).toBe(false);
    expect(isDatePattern('[just text]')).toBe(false);
    expect(isDatePattern('---')).toBe(false);
    expect(isDatePattern('YYYY'.repeat(11))).toBe(false);
  });
});
