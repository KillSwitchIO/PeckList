import { afterEach, describe, expect, it } from 'vitest';
import { localeUses24h, setIntlLocale, setPhoneClock } from '../core/intl.ts';
import {
  clockIs24,
  formatHour,
  formatTime,
  phoneScreensClock,
  setDisplayPreferences,
} from './format.ts';

afterEach(() => {
  setIntlLocale(undefined);
  setPhoneClock(undefined);
  setDisplayPreferences({});
});

describe('the phone’s own setting and odd tags (Dev 1, S2 and N1)', () => {
  it('a tag the schema allows but Intl rejects reads 12-hour instead of throwing', () => {
    expect(() => localeUses24h('en-12')).not.toThrow();
    expect(localeUses24h('en-12')).toBe(false);
  });

  it('on a phone, Automatic is the phone’s own setting, ahead of the language (Manager, rc.2)', () => {
    setPhoneClock(true); // an en-US phone set to 24-hour
    expect(clockIs24()).toBe(true);
    expect(phoneScreensClock()).toBeNull(); // the shell reads the phone's setting live
    setIntlLocale('en');
    expect(clockIs24()).toBe(true);
    expect(phoneScreensClock()).toBeNull();
    setPhoneClock(false); // a 12-hour phone in German
    setIntlLocale('de');
    expect(clockIs24()).toBe(false);
    // A clock picked in the app wins over both.
    setDisplayPreferences({ clockFormat: '24h' });
    expect(clockIs24()).toBe(true);
    expect(phoneScreensClock()).toBe(true);
    setDisplayPreferences({ clockFormat: '12h' });
    setPhoneClock(true);
    expect(clockIs24()).toBe(false);
    expect(phoneScreensClock()).toBe(false);
  });
});

describe('the clock follows the language unless one is picked (schema 22)', () => {
  it('knows which locales keep a 24-hour clock', () => {
    expect(localeUses24h()).toBe(false); // jsdom: en-US
    expect(localeUses24h('en')).toBe(false);
    expect(localeUses24h('en-US')).toBe(false);
    for (const locale of ['de', 'es', 'fr', 'en-GB']) expect(localeUses24h(locale)).toBe(true);
    setIntlLocale('fr');
    expect(localeUses24h()).toBe(true);
  });

  it('an automatic clock, absent or "auto", is the language’s own', () => {
    for (const clockFormat of [undefined, 'auto'] as const) {
      setDisplayPreferences({ clockFormat });
      setIntlLocale(undefined);
      expect(clockIs24()).toBe(false);
      expect(formatTime('15:00')).toBe('3:00 PM');
      setIntlLocale('de');
      expect(clockIs24()).toBe(true);
      expect(formatTime('15:00')).toBe('15:00');
      expect(formatHour(9)).toBe('09:00');
      setIntlLocale('en');
      expect(formatTime('15:00')).toBe('3:00 PM');
    }
  });

  it('a picked clock wins over the language', () => {
    setDisplayPreferences({ clockFormat: '12h' });
    setIntlLocale('de');
    expect(clockIs24()).toBe(false);
    expect(formatTime('15:00')).toMatch(/^3:00\s?PM$/);
    setDisplayPreferences({ clockFormat: '24h' });
    setIntlLocale('en');
    expect(clockIs24()).toBe(true);
    expect(formatTime('15:00')).toBe('15:00');
  });
});
