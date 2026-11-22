// Every date in the app is Gregorian, so a calendar with other months is never shown; one with
// Gregorian months keeps its own year number (PL-148: Dev 1, Manager).
import { afterEach, describe, expect, it } from 'vitest';
import { purchasedText } from '../app/support/supporterText.ts';
import { dateTimeFormat, setIntlLocale } from './intl.ts';

const first = new Date(Date.UTC(2026, 11, 1, 12));
const utc = { timeZone: 'UTC' } as const;
/** A year's value read as a number, whatever the digits (۲۰۲۶ in Persian). */
const yearOf = (locale: string) => {
  const parts = dateTimeFormat(locale, { month: 'long', year: 'numeric', ...utc }).formatToParts(
    first,
  );
  const year = parts.find((part) => part.type === 'year')!.value;
  return Number(year.replace(/[۰-۹٠-٩]/g, (digit) => String(digit.charCodeAt(0) % 16)));
};
const calendarOf = (locale: string) =>
  dateTimeFormat(locale, { month: 'long', ...utc }).resolvedOptions().calendar;

afterEach(() => setIntlLocale(undefined));

describe('dates on the Gregorian calendar', () => {
  it('names Persian, Saudi and Hebrew-calendar dates by their Gregorian month and year', () => {
    expect(calendarOf('fa')).toBe('gregory');
    expect(dateTimeFormat('fa', { month: 'long', ...utc }).format(first)).toBe('دسامبر');
    expect(yearOf('fa')).toBe(2026); // never 1405
    expect(calendarOf('ar-SA')).toBe('gregory');
    expect(yearOf('ar-SA')).toBe(2026);
    expect(calendarOf('he-u-ca-hebrew')).toBe('gregory');
    // ISO 8601's months are Gregorian, but ICU names none of them (Dev 1).
    expect(calendarOf('en-u-ca-iso8601')).toBe('gregory');
    expect(
      dateTimeFormat('en-GB-u-ca-iso8601', { day: 'numeric', month: 'short', ...utc }).format(
        first,
      ),
    ).toBe('1 Dec');
  });

  it('keeps a calendar with Gregorian months and its own year (Thai, a Japanese era)', () => {
    expect(calendarOf('th')).toBe('buddhist');
    expect(yearOf('th')).toBe(2569);
    expect(dateTimeFormat('th', { day: 'numeric', month: 'short', ...utc }).format(first)).toBe(
      '1 ธ.ค.',
    );
    expect(calendarOf('ja-JP-u-ca-japanese')).toBe('japanese');
  });

  it('leaves the languages that were Gregorian as they were, French’s "1er" too', () => {
    expect(dateTimeFormat('en-US', { dateStyle: 'medium', ...utc }).format(first)).toBe(
      'Dec 1, 2026',
    );
    expect(dateTimeFormat('fr', { day: 'numeric', month: 'short', ...utc }).format(first)).toBe(
      '1er déc.',
    );
  });

  it('reaches the app’s own dates in the language set', () => {
    setIntlLocale('fa');
    expect(purchasedText({ purchased: '2026-12-01', kind: 'person' })).toContain('دسامبر');
  });
});
