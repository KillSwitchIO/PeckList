import { describe, expect, it } from 'vitest';
import type { CalendarItem } from './calendar.ts';
import {
  atMinutes,
  daysFrom,
  heatLevel,
  heatScale,
  itemsByDay,
  minutesOf,
  openCountsByDay,
  snap,
  timedBlocks,
  weekStartOf,
} from './calendarLayout.ts';

let next = 0;
function item(fields: Partial<CalendarItem> & { start: string }): CalendarItem {
  next += 1;
  return {
    id: `i${next}`,
    taskId: `t${next}`,
    kind: 'schedule',
    title: `Item ${next}`,
    end: null,
    allDay: fields.start.length === 10,
    color: '#CFE3A3',
    priority: 0,
    done: false,
    movable: true,
    ...fields,
  };
}

describe('calendar layout', () => {
  it('finds week starts, runs of days and minutes', () => {
    // 2026-10-24 is a Saturday.
    expect(weekStartOf('2026-10-24', 0)).toBe('2026-10-18');
    expect(weekStartOf('2026-10-24', 1)).toBe('2026-10-19');
    expect(weekStartOf('2026-10-19', 1)).toBe('2026-10-19');
    expect(daysFrom('2026-10-30', 3)).toEqual(['2026-10-30', '2026-10-31', '2026-11-01']);
    expect(minutesOf('2026-10-24T09:30')).toBe(570);
    expect(minutesOf('2026-10-24')).toBe(0);
    expect(atMinutes('2026-10-24', 570)).toBe('2026-10-24T09:30');
    expect(atMinutes('2026-10-24', 1440)).toBe('2026-10-25T00:00');
    expect(snap(37)).toBe(30);
    expect(snap(38)).toBe(45);
  });

  it('counts open tasks per day: spans on every day, once a task, nothing done', () => {
    const counts = openCountsByDay(
      [
        item({ start: '2026-03-01' }),
        // Its due flag on the same day adds nothing, but on another day it does.
        item({ taskId: 'both', start: '2026-03-01' }),
        item({ taskId: 'both', id: 'due:both', kind: 'due', start: '2026-03-01' }),
        item({ taskId: 'late', start: '2026-03-01' }),
        item({ taskId: 'late', id: 'due:late', kind: 'due', start: '2026-03-02' }),
        item({ start: '2026-03-01', done: true }),
        // A span runs up to the edge of the year and no further.
        item({ start: '2026-12-30', end: '2027-01-02' }),
        // A timed task ending at midnight does not reach into the next day.
        item({ start: '2026-05-01T22:00', end: '2026-05-02T00:00' }),
      ],
      '2026-01-01',
      '2026-12-31',
    );
    expect(Object.fromEntries(counts)).toEqual({
      '2026-03-01': 3,
      '2026-03-02': 1,
      '2026-05-01': 1,
      '2026-12-30': 1,
      '2026-12-31': 1,
    });
  });

  it('shades days against the year: free is level 0, the busiest third level 3', () => {
    const scale = heatScale([0, 1, 1, 2, 3, 5, 8, 40]);
    expect([0, 1, 2, 3, 5, 8, 40].map((count) => heatLevel(count, scale))).toEqual([
      0, 1, 1, 2, 2, 3, 3,
    ]);
    // One huge day does not wash out the others.
    expect(heatLevel(5, heatScale([1, 2, 3, 4, 5, 6, 500]))).toBe(2);
    // A year with one kind of day has no busier ones.
    const even = heatScale([4, 4, 4]);
    expect(heatLevel(4, even)).toBe(1);
    expect(heatLevel(0, heatScale([]))).toBe(0);
  });

  it('lists each day’s items: spans on every day, all day first, then by time, due flags last', () => {
    const span = item({ title: 'Trip', start: '2026-10-23', end: '2026-10-26' });
    const late = item({ title: 'Late', start: '2026-10-24T18:00', end: '2026-10-24T19:00' });
    const early = item({ title: 'Early', start: '2026-10-24T08:00', end: '2026-10-24T09:00' });
    const due = item({ title: 'Due', start: '2026-10-24', kind: 'due' });
    const allDay = item({ title: 'Chores', start: '2026-10-24' });
    const overnight = item({ title: 'Night', start: '2026-10-24T22:00', end: '2026-10-25T02:00' });
    const toMidnight = item({ title: 'Eve', start: '2026-10-24T20:00', end: '2026-10-25T00:00' });
    const byDay = itemsByDay(
      [late, due, early, allDay, span, overnight, toMidnight],
      '2026-10-24',
      '2026-10-26',
    );
    const titles = (day: string) => byDay.get(day)?.map((each) => each.title);
    expect(titles('2026-10-24')).toEqual([
      'Trip',
      'Chores',
      'Early',
      'Late',
      'Eve',
      'Night',
      'Due',
    ]);
    // Past midnight shows the next day too; ending at midnight does not.
    expect(titles('2026-10-25')).toEqual(['Trip', 'Night']);
    expect(titles('2026-10-26')).toEqual(['Trip']);
    // Only the days asked for.
    expect(byDay.has('2026-10-23')).toBe(false);
  });

  it('puts overlapping timed items side by side, in as few columns as they need', () => {
    const a = item({ start: '2026-10-24T09:00', end: '2026-10-24T11:00' });
    const b = item({ start: '2026-10-24T09:30', end: '2026-10-24T10:00' });
    const c = item({ start: '2026-10-24T10:15', end: '2026-10-24T10:45' });
    const d = item({ start: '2026-10-24T13:00', end: '2026-10-24T14:00' });
    const point = item({ start: '2026-10-24T15:00', end: '2026-10-24T15:00' });
    const fromBefore = item({ start: '2026-10-23T23:00', end: '2026-10-24T01:00' });
    const blocks = timedBlocks([d, c, b, a, point, fromBefore], '2026-10-24');
    const of = (target: CalendarItem) => blocks.find((block) => block.item === target)!;
    expect([of(a).column, of(b).column, of(c).column]).toEqual([0, 1, 1]);
    expect([of(a).columns, of(b).columns, of(c).columns]).toEqual([2, 2, 2]);
    expect([of(d).column, of(d).columns]).toEqual([0, 1]);
    // Each run of overlapping items is numbered, so a crowded one can collapse on its own.
    expect(of(a).group).toBe(of(c).group);
    expect(of(d).group).not.toBe(of(a).group);
    // A point in time is drawn tall enough to read; one from the day before starts at midnight.
    expect([of(point).top, of(point).bottom]).toEqual([900, 920]);
    expect([of(fromBefore).top, of(fromBefore).bottom]).toEqual([0, 60]);
  });
});
