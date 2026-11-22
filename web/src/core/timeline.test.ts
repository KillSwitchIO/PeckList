import { describe, expect, it } from 'vitest';
import { barBox, draggedSchedule, fitRows, linkPath, ownRows } from './timeline.ts';
import type { Schedule } from './types.ts';

const day = (start: string, end: string | null = null): Schedule => ({
  start,
  end,
  allDay: true,
  timeZone: 'UTC',
});

describe('timeline rows', () => {
  it('fits bars that do not overlap onto one row', () => {
    const rows = fitRows([
      { id: 'a', from: '2026-10-01', to: '2026-10-03' },
      { id: 'b', from: '2026-10-02', to: '2026-10-02' },
      { id: 'c', from: '2026-10-04', to: '2026-10-05' },
      { id: 'd', from: '2026-10-03', to: '2026-10-04' },
    ]);
    expect(Object.fromEntries(rows)).toEqual({ a: 0, b: 1, c: 0, d: 1 });
  });

  it('gives each bar its own row otherwise, due first at the top', () => {
    const rows = ownRows([
      { id: 'late', from: '2026-10-01', to: '2026-10-20' },
      { id: 'soon', from: '2026-10-05', to: '2026-10-06' },
      { id: 'sameEndEarlierStart', from: '2026-10-02', to: '2026-10-06' },
    ]);
    expect(Object.fromEntries(rows)).toEqual({ sameEndEarlierStart: 0, soon: 1, late: 2 });
  });
});

describe('dragging a bar', () => {
  it('moves the whole span, keeping times', () => {
    const timed: Schedule = {
      start: '2026-10-01T09:00',
      end: '2026-10-02T17:00',
      allDay: false,
      timeZone: 'UTC',
    };
    expect(draggedSchedule(timed, 'move', 3)).toMatchObject({
      start: '2026-10-04T09:00',
      end: '2026-10-05T17:00',
    });
  });

  it('stretches an end, and a one-day task becomes a span', () => {
    expect(draggedSchedule(day('2026-10-01'), 'end', 2)).toMatchObject({
      start: '2026-10-01',
      end: '2026-10-03',
    });
    expect(draggedSchedule(day('2026-10-01', '2026-10-03'), 'start', 1)).toMatchObject({
      start: '2026-10-02',
      end: '2026-10-03',
    });
  });

  it('never ends before it starts; back to one day it has no end', () => {
    expect(draggedSchedule(day('2026-10-01', '2026-10-03'), 'end', -5)).toMatchObject({
      start: '2026-10-01',
      end: null,
    });
    expect(draggedSchedule(day('2026-10-01', '2026-10-03'), 'start', 9)).toMatchObject({
      start: '2026-10-03',
      end: null,
    });
  });
});

describe('blocked-by arrows (PL-055)', () => {
  const geometry = {
    origin: '2026-11-01',
    day: 40,
    row: 34,
    header: 44,
    inset: 4,
    side: 2,
  };

  it('places a bar where the timeline draws it', () => {
    expect(barBox({ id: 'A', from: '2026-11-03', to: '2026-11-04' }, 2, geometry)).toEqual({
      left: 82,
      right: 158,
      y: 44 + 4 + 68 + 13,
    });
  });

  it('runs out of the blocker’s end and into the waiting bar’s start when there is room', () => {
    const from = { left: 2, right: 78, y: 61 };
    const to = { left: 162, right: 198, y: 95 };
    expect(linkPath(from, to, 34)).toBe('M 78 61 H 154 V 95 H 162');
  });

  it('with no room, goes round so it never crosses the bars it joins', () => {
    // The waiting bar starts under the blocker (a date conflict): out, down half a row, back past
    // its start, down, in.
    const from = { left: 2, right: 118, y: 61 };
    const to = { left: 42, right: 158, y: 95 };
    expect(linkPath(from, to, 34)).toBe('M 118 61 H 126 V 78 H 34 V 95 H 42');
    // Upwards too.
    expect(linkPath({ ...from, y: 95 }, { ...to, y: 61 }, 34)).toBe(
      'M 118 95 H 126 V 78 H 34 V 61 H 42',
    );
    // On one row (bars fitted together), the waiting one first: under the row and back up.
    expect(linkPath({ left: 162, right: 198, y: 61 }, { left: 2, right: 78, y: 61 }, 34)).toBe(
      'M 198 61 H 206 V 78 H -6 V 61 H 2',
    );
  });
});
