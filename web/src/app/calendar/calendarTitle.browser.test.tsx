// The calendar's Days title on a phone, with real layout (PL-093): the longest titles fit whole at
// 360 and 375 px wide, the buttons beside the title stay put whatever its length, and each is
// still a 24 px target (WCAG 2.2's least; QA found Today's circle at 18).
import { cleanup, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderApp } from '../../test/renderApp.tsx';

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

async function titleAt(date: string, days: number) {
  await renderApp(`/calendar?date=${date}&view=days&days=${days}`);
  const button = await screen.findByRole('button', { name: /: pick a date$/ });
  const text = button.querySelector('span')!;
  const row = button.closest('h2')!.parentElement!;
  const next = screen.getByRole('button', { name: 'Next' }).getBoundingClientRect();
  const found = {
    text: text.textContent ?? '',
    whole: text.scrollWidth <= text.clientWidth,
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
      const found = await titleAt(date, days);
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
