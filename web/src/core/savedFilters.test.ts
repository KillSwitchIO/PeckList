import { describe, expect, it } from 'vitest';
import { testContext } from '../test/fixtures.ts';
import { filterTasks } from './filters.ts';
import { inboxList } from './lists.ts';
import {
  createSavedFilter,
  DATE_CHOICES,
  dateChoiceOf,
  DUE_CHOICES,
  dueChoiceOf,
  deleteSavedFilter,
  filterOf,
  savedFiltersOf,
  updateSavedFilter,
} from './savedFilters.ts';
import { createTask, setTaskStatus } from './tasks.ts';
import { filterClosedTasks } from './filters.ts';
import { createWorkspace } from './workspace.ts';

const TODAY = '2026-10-21';

describe('saved filters', () => {
  it('creates, edits and deletes a filter that picks tasks', () => {
    const ctx = testContext();
    let ws = createWorkspace(ctx);
    ws = createTask(ctx, ws, { title: 'urgent', listId: inboxList(ws).id, priority: 3 }).workspace;
    ws = createTask(ctx, ws, { title: 'calm', listId: inboxList(ws).id }).workspace;

    const made = createSavedFilter(ctx, ws, ' High ', { priorities: [3] });
    ws = made.workspace;
    expect(savedFiltersOf(ws).map((each) => each.name)).toEqual(['High']);
    const titles = () =>
      filterTasks(ws, filterOf(savedFiltersOf(ws)[0]!), TODAY).map((task) => task.title);
    expect(titles()).toEqual(['urgent']);

    ws = updateSavedFilter(ctx, ws, made.filter.id, 'Anything', {});
    expect(titles().sort()).toEqual(['calm', 'urgent']);

    ws = deleteSavedFilter(ctx, ws, made.filter.id);
    expect(savedFiltersOf(ws)).toEqual([]);
  });

  it('reads back which date choice a filter uses', () => {
    for (const choice of Object.keys(DATE_CHOICES) as (keyof typeof DATE_CHOICES)[]) {
      expect(dateChoiceOf({ priorities: [1], ...DATE_CHOICES[choice] })).toBe(choice);
    }
  });

  it('reads back which due choice a filter uses, next to a start choice', () => {
    for (const choice of Object.keys(DUE_CHOICES) as (keyof typeof DUE_CHOICES)[]) {
      const filter = { ...DATE_CHOICES.week, ...DUE_CHOICES[choice] };
      expect(dueChoiceOf(filter)).toBe(choice);
      expect(dateChoiceOf(filter)).toBe('week');
    }
  });

  it('picks tasks by due date, and can leave closed ones out', () => {
    const ctx = testContext();
    let ws = createWorkspace(ctx);
    const listId = inboxList(ws).id;
    const add = (title: string, due: string | null) => {
      const made = createTask(ctx, ws, {
        title,
        listId,
        ...(due ? { due: { at: due, allDay: true, timeZone: 'UTC' } } : {}),
      });
      ws = made.workspace;
      return made.task;
    };
    add('late', '2026-10-19');
    add('today', TODAY);
    add('soon', '2026-10-25');
    add('far', '2026-12-01');
    add('never', null);
    const done = add('finished', '2026-10-19');
    ws = setTaskStatus(ctx, ws, done.id, 'done');
    const titles = (choice: keyof typeof DUE_CHOICES) =>
      filterTasks(ws, DUE_CHOICES[choice], TODAY).map((task) => task.title);
    expect(titles('overdue')).toEqual(['late']);
    expect(titles('today').sort()).toEqual(['late', 'today']);
    expect(titles('week').sort()).toEqual(['late', 'soon', 'today']);
    expect(titles('later')).toEqual(['far']);
    expect(titles('none')).toEqual(['never']);

    expect(filterClosedTasks(ws, DUE_CHOICES.overdue, TODAY).map((t) => t.title)).toEqual([
      'finished',
    ]);
    expect(filterClosedTasks(ws, { ...DUE_CHOICES.overdue, closed: false }, TODAY)).toEqual([]);
  });
});
