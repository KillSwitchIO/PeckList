import { describe, expect, it } from 'vitest';
import { testContext } from '../test/fixtures.ts';
import { getEntity, putEntity } from './collections.ts';
import { createSection, inboxList } from './lists.ts';
import { members } from './ops.ts';
import {
  createTask,
  deleteTask,
  descendants,
  moveTask,
  rescheduleTo,
  restoreTask,
  setTaskStatus,
  setTaskTag,
  siblings,
  toggleTaskDone,
  updateTask,
} from './tasks.ts';
import type { WorkspaceFile } from './types.ts';
import { createWorkspace } from './workspace.ts';

function setup() {
  const ctx = testContext();
  let ws: WorkspaceFile = createWorkspace(ctx);
  const inbox = inboxList(ws).id;
  const add = (title: string, extra: Partial<Parameters<typeof createTask>[2]> = {}) => {
    const result = createTask(ctx, ws, { title, listId: inbox, ...extra });
    ws = result.workspace;
    return result.task;
  };
  return {
    ctx,
    inbox,
    add,
    get ws() {
      return ws;
    },
    set ws(next) {
      ws = next;
    },
  };
}

const titles = (tasks: { title: string }[]) => tasks.map((task) => task.title);

describe('createTask', () => {
  it('appends to the end of its siblings, trimmed, open, priority none', () => {
    const s = setup();
    s.add('  first ');
    s.add('second');
    const order = siblings(s.ws, s.inbox, null, null);
    expect(titles(order)).toEqual(['first', 'second']);
    expect(order[0]).toMatchObject({
      status: 'open',
      priority: 0,
      parentId: null,
      sectionId: null,
    });
  });

  it('creates subtasks in the parent list and section', () => {
    const s = setup();
    const { workspace, section } = createSection(s.ctx, s.ws, s.inbox, 'Yard');
    s.ws = workspace;
    const parent = s.add('Mow', { sectionId: section.id });
    const child = s.add('Edge', { parentId: parent.id, listId: 'ignored', sectionId: null });
    expect(child).toMatchObject({ listId: s.inbox, sectionId: section.id, parentId: parent.id });
  });

  it('applies initial tags', () => {
    const s = setup();
    const task = s.add('Tagged', { tags: ['01TESTTAG00000000000000001'] });
    expect(members(task.tags)).toEqual(['01TESTTAG00000000000000001']);
  });
});

describe('status', () => {
  it('completes with subtasks and reopens only the task', () => {
    const s = setup();
    const parent = s.add('Parent');
    const child = s.add('Child', { parentId: parent.id });
    s.ws = toggleTaskDone(s.ctx, s.ws, parent.id);
    expect(getEntity(s.ws, 'tasks', parent.id)).toMatchObject({
      status: 'done',
      completedBy: s.ctx.userId,
    });
    expect(getEntity(s.ws, 'tasks', child.id)?.status).toBe('done');
    s.ws = toggleTaskDone(s.ctx, s.ws, parent.id);
    expect(getEntity(s.ws, 'tasks', parent.id)).toMatchObject({
      status: 'open',
      completedAt: null,
    });
    expect(getEntity(s.ws, 'tasks', child.id)?.status).toBe('done');
  });

  it("supports won't do", () => {
    const s = setup();
    const task = s.add('Skip');
    s.ws = setTaskStatus(s.ctx, s.ws, task.id, 'wontdo');
    expect(getEntity(s.ws, 'tasks', task.id)?.status).toBe('wontdo');
  });
});

describe('update and tags', () => {
  it('updates fields', () => {
    const s = setup();
    const task = s.add('Old');
    s.ws = updateTask(s.ctx, s.ws, task.id, { title: 'New', priority: 3 });
    expect(getEntity(s.ws, 'tasks', task.id)).toMatchObject({ title: 'New', priority: 3 });
  });

  it('adds and removes tags, no-op when unchanged', () => {
    const s = setup();
    const task = s.add('T');
    s.ws = setTaskTag(s.ctx, s.ws, task.id, 'tag1', true);
    const before = s.ws;
    expect(setTaskTag(s.ctx, s.ws, task.id, 'tag1', true)).toBe(before);
    s.ws = setTaskTag(s.ctx, s.ws, task.id, 'tag1', false);
    expect(members(getEntity(s.ws, 'tasks', task.id)!.tags)).toEqual([]);
  });

  it('throws for unknown tasks', () => {
    const s = setup();
    expect(() => updateTask(s.ctx, s.ws, 'missing', { title: 'x' })).toThrow('not found');
  });
});

