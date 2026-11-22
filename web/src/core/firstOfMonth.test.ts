// French writes the first of a month "1er" beside the month's name (PL-148), which Intl doesn't.
import { afterEach, describe, expect, it } from 'vitest';
import { purchasedText } from '../app/support/supporterText.ts';
import { formatDatePattern } from './dateFormat.ts';
import { dateTimeFormat, setIntlLocale } from './intl.ts';

const first = new Date(Date.UTC(2026, 11, 1, 12));
const seventh = new Date(Date.UTC(2026, 11, 7, 12));
const utc = { timeZone: 'UTC' } as const;
afterEach(() => setIntlLocale(undefined));

const say = (locale: string, options: Intl.DateTimeFormatOptions, at = first) =>
  dateTimeFormat(locale, { ...options, ...utc }).format(at);

describe('the first of a month in French', () => {
  it('is "1er" beside the month’s name, in every shape of date', () => {
    expect(say('fr', { day: 'numeric', month: 'short' })).toBe('1er déc.');
    expect(say('fr', { weekday: 'long', day: 'numeric', month: 'long' })).toBe(
      'mardi 1er décembre',
    );
    expect(say('fr', { dateStyle: 'long' })).toBe('1er décembre 2026');
    expect(say('fr-CA', { day: 'numeric', month: 'long' })).toBe('1er décembre');
    const parts = dateTimeFormat('fr', { day: 'numeric', month: 'short', ...utc }).formatToParts(
      first,
    );
    expect(parts.find((part) => part.type === 'day')?.value).toBe('1er');
  });

  it('is "1er" at either end of a run of days', () => {
    const range = dateTimeFormat('fr', { day: 'numeric', month: 'short', ...utc });
    expect(range.formatRange(first, seventh)).toBe('1er–7 déc.');
    expect(range.formatRange(new Date(Date.UTC(2026, 10, 28, 12)), first)).toBe(
      '28 nov. – 1er déc.',
    );
  });

  it('stays a number in numbers, alone, on other days, and in other languages', () => {
    expect(say('fr', { day: '2-digit', month: '2-digit', year: 'numeric' })).toBe('01/12/2026');
    expect(say('fr', { day: 'numeric' })).toBe('1'); // a calendar's grid
    expect(say('fr', { day: 'numeric', month: 'short' }, seventh)).toBe('7 déc.');
    expect(say('en-US', { day: 'numeric', month: 'short' })).toBe('Dec 1');
    expect(say('de', { day: 'numeric', month: 'short' })).toBe('1. Dez.');
  });

  it('follows a typed pattern only where the month has a name', () => {
    expect(formatDatePattern('2026-12-01', 'D MMMM YYYY', 'fr')).toBe('1er décembre 2026');
    expect(formatDatePattern('2026-12-01', 'ddd D MMM', 'fr')).toBe('mar. 1er déc.');
    expect(formatDatePattern('2026-12-01', 'D/M/YYYY', 'fr')).toBe('1/12/2026');
    expect(formatDatePattern('2026-12-01', 'DD MMM', 'fr')).toBe('01 déc.');
    expect(formatDatePattern('2026-12-02', 'D MMMM', 'fr')).toBe('2 décembre');
    expect(formatDatePattern('2026-12-01', 'D MMMM YYYY', 'en-US')).toBe('1 December 2026');
  });

  it('reaches the app’s own dates in the language set', () => {
    setIntlLocale('fr');
    expect(purchasedText({ purchased: '2026-12-01', kind: 'person' })).toBe('1er décembre 2026');
  });
});
