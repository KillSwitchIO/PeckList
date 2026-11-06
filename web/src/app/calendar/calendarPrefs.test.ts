import { beforeEach, describe, expect, it } from 'vitest';
import { askedFor, loadPrefs, MAX_WEEKS, MIN_WEEKS, savePrefs } from './calendarPrefs.ts';

beforeEach(() => localStorage.clear());

describe('calendar mode (spec: PL-093)', () => {
  it('remembers Year on this device, and reads an unknown mode as Month', () => {
    savePrefs({ ...loadPrefs(false), mode: 'year' });
    expect(loadPrefs(false).mode).toBe('year');
    localStorage.setItem('pecklist.calendar', JSON.stringify({ mode: 'agenda' }));
    expect(loadPrefs(false).mode).toBe('month');
  });

  it('opens Year when the address asks for it', () => {
    expect(askedFor(new URLSearchParams('view=year&date=2027-03-01'))).toMatchObject({
      mode: 'year',
      date: '2027-03-01',
    });
  });
});

describe('calendar weeks (R-FB-102)', () => {
  it('shows four weeks on first open, then whatever was picked last', () => {
    expect(loadPrefs(false).weeks).toBe(4);
    savePrefs({ ...loadPrefs(false), weeks: 9 });
    expect(loadPrefs(false).weeks).toBe(9);
  });

  it('keeps a stored count in range', () => {
    localStorage.setItem('pecklist.calendar', JSON.stringify({ weeks: 99 }));
    expect(loadPrefs(true).weeks).toBe(MAX_WEEKS);
    localStorage.setItem('pecklist.calendar', JSON.stringify({ weeks: -3 }));
    expect(loadPrefs(true).weeks).toBe(MIN_WEEKS);
  });
});
