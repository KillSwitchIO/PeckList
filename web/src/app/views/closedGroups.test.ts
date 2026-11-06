import { describe, expect, it } from 'vitest';
import type { Task } from '../../core/types.ts';
import { groupClosed, groupDeleted } from './closedGroups.ts';

const closedAt = (id: string, completedAt: string | null) =>
  ({ id, status: 'done', completedAt }) as unknown as Task;

describe('Completed groups', () => {
  it('splits the last week by day, older by month, undated last', () => {
    const groups = groupClosed(
      [
        closedAt('a', '2026-10-21T15:00:00Z'),
        closedAt('b', '2026-10-21T09:00:00Z'),
        closedAt('c', '2026-10-18T12:00:00Z'),
        closedAt('d', '2026-09-02T12:00:00Z'),
        closedAt('e', null),
      ],
      '2026-10-21',
      'UTC',
    );
    expect(groups.map((group) => [group.key, group.tasks.map((task) => task.id)])).toEqual([
      ['2026-10-21', ['a', 'b']],
      ['2026-10-18', ['c']],
      ['2026-09', ['d']],
      ['none', ['e']],
    ]);
    expect(groups[0]!.title).toMatch(/Today$/);
    expect(groups[2]!.title).toBe('September');
  });
});

describe('Trash groups', () => {
  const deletedAt = (id: string, at: string) =>
    ({ id, status: 'done', completedAt: '2020-01-01T00:00:00Z', deletedAt: at }) as unknown as Task;

  it('go by the day deleted, not the day closed: the last week by day, older by month', () => {
    const groups = groupDeleted(
      [
        deletedAt('a', '2026-10-21T15:00:00Z'),
        deletedAt('b', '2026-10-21T09:00:00Z'),
        deletedAt('c', '2026-10-18T12:00:00Z'),
        deletedAt('d', '2026-09-02T12:00:00Z'),
      ],
      '2026-10-21',
      'UTC',
    );
    expect(groups.map((group) => [group.key, group.tasks.map((task) => task.id)])).toEqual([
      ['2026-10-21', ['a', 'b']],
      ['2026-10-18', ['c']],
      ['2026-09', ['d']],
    ]);
    expect(groups[0]!.title).toMatch(/Today$/);
  });

  it("count a day by the person's own time zone", () => {
    const groups = groupDeleted(
      [deletedAt('late', '2026-10-21T03:00:00Z')],
      '2026-10-21',
      'America/Chicago',
    );
    expect(groups[0]!.key).toBe('2026-10-20');
  });
});
