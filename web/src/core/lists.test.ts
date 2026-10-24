import { describe, expect, it } from 'vitest';
import { testContext } from '../test/fixtures.ts';
import { getEntity } from './collections.ts';
import {
  createList,
  deleteList,
  flattenSections,
  inboxList,
  moveList,
  restoreList,
  updateList,
  visibleLists,
} from './lists.ts';
import { createEntity, updateEntity } from './ops.ts';
import { createTask } from './tasks.ts';
import type { Section, WorkspaceFile } from './types.ts';
import { putEntity } from './collections.ts';
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
    expect(visibleLists(next).map((list) => list.name)).toEqual(['Mess Drawer', 'Home', 'Work']);
  });

  it('archives, hides and reorders', () => {
    const { ctx, ws } = setup();
    const a = createList(ctx, ws, { name: 'A', color: '#A8DCC0' });
    const b = createList(ctx, a.workspace, { name: 'B', color: '#A8DCC0' });
    let next = moveList(ctx, b.workspace, b.list.id, null, a.list.order);
    expect(visibleLists(next).map((list) => list.name)).toEqual(['Mess Drawer', 'B', 'A']);
    next = updateList(ctx, next, a.list.id, { archived: true });
    expect(visibleLists(next).map((list) => list.name)).toEqual(['Mess Drawer', 'B']);
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
    const withSection = oldSection(ctx, workspace, list.id, 'Yard', 'm');
    const { workspace: withTask, task } = createTask(ctx, withSection.workspace, {
      title: 'Mow',
      listId: list.id,
    });
    let next = deleteList(ctx, withTask, list.id);
    expect(getEntity(next, 'tasks', task.id)?.deletedAt).not.toBeNull();
    const liveSections = (w: WorkspaceFile) =>
      w.entities.sections.filter((s) => s.deletedAt === null);
    expect(liveSections(next)).toEqual([]);
    next = restoreList(ctx, next, list.id);
    expect(getEntity(next, 'tasks', task.id)?.deletedAt).toBeNull();
    expect(liveSections(next)).toHaveLength(1);
    expect(restoreList(ctx, next, list.id)).toBe(next);
  });

  it('throws when the workspace has no Inbox', () => {
    const { ws } = setup();
    expect(() => inboxList({ ...ws, entities: { ...ws.entities, lists: [] } })).toThrow('no Inbox');
  });
});

/** A section as data from before sections were dropped. */
function oldSection(
  ctx: ReturnType<typeof setup>['ctx'],
  ws: WorkspaceFile,
  listId: string,
  name: string,
  order: string,
) {
  const section = createEntity<Section>(ctx, { listId, name, order });
  return { workspace: putEntity(ws, 'sections', section), section };
}

describe('flattenSections (sections were dropped)', () => {
  it('folds sections into the list, keeping the order they showed in', () => {
    const { ctx, ws } = setup();
    const inbox = inboxList(ws).id;
    const second = oldSection(ctx, ws, inbox, 'Second', 'm');
    const first = oldSection(ctx, second.workspace, inbox, 'First', 'c');
    let next = first.workspace;
    const add = (title: string, sectionId: string | null, order: string) => {
      const made = createTask(ctx, next, { title, listId: inbox });
      next = putEntity(next, 'tasks', updateEntity(ctx, made.task, { sectionId, order }));
      return made.task.id;
    };
    add('in second', second.section.id, 'a');
    add('loose', null, 'z');
    add('in first, later', first.section.id, 'q');
    add('in first', first.section.id, 'b');
    const sub = createTask(ctx, next, {
      title: 'sub',
      listId: inbox,
      parentId: next.entities.tasks[0]!.id,
    });
    next = putEntity(
      sub.workspace,
      'tasks',
      updateEntity(ctx, sub.task, { sectionId: second.section.id }),
    );

    const flat = flattenSections(ctx, next, () => true);
    const top = flat.entities.tasks
      .filter((task) => task.parentId === null)
      .sort((a, b) => (a.order < b.order ? -1 : 1))
      .map((task) => task.title);
    expect(top).toEqual(['loose', 'in first', 'in first, later', 'in second']);
    expect(flat.entities.tasks.every((task) => task.sectionId === null)).toBe(true);
    expect(flat.entities.sections.every((section) => section.deletedAt !== null)).toBe(true);
    // Once is enough.
    expect(flattenSections(ctx, flat, () => true)).toBe(flat);
  });

  it('leaves lists the person may not change, and does nothing without sections', () => {
    const { ctx, ws } = setup();
    const inbox = inboxList(ws).id;
    expect(flattenSections(ctx, ws, () => true)).toBe(ws);
    const { workspace } = oldSection(ctx, ws, inbox, 'Theirs', 'm');
    expect(flattenSections(ctx, workspace, () => false)).toBe(workspace);
  });
});
