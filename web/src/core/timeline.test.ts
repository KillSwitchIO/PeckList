import { describe, expect, it } from 'vitest';
import { draggedSchedule, fitRows, ownRows } from './timeline.ts';
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

  it('gives each bar its own row otherwise', () => {
    expect([
      ...ownRows([
        { id: 'x', from: '', to: '' },
        { id: 'y', from: '', to: '' },
      ]).values(),
    ]).toEqual([0, 1]);
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
