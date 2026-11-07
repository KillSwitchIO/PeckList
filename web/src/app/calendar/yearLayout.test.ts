import { describe, expect, it } from 'vitest';
import {
  goToTop,
  monthAt,
  monthTop,
  stayAt,
  stayTop,
  yearAt,
  yearLayout,
  yearParts,
  yearTop,
} from './yearLayout.ts';

const WIDE = yearLayout(1200, 900, 1926);
const PHONE = yearLayout(380, 630, 1926);

describe('the Year view run of months', () => {
  it('takes its columns from the room it has', () => {
    expect(yearLayout(380, 600, 1926).columns).toBe(2);
    expect(yearLayout(560, 600, 1926).columns).toBe(3);
    expect(yearLayout(840, 600, 1926).columns).toBe(4);
  });

  it('fills a large screen with exactly one year, in three rows', () => {
    expect(WIDE.yearFits).toBe(true);
    expect(WIDE.rowsPerYear).toBe(3);
    expect(WIDE.span).toBe(900);
    expect(WIDE.headingHeight).toBeGreaterThanOrEqual(36);
  });

  it('keeps months a usable size where a year does not fit', () => {
    expect(PHONE.yearFits).toBe(false);
    expect(PHONE.rowHeight).toBe(196);
    expect(yearLayout(1200, 400, 1926).rowHeight).toBe(148);
  });

  it('runs straight from one December into the next January', () => {
    const december = monthTop(PHONE, '2026-12');
    expect(monthTop(PHONE, '2027-01')).toBe(december + PHONE.rowHeight + PHONE.headingHeight);
    expect(yearTop(PHONE, 2027) - yearTop(PHONE, 2026)).toBe(PHONE.span);
  });

  it('goes to a month, or to its year when that is all above it or the year fits', () => {
    expect(goToTop(PHONE, '2026-11')).toBe(monthTop(PHONE, '2026-11'));
    expect(goToTop(PHONE, '2026-02')).toBe(yearTop(PHONE, 2026));
    expect(goToTop(WIDE, '2026-11')).toBe(yearTop(WIDE, 2026));
  });

  it('says a year has begun once its heading is half past the top', () => {
    const start = yearTop(PHONE, 2027);
    expect(yearAt(PHONE, start)).toBe(2027);
    expect(yearAt(PHONE, start - 1)).toBe(2027);
    expect(yearAt(PHONE, start - PHONE.headingHeight / 2 - 1)).toBe(2026);
  });

  it('names the first month of the row at the top', () => {
    expect(monthAt(PHONE, monthTop(PHONE, '2026-11'))).toBe('2026-11');
    expect(monthAt(PHONE, monthTop(PHONE, '2026-12'))).toBe('2026-11');
    expect(monthAt(WIDE, monthTop(WIDE, '2026-06') + 5)).toBe('2026-05');
    expect(monthAt(PHONE, yearTop(PHONE, 2027))).toBe('2027-01');
  });

  it('stays to the pixel wherever it was left, in a heading or between months', () => {
    const top = monthTop(PHONE, '2027-03');
    for (const at of [
      top,
      top + 1,
      top + 73.5,
      top + PHONE.rowHeight - 1,
      yearTop(PHONE, 2027) + 5,
    ]) {
      expect(stayTop(PHONE, stayAt(PHONE, at))).toBeCloseTo(at, 6);
    }
    // Just before a year's heading is half past the top, and just after.
    const heading = yearTop(PHONE, 2027) + PHONE.headingHeight / 2;
    expect(stayTop(PHONE, stayAt(PHONE, heading - 1))).toBeCloseTo(heading - 1, 6);
    expect(stayTop(PHONE, stayAt(PHONE, heading + 1))).toBeCloseTo(heading + 1, 6);
  });

  it('keeps the same month as far in through a new shape, with no jump to its top', () => {
    const left = stayAt(PHONE, monthTop(PHONE, '2027-05') + PHONE.rowHeight / 2);
    const wider = yearLayout(700, 630, 1926);
    expect(wider.columns).toBe(3);
    expect(stayTop(wider, left)).toBe(monthTop(wider, '2027-05') + wider.rowHeight / 2);
    // Only the height changing, as a phone's bars come and go: nothing moves.
    const shorter = yearLayout(380, 560, 1926);
    expect(stayTop(shorter, left)).toBe(stayTop(PHONE, left));
  });

  it('goes where it was sent while it has not been scrolled', () => {
    expect(stayTop(PHONE, { sent: '2026-11' })).toBe(goToTop(PHONE, '2026-11'));
  });

  it('lists only what touches the stretch asked for, across a new year', () => {
    const top = monthTop(PHONE, '2026-11');
    const { rows, headings } = yearParts(PHONE, top, top + PHONE.rowHeight * 2);
    expect(rows.map((row) => row.months)).toEqual([
      ['2026-11', '2026-12'],
      ['2027-01', '2027-02'],
    ]);
    expect(headings).toEqual([{ year: 2027, top: yearTop(PHONE, 2027) }]);
    expect(rows[1]!.top).toBe(monthTop(PHONE, '2027-01'));
  });

  it('stops at the ends of the run rather than naming years outside it', () => {
    expect(yearParts(PHONE, -5000, 100).rows[0]!.months).toEqual(['1926-01', '1926-02']);
    expect(yearTop(PHONE, 1000)).toBe(0);
    const { rows } = yearParts(PHONE, PHONE.total - 10, PHONE.total + 5000);
    expect(rows.at(-1)!.months).toEqual(['2126-11', '2126-12']);
  });
});
