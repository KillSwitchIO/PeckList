import { describe, expect, it } from 'vitest';
import { testContext } from '../test/fixtures.ts';
import { filterTasks } from './filters.ts';
import { inboxList } from './lists.ts';
import {
  createSavedFilter,
  DATE_CHOICES,
  dateChoiceOf,
  deleteSavedFilter,
  filterOf,
  savedFiltersOf,
  updateSavedFilter,
} from './savedFilters.ts';
import { createTask } from './tasks.ts';
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
});
