import { describe, expect, it } from 'vitest';
import { testContext } from '../test/fixtures.ts';
import { createList, inboxList } from './lists.ts';
import { narrowWorkspace, NO_NARROWING } from './narrowing.ts';
import { createSavedFilter } from './savedFilters.ts';
import { createTag } from './tags.ts';
import { createTask } from './tasks.ts';
import type { WorkspaceFile } from './types.ts';
import { createWorkspace } from './workspace.ts';

const TODAY = '2026-10-21';

function setup() {
  const ctx = testContext();
  let ws: WorkspaceFile = createWorkspace(ctx);
  const inbox = inboxList(ws).id;
  const work = createList(ctx, ws, { name: 'Work', color: '#A7C7E7' });
  ws = work.workspace;
  const tagged = createTag(ctx, ws, 'home/yard', '#A8DCC0');
  ws = tagged.workspace;
  const home = ws.entities.tags.find((tag) => tag.name === 'home')!.id;
  const add = (title: string, extra: Partial<Parameters<typeof createTask>[2]> = {}) => {
    ws = createTask(ctx, ws, { title, listId: inbox, ...extra }).workspace;
  };
  add('mow', { tags: [tagged.tag.id] });
  add('report', { listId: work.list.id, priority: 3 });
  add('email', { listId: work.list.id, tags: [home] });
  add('nap');
  const urgent = createSavedFilter(ctx, ws, 'Urgent', { priorities: [3] });
  ws = urgent.workspace;
  return { ws, work: work.list.id, inbox, home, urgent: urgent.filter.id };
}

const titles = (ws: WorkspaceFile) => ws.entities.tasks.map((task) => task.title).sort();

describe('narrowing a view', () => {
  it('lets everything through when nothing is picked', () => {
    const { ws } = setup();
    expect(narrowWorkspace(ws, NO_NARROWING, TODAY)).toBe(ws);
  });

  it('any picked list will do, and a tag takes the tags under it too', () => {
    const { ws, work, inbox, home } = setup();
    expect(
      titles(narrowWorkspace(ws, { lists: [work, inbox], tags: [], filters: [] }, TODAY)),
    ).toEqual(['email', 'mow', 'nap', 'report']);
    expect(titles(narrowWorkspace(ws, { lists: [], tags: [home], filters: [] }, TODAY))).toEqual([
      'email',
      'mow',
    ]);
  });

  it('kinds combine: in Work and tagged home, or in Work and matching a saved filter', () => {
    const { ws, work, home, urgent } = setup();
    expect(
      titles(narrowWorkspace(ws, { lists: [work], tags: [home], filters: [] }, TODAY)),
    ).toEqual(['email']);
    expect(
      titles(narrowWorkspace(ws, { lists: [work], tags: [], filters: [urgent] }, TODAY)),
    ).toEqual(['report']);
  });

  it('passes over picks that are gone', () => {
    const { ws } = setup();
    expect(
      titles(narrowWorkspace(ws, { lists: ['gone'], tags: ['gone'], filters: ['gone'] }, TODAY)),
    ).toEqual(['email', 'mow', 'nap', 'report']);
  });
});
