import { describe, expect, it } from 'vitest';
import { sampleTask, sampleWorkspace, testContext } from '../test/fixtures.ts';
import { groupByPriority, groupByTag, sortTasks } from './listView.ts';
import { setElement } from './ops.ts';
import type { Priority, Task } from './types.ts';

function tasks() {
  const ctx = testContext();
  const workspace = sampleWorkspace(ctx);
  const inbox = workspace.entities.lists[0]!.id;
  const make = (title: string, order: string, priority: Priority, start: string | null) => {
    const task = sampleTask(ctx, inbox, title, order);
    task.priority = priority;
    task.schedule = start ? { start, end: null, allDay: true, timeZone: 'UTC' } : null;
    return task;
  };
  const list: Task[] = [
    make('banana', 'A', 1, '2026-10-25'),
    make('Apple 10', 'B', 3, null),
    make('apple 9', 'C', 0, '2026-10-24'),
    make('cherry', 'D', 3, '2026-10-24'),
  ];
  return { ctx, workspace, list };
}

const titlesOf = (list: Task[]) => list.map((task) => task.title);

describe('sortTasks', () => {
  it('sorts by the list order, date, priority, title or newest first', () => {
    const { list } = tasks();
    expect(titlesOf(sortTasks(list, 'manual'))).toEqual([
      'banana',
      'Apple 10',
      'apple 9',
      'cherry',
    ]);
    // Undated last; same day by priority.
    expect(titlesOf(sortTasks(list, 'date'))).toEqual(['cherry', 'apple 9', 'banana', 'Apple 10']);
    // Same priority by date, undated last.
    expect(titlesOf(sortTasks(list, 'priority'))).toEqual([
      'cherry',
      'Apple 10',
      'banana',
      'apple 9',
    ]);
    // Case-blind, numbers as numbers.
    expect(titlesOf(sortTasks(list, 'title'))).toEqual(['apple 9', 'Apple 10', 'banana', 'cherry']);
    expect(titlesOf(sortTasks(list, 'created'))).toEqual([
      'cherry',
      'apple 9',
      'Apple 10',
      'banana',
    ]);
  });
});

describe('grouping', () => {
  it('groups by priority, high first, leaving out empty ones', () => {
    const { list } = tasks();
    expect(groupByPriority(list).map((group) => [group.priority, titlesOf(group.tasks)])).toEqual([
      [3, ['Apple 10', 'cherry']],
      [1, ['banana']],
      [0, ['apple 9']],
    ]);
  });

  it('groups by tag in the tags order, a task in each of its tags, untagged last', () => {
    const { ctx, workspace, list } = tasks();
    const tag = workspace.entities.tags[0]!;
    list[0]!.tags = setElement(ctx, list[0]!.tags, tag.id, true);
    expect(groupByTag(workspace, list).map((group) => [group.name, titlesOf(group.tasks)])).toEqual(
      [
        ['home/yard', ['banana']],
        [undefined, ['Apple 10', 'apple 9', 'cherry']],
      ],
    );
  });
});
