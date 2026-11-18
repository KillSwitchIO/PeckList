import { describe, expect, it } from 'vitest';
import { sampleTask, testContext } from '../test/fixtures.ts';
import { createWorkspace } from './workspace.ts';
import {
  countsAsDone,
  doneByDay,
  doneTotals,
  HEAT_MAX_WEEKS,
  HEAT_MIN_WEEKS,
  doneScale,
  heatColumns,
  heatWeeks,
} from './completions.ts';
import { PURGED_AT } from './trash.ts';
import type { Task } from './types.ts';

const ctx = testContext();

function done(at: string, more: Partial<Task> = {}): Task {
  return {
    ...sampleTask(ctx, 'inbox', 'A task'),
    status: 'done',
    completedAt: at,
    completedBy: 'u-sam',
    ...more,
  };
}

describe('countsAsDone', () => {
  it('counts done tasks, also in the Trash, but not won’t do, subtasks or erased ones', () => {
    expect(countsAsDone(done('2026-11-16T10:00:00Z'))).toBe(true);
    expect(countsAsDone(done('2026-11-16T10:00:00Z', { deletedAt: '2026-11-17T00:00:00Z' }))).toBe(
      true,
    );
    expect(countsAsDone(done('2026-11-16T10:00:00Z', { status: 'wontdo' }))).toBe(false);
    expect(countsAsDone(done('2026-11-16T10:00:00Z', { parentId: 'parent' }))).toBe(false);
    expect(countsAsDone(done('2026-11-16T10:00:00Z', { deletedAt: PURGED_AT }))).toBe(false);
    expect(countsAsDone({ ...sampleTask(ctx, 'inbox', 'Open') })).toBe(false);
  });
});

describe('doneByDay', () => {
  it('counts per local day, and per person when asked', () => {
    const tasks = [
      done('2026-11-16T10:00:00Z'),
      done('2026-11-16T23:30:00Z', { completedBy: 'u-kim' }),
      // Late on the 16th in Chicago is the 17th in UTC.
      done('2026-11-17T03:00:00Z'),
    ];
    expect([...doneByDay(tasks, 'UTC')]).toEqual([
      ['2026-11-16', 2],
      ['2026-11-17', 1],
    ]);
    expect([...doneByDay(tasks, 'America/Chicago')]).toEqual([['2026-11-16', 3]]);
    expect([...doneByDay(tasks, 'UTC', 'u-kim')]).toEqual([['2026-11-16', 1]]);
  });
});

describe('doneTotals', () => {
  const counts = new Map([
    ['2026-10-31', 4],
    ['2026-11-14', 1],
    ['2026-11-15', 2],
    ['2026-11-16', 1],
    ['2026-11-17', 3],
  ]);

  it('today, this week (from its first day), this month, and the days in a row', () => {
    // Tuesday the 17th: a Monday week starts on the 16th, a Sunday week on the 15th.
    expect(doneTotals(counts, '2026-11-17', 1)).toEqual({ today: 3, week: 4, month: 7, streak: 4 });
    expect(doneTotals(counts, '2026-11-17', 0).week).toBe(6);
  });

  it('keeps the streak up to yesterday while today has nothing yet, and breaks it on a gap', () => {
    expect(doneTotals(counts, '2026-11-18', 1)).toMatchObject({ today: 0, streak: 4 });
    expect(doneTotals(counts, '2026-11-19', 1).streak).toBe(0);
  });
});

describe('doneScale', () => {
  it('splits in three, with the busiest day always the darkest', () => {
    expect(doneScale([1, 2, 3])).toEqual({ few: 1, some: 2 });
    // One day, or all alike: that day is the busiest.
    expect(doneScale([3])).toEqual({ few: 2, some: 2 });
    expect(doneScale([1, 1])).toEqual({ few: 0, some: 0 });
    expect(doneScale([])).toEqual({ few: 0, some: 0 });
  });
});

describe('the heatmap’s span', () => {
  it('reaches as far back as completed tasks stay, from a quarter to a year', () => {
    const workspace = createWorkspace(ctx);
    const keep = (days: number) => ({
      ...workspace,
      entities: {
        ...workspace.entities,
        settings: [{ ...workspace.entities.settings[0]!, purgeAfterDays: days }],
      },
    });
    // 30 days in the list and 30 in the Trash: still a quarter.
    expect(heatWeeks(keep(30))).toBe(HEAT_MIN_WEEKS);
    expect(heatWeeks(keep(90))).toBe(27);
    expect(heatWeeks(keep(365))).toBe(HEAT_MAX_WEEKS);
  });

  it('weeks of seven days ending with the week of today, with days to come left out', () => {
    const columns = heatColumns('2026-11-17', 3, 1);
    expect(columns).toHaveLength(3);
    expect(columns[0]![0]).toBe('2026-11-02');
    expect(columns[2]).toEqual(['2026-11-16', '2026-11-17', null, null, null, null, null]);
  });
});
