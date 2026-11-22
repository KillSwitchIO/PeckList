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

// Runs of days in the language's own order (PL-148), with the same year rules as English: this
// year left off, another year once at the end, a phone's short year within one month, and no year
// across two months on a phone.
describe.each([
  {
    locale: 'de',
    month: '19.-25. Okt.',
    months: '31. Okt. - 2. Nov.',
    newYear: '28. Dez. - 3. Jan. 2027',
    otherYear: '18.-29. Jan. 2027',
    shortYear: '18.-29. Jan. ’27',
    phoneMonths: '28. Dez. - 3. Jan.',
  },
  {
    locale: 'es',
    month: '19-25 oct',
    months: '31 oct - 2 nov',
    newYear: '28 dic - 3 ene 2027',
    otherYear: '18-29 ene 2027',
    shortYear: '18-29 ene ’27',
    phoneMonths: '28 dic - 3 ene',
  },
  {
    locale: 'fr',
    month: '19-25 oct.',
    months: '31 oct. - 2 nov.',
    newYear: '28 déc. - 3 janv. 2027',
    otherYear: '18-29 janv. 2027',
    shortYear: '18-29 janv. ’27',
    phoneMonths: '28 déc. - 3 janv.',
  },
  // A year with a word of its own ("2027 г.", after a narrow no-break space): the word goes when
  // the number does (Dev 1, S1).
  {
    locale: 'ru',
    month: '19-25 окт.',
    months: '31 окт. - 2 нояб.',
    newYear: '28 дек. - 3 янв. 2027\u202fг.',
    otherYear: '18-29 янв. 2027\u202fг.',
    shortYear: '18-29 янв. ’27\u202fг.',
    phoneMonths: '28 дек. - 3 янв.',
  },
  {
    locale: 'uk',
    month: '19-25 жовт.',
    months: '31 жовт. - 2 лист.',
    newYear: '28 груд. - 3 січ. 2027\u202fрр.',
    otherYear: '18-29 січ. 2027\u202fр.',
    shortYear: '18-29 січ. ’27\u202fр.',
    phoneMonths: '28 груд. - 3 січ.',
  },
])(
  'the Days title in $locale',
  ({ locale, month, months, newYear, otherYear, shortYear, phoneMonths }) => {
    it('reads as the language writes a range, with the year as in English', () => {
      expect(calendarTitle('days', '2026-10-19', 7, TODAY, locale)).toBe(month);
      expect(calendarTitle('days', '2026-10-31', 3, TODAY, locale)).toBe(months);
      expect(calendarTitle('days', '2026-12-28', 7, TODAY, locale)).toBe(newYear);
      expect(calendarTitle('days', '2027-01-18', 12, TODAY, locale)).toBe(otherYear);
      expect(calendarTitle('days', '2027-01-18', 12, TODAY, locale, true)).toBe(shortYear);
      expect(calendarTitle('days', '2026-12-28', 7, TODAY, locale, true)).toBe(phoneMonths);
      // Days across a new year, seen from the new one: no year at all.
      expect(calendarTitle('days', '2026-12-28', 7, '2027-01-02', locale)).toBe(phoneMonths);
    });
  },
);

it('writes the months as numbers when a phone’s row is too short for them (German at 360 px)', () => {
  expect(calendarTitle('days', '2026-11-28', 14, TODAY, 'de', true, true)).toBe('28.11. - 11.12.');
  expect(calendarTitle('days', '2026-04-29', 12, TODAY, 'de', true, true)).toBe('29.04. - 10.05.');
  expect(calendarTitle('days', '2026-11-28', 14, TODAY, 'en-US', true, true)).toBe('11/28 - 12/11');

  // Dates with hyphens of their own keep Intl's en dash between them (Dev 1, N1).
  expect(calendarTitle('days', '2027-01-18', 12, TODAY, 'sv', true, true)).toBe('’27-01-18–29');
});
