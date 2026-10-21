import { describe, expect, it } from 'vitest';
import { testContext } from '../test/fixtures.ts';
import { getEntity } from './collections.ts';
import {
  createFolder,
  createList,
  createSection,
  deleteFolder,
  deleteList,
  deleteSection,
  inboxList,
  moveList,
  renameFolder,
  renameSection,
  restoreList,
  sectionsOf,
  updateList,
  visibleFolders,
  visibleLists,
} from './lists.ts';
import { createTask } from './tasks.ts';
import { createWorkspace } from './workspace.ts';

function setup() {
  const ctx = testContext();
  return { ctx, ws: createWorkspace(ctx) };
}

describe('lists', () => {
  it('keeps the Inbox first and appends new lists', () => {
    const { ctx, ws } = setup();
    let next = createList(ctx, ws, { name: ' Home ', color: '#A8DCC0' }).workspace;
    next = createList(ctx, next, { name: 'Work', color: '#A7C7E7' }).workspace;
    expect(visibleLists(next).map((list) => list.name)).toEqual(['Inbox', 'Home', 'Work']);
  });

  it('archives, hides and reorders', () => {
    const { ctx, ws } = setup();
    const a = createList(ctx, ws, { name: 'A', color: '#A8DCC0' });
    const b = createList(ctx, a.workspace, { name: 'B', color: '#A8DCC0' });
    let next = moveList(ctx, b.workspace, b.list.id, null, a.list.order);
    expect(visibleLists(next).map((list) => list.name)).toEqual(['Inbox', 'B', 'A']);
    next = updateList(ctx, next, a.list.id, { archived: true });
    expect(visibleLists(next).map((list) => list.name)).toEqual(['Inbox', 'B']);
    expect(visibleLists(next, true)).toHaveLength(3);
  });

  it('protects the Inbox', () => {
    const { ctx, ws } = setup();
    const inbox = inboxList(ws).id;
    expect(() => updateList(ctx, ws, inbox, { archived: true })).toThrow('Inbox');
    expect(() => deleteList(ctx, ws, inbox)).toThrow('Inbox');
  });

  it('deletes a list with its sections and tasks, and restores them together', () => {
    const { ctx, ws } = setup();
    const { workspace, list } = createList(ctx, ws, { name: 'Home', color: '#A8DCC0' });
    const withSection = createSection(ctx, workspace, list.id, 'Yard');
    const { workspace: withTask, task } = createTask(ctx, withSection.workspace, {
      title: 'Mow',
      listId: list.id,
    });
    let next = deleteList(ctx, withTask, list.id);
    expect(getEntity(next, 'tasks', task.id)?.deletedAt).not.toBeNull();
    expect(sectionsOf(next, list.id)).toEqual([]);
    next = restoreList(ctx, next, list.id);
    expect(getEntity(next, 'tasks', task.id)?.deletedAt).toBeNull();
    expect(sectionsOf(next, list.id)).toHaveLength(1);
    expect(restoreList(ctx, next, list.id)).toBe(next);
  });

  it('throws when the workspace has no Inbox', () => {
    const { ws } = setup();
    expect(() => inboxList({ ...ws, entities: { ...ws.entities, lists: [] } })).toThrow('no Inbox');
  });
});

describe('sections', () => {
  it('creates, renames and deletes; tasks fall back to no section', () => {
    const { ctx, ws } = setup();
    const inbox = inboxList(ws).id;
    const one = createSection(ctx, ws, inbox, 'One');
    const two = createSection(ctx, one.workspace, inbox, 'Two');
    let next = renameSection(ctx, two.workspace, one.section.id, ' First ');
    expect(sectionsOf(next, inbox).map((s) => s.name)).toEqual(['First', 'Two']);
    const { workspace, task } = createTask(ctx, next, {
      title: 'x',
      listId: inbox,
      sectionId: one.section.id,
    });
    next = deleteSection(ctx, workspace, one.section.id);
    expect(getEntity(next, 'tasks', task.id)?.sectionId).toBeNull();
    expect(sectionsOf(next, inbox).map((s) => s.name)).toEqual(['Two']);
  });

  it('requires an existing list', () => {
    const { ctx, ws } = setup();
    expect(() => createSection(ctx, ws, 'missing', 'x')).toThrow('not found');
  });
});

describe('folders', () => {
  it('creates, renames and deletes; lists move to the top level', () => {
    const { ctx, ws } = setup();
    const { workspace, folder } = createFolder(ctx, ws, 'Personal');
    const { workspace: withList, list } = createList(ctx, workspace, {
      name: 'Home',
      color: '#A8DCC0',
      folderId: folder.id,
    });
    let next = renameFolder(ctx, withList, folder.id, 'Life');
    expect(visibleFolders(next)[0]?.name).toBe('Life');
    next = deleteFolder(ctx, next, folder.id);
    expect(visibleFolders(next)).toEqual([]);
    expect(getEntity(next, 'lists', list.id)?.folderId).toBeNull();
  });
});
