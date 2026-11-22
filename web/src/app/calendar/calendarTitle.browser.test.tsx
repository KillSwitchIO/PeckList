// The calendar's Days title on a phone, with real layout (PL-093): the longest titles fit whole at
// 360 and 375 px wide, the buttons beside the title stay put whatever its length, and each is
// still a 24 px target (WCAG 2.2's least; QA found Today's circle at 18). In German, Spanish and
// French too (PL-148): the titles are Intl's ranges there, and the buttons' words differ.
import { act, cleanup, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { updateSettings } from '../../core/settings.ts';
import { renderApp } from '../../test/renderApp.tsx';
import { calendarTitle } from './calendarTitle.ts';

// The browsers open at 375 px (vitest.browser.config.ts). A narrower phone is the page at that
// width: both are below the sm breakpoint, so only the room changes. (vitest/browser's
// page.viewport would do it too, but its types clash with jest-dom's in the jsdom tests' check.)
beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  document.body.style.width = '';
});

// The widest two-month titles, a month boundary in a short run, and one day, this year; then the
// widest in another year: within one month a phone writes the year short (Ben, 2026-11-21), and
// across two months it leaves the year off, as main did.
const YEAR = new Date().getFullYear();
const NEXT = YEAR + 1;
const SHORT = String(NEXT).slice(2);
const DAYS: [string, number, RegExp][] = [
  [`${YEAR}-04-29`, 12, /^Apr 29 - May 10$/],
  [`${YEAR}-11-28`, 14, /^Nov 28 - Dec 11$/],
  [`${YEAR}-10-31`, 3, /^Oct 31 - Nov 2$/],
  [`${YEAR}-05-20`, 1, /^\w{3}, May 20$/],
  [`${NEXT}-05-24`, 3, new RegExp(`^May 24 - 26 ’${SHORT}$`)],
  [`${NEXT}-01-18`, 12, new RegExp(`^Jan 18 - 29 ’${SHORT}$`)],
  [`${NEXT}-04-29`, 12, /^Apr 29 - May 10$/],
  [`${NEXT}-11-28`, 14, /^Nov 28 - Dec 11$/],
];

/** The words the row's buttons carry in each language (the app's catalogs). */
const LANGUAGES = [
  { language: 'en', pick: /: pick a date$/, next: 'Next', mayCompact: [] },
  {
    language: 'de',
    pick: /: Datum wählen$/,
    next: 'Weiter',
    mayCompact: ['29. Apr. - 10. Mai', '28. Nov. - 11. Dez.'],
  },
  { language: 'es', pick: /: elige una fecha$/, next: 'Siguiente', mayCompact: [] },
  // French puts a narrow no-break space before the colon.
  { language: 'fr', pick: /\s:\schoisir une date$/, next: 'Suivant', mayCompact: [] },
] as const satisfies readonly {
  language: string;
  pick: RegExp;
  next: string;
  mayCompact: readonly string[];
}[];

async function titleAt(date: string, days: number, language: (typeof LANGUAGES)[number]) {
  // The app opens its own store (opening it first fails in a real browser); the language is then
  // picked as Settings would.
  const { store } = await renderApp(`/calendar?date=${date}&view=days&days=${days}`);
  if (language.language !== 'en') {
    act(() =>
      store.getState().apply((ctx, ws) => updateSettings(ctx, ws, { language: language.language })),
    );
  }
  // Found by its own language's words: the catalog is in.
  const button = await screen.findByRole('button', { name: language.pick }, { timeout: 10_000 });
  const text = button.querySelector('span')!;
  const row = button.closest('h2')!.parentElement!;
  const next = screen.getByRole('button', { name: language.next }).getBoundingClientRect();
  const found = {
    text: text.textContent ?? '',
    whole: text.scrollWidth <= text.clientWidth,
    over: text.scrollWidth - text.clientWidth,
    row: row.clientWidth,
    placed: `${next.left},${next.top}`,
    sideways: document.body.scrollWidth > document.body.clientWidth,
    small: [...row.querySelectorAll('button')]
      .filter((button) => {
        const box = button.getBoundingClientRect();
        return box.width < 24 || box.height < 24;
      })
      .map((button) => button.getAttribute('aria-label') ?? button.textContent),
  };
  cleanup();
  return found;
}

describe.each([360, 375])('the Days title at %i px', (width) => {
  it('fits whole, and the buttons beside it stay put', async () => {
    document.body.style.width = `${width}px`;
    const places = new Set<string>();
    for (const [date, days, title] of DAYS) {
      const found = await titleAt(date, days, LANGUAGES[0]);
      // The page's padding is 16 px a side on a phone.
      expect(found.row).toBe(width - 32);
      expect(found.text).toMatch(title);
      expect(found.whole, `"${found.text}" is cut at ${width} px`).toBe(true);
      expect(found.sideways).toBe(false);
      expect(found.small).toEqual([]);
      places.add(found.placed);
    }
    expect(places.size).toBe(1);
  });
});

describe.each(LANGUAGES.slice(1))('the Days title in $language at 360 px', (language) => {
  it('fits whole, and the buttons beside it stay put', async () => {
    document.body.style.width = '360px';
    const today = new Date().toISOString().slice(0, 10);
    const places = new Set<string>();
    const compacted: string[] = [];
    for (const [date, days] of DAYS) {
      const found = await titleAt(date, days, language);
      // The text itself is pinned in calendarTitle.test.ts; here, that it is the phone's (or its
      // numbers, when the short months don't fit) and fits whole.
      const whole = calendarTitle('days', date, days, today, language.language, true);
      const numbers = calendarTitle('days', date, days, today, language.language, true, true);
      expect([whole, numbers]).toContain(found.text);
      if (found.text !== whole) compacted.push(whole);
      expect(found.whole, `"${found.text}" is cut at 360 px by ${found.over} px`).toBe(true);
      expect(found.sideways).toBe(false);
      expect(found.small).toEqual([]);
      places.add(found.placed);
    }
    expect(places.size).toBe(1);
    // Numbers only where the short months are too long: German's two widest at most (the
    // browsers' fonts differ by a pixel or two), nothing in Spanish or French.
    expect(
      compacted.filter((title) => !(language.mayCompact as readonly string[]).includes(title)),
    ).toEqual([]);
  });
});
