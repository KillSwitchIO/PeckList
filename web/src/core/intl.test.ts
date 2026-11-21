import { afterEach, describe, expect, it } from 'vitest';
import { collator, dateTimeFormat, intlLocale, localeDateFormat, setIntlLocale } from './intl.ts';

// Thursday, Nov 26 2026, noon UTC.
const DAY = new Date(Date.UTC(2026, 10, 26, 12));
const weekday = { weekday: 'long', timeZone: 'UTC' } as const;

afterEach(() => setIntlLocale(undefined));

describe('the locale dates and numbers use (PL-148)', () => {
  it('is the browser’s until a language is picked, then that one', () => {
    expect(intlLocale()).toBeUndefined();
    expect(dateTimeFormat(undefined, weekday).format(DAY)).toBe('Thursday'); // jsdom: en-US
    setIntlLocale('de');
    expect(intlLocale()).toBe('de');
    expect(dateTimeFormat(undefined, weekday).format(DAY)).toBe('Donnerstag');
    // A locale given outright still wins.
    expect(dateTimeFormat('fr', weekday).format(DAY)).toBe('jeudi');
  });

  it('a format made at module level follows a later pick', () => {
    const shown = localeDateFormat(weekday);
    expect(shown.format(DAY)).toBe('Thursday');
    setIntlLocale('es');
    expect(shown.format(DAY)).toBe('jueves');
    expect(shown.formatToParts(DAY).map((part) => part.value)).toEqual(['jueves']);
  });

  it('sorts titles by the picked language', () => {
    const names = ['Zebra', 'Öl', 'Ost'];
    const sorted = () => [...names].sort(collator({ sensitivity: 'base' }).compare);
    expect(sorted()).toEqual(['Öl', 'Ost', 'Zebra']);
    setIntlLocale('sv');
    // Swedish puts Ö after Z.
    expect(sorted()).toEqual(['Ost', 'Zebra', 'Öl']);
  });
});