describe('delete and restore', () => {
  it('trashes a subtree and restores it together', () => {
    const s = setup();
    const parent = s.add('Parent');
    const child = s.add('Child', { parentId: parent.id });
    s.ws = deleteTask(s.ctx, s.ws, parent.id);
    expect(getEntity(s.ws, 'tasks', child.id)?.deletedAt).not.toBeNull();
    expect(descendants(s.ws, parent.id)).toEqual([]);
    s.ws = restoreTask(s.ctx, s.ws, parent.id);
    expect(getEntity(s.ws, 'tasks', parent.id)?.deletedAt).toBeNull();
    expect(getEntity(s.ws, 'tasks', child.id)?.deletedAt).toBeNull();
    expect(restoreTask(s.ctx, s.ws, parent.id)).toBe(s.ws);
  });

  it('does not restore a subtask deleted separately earlier', () => {
    const s = setup();
    const parent = s.add('Parent');
    const early = s.add('Early', { parentId: parent.id });
    s.ws = deleteTask(s.ctx, s.ws, early.id);
    s.ctx.now = (() => {
      const t = Date.now();
      return () => t;
    })();
    s.ws = deleteTask(s.ctx, s.ws, parent.id);
    s.ws = restoreTask(s.ctx, s.ws, parent.id);
    expect(getEntity(s.ws, 'tasks', early.id)?.deletedAt).not.toBeNull();
  });

  it('moves a restored subtask to the top level when its parent is still trashed', () => {
    const s = setup();
    const parent = s.add('Parent');
    const child = s.add('Child', { parentId: parent.id });
    s.ws = deleteTask(s.ctx, s.ws, child.id);
    s.ctx.now = (() => {
      const t = Date.now();
      return () => t;
    })();
    s.ws = deleteTask(s.ctx, s.ws, parent.id);
    s.ws = restoreTask(s.ctx, s.ws, child.id);
    expect(getEntity(s.ws, 'tasks', child.id)).toMatchObject({ deletedAt: null, parentId: null });
  });
});

describe('moveTask', () => {
  it('reorders before and after siblings', () => {
    const s = setup();
    const a = s.add('a');
    const b = s.add('b');
    const c = s.add('c');
    s.ws = moveTask(s.ctx, s.ws, c.id, { listId: s.inbox, beforeId: a.id });
    expect(titles(siblings(s.ws, s.inbox, null, null))).toEqual(['c', 'a', 'b']);
    s.ws = moveTask(s.ctx, s.ws, c.id, { listId: s.inbox, afterId: b.id });
    expect(titles(siblings(s.ws, s.inbox, null, null))).toEqual(['a', 'b', 'c']);
    s.ws = moveTask(s.ctx, s.ws, a.id, { listId: s.inbox, afterId: b.id });
    expect(titles(siblings(s.ws, s.inbox, null, null))).toEqual(['b', 'a', 'c']);
    s.ws = moveTask(s.ctx, s.ws, a.id, { listId: s.inbox });
    expect(titles(siblings(s.ws, s.inbox, null, null))).toEqual(['b', 'c', 'a']);
  });

  it('only rewrites the moved task and its subtree', () => {
    const s = setup();
    const a = s.add('a');
    const b = s.add('b');
    const before = s.ws;
    s.ws = moveTask(s.ctx, s.ws, b.id, { listId: s.inbox, beforeId: a.id });
    expect(getEntity(s.ws, 'tasks', a.id)).toBe(getEntity(before, 'tasks', a.id));
  });

  it('nests under a parent and carries subtasks to another section', () => {
    const s = setup();
    const { workspace, section } = createSection(s.ctx, s.ws, s.inbox, 'Later');
    s.ws = workspace;
    const parent = s.add('Parent');
    const child = s.add('Child', { parentId: parent.id });
    const other = s.add('Other');
    s.ws = moveTask(s.ctx, s.ws, parent.id, { listId: s.inbox, sectionId: section.id });
    expect(getEntity(s.ws, 'tasks', child.id)?.sectionId).toBe(section.id);
    s.ws = moveTask(s.ctx, s.ws, other.id, { listId: s.inbox, parentId: parent.id });
    expect(getEntity(s.ws, 'tasks', other.id)).toMatchObject({
      parentId: parent.id,
      sectionId: section.id,
    });
  });

  it('refuses cycles and unknown siblings', () => {
    const s = setup();
    const parent = s.add('Parent');
    const child = s.add('Child', { parentId: parent.id });
    expect(() => moveTask(s.ctx, s.ws, parent.id, { listId: s.inbox, parentId: child.id })).toThrow(
      'inside itself',
    );
    expect(() =>
      moveTask(s.ctx, s.ws, parent.id, { listId: s.inbox, parentId: parent.id }),
    ).toThrow('inside itself');
    expect(() => moveTask(s.ctx, s.ws, parent.id, { listId: s.inbox, beforeId: 'x' })).toThrow(
      'not found',
    );
    expect(() => moveTask(s.ctx, s.ws, parent.id, { listId: s.inbox, afterId: 'x' })).toThrow(
      'not found',
    );
  });

  it('keeps deleted tasks out of sibling order', () => {
    const s = setup();
    const a = s.add('a');
    s.add('b');
    s.ws = putEntity(s.ws, 'tasks', {
      ...getEntity(s.ws, 'tasks', a.id)!,
      deletedAt: '2026-10-20T00:00:00.000Z',
    });
    expect(titles(siblings(s.ws, s.inbox, null, null))).toEqual(['b']);
  });
});

describe('rescheduleTo', () => {
  it('moves the start date, keeping time and range length; ignores undated tasks', () => {
    const s = setup();
    const timed = s.add('timed', {
      schedule: {
        start: '2026-10-10T09:30',
        end: '2026-10-12T11:00',
        allDay: false,
        timeZone: 'UTC',
      },
    });
    const undated = s.add('undated');
    s.ws = rescheduleTo(s.ctx, s.ws, [timed.id, undated.id], '2026-10-20');
    expect(getEntity(s.ws, 'tasks', timed.id)?.schedule).toMatchObject({
      start: '2026-10-20T09:30',
      end: '2026-10-22T11:00',
    });
    expect(getEntity(s.ws, 'tasks', undated.id)?.schedule).toBeNull();
  });
});
