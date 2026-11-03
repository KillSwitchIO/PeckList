import { beforeEach, describe, expect, it } from 'vitest';
import { loadPrefs, MAX_WEEKS, MIN_WEEKS, savePrefs } from './calendarPrefs.ts';

beforeEach(() => localStorage.clear());

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
