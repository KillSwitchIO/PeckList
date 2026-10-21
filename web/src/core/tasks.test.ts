import { describe, expect, it } from 'vitest';
import { testContext } from '../test/fixtures.ts';
import { getEntity, putEntity } from './collections.ts';
import { createSection, inboxList } from './lists.ts';
import { members } from './ops.ts';
import { subtaskTree, todayTasks } from './queries.ts';
import {
  ancestors,
  canIndent,
  canNestUnder,
  createTask,
  deleteTask,
  descendants,
  detachTask,
  indentTask,
  MAX_SUBTASK_DEPTH,
  moveTask,
  nestUnder,
  outdentTask,
  rescheduleTo,
  restoreTask,
  setCompletedAt,
  setTaskStatus,
  setTaskTag,
  siblings,
  taskDepth,
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

describe('subtasks', () => {
  /** Titles with two-space indentation per level, from the top level down. */
  const outline = (s: ReturnType<typeof setup>) => {
    const lines: string[] = [];
    const walk = (parentId: string | null, depth: number) => {
      for (const task of s.ws.entities.tasks
        .filter((item) => item.parentId === parentId && item.deletedAt === null)
        .sort((a, b) => (a.order < b.order ? -1 : 1))) {
        lines.push(`${'  '.repeat(depth)}${task.title}`);
        walk(task.id, depth + 1);
      }
    };
    walk(null, 0);
    return lines;
  };

  it('inserts right after a sibling', () => {
    const s = setup();
    const a = s.add('a');
    s.add('c');
    s.add('b', { afterId: a.id });
    expect(outline(s)).toEqual(['a', 'b', 'c']);
  });

  it('indents under the sibling above and outdents back after the parent', () => {
    const s = setup();
    s.add('a');
    const b = s.add('b');
    const c = s.add('c');
    s.add('d');
    s.ws = indentTask(s.ctx, s.ws, b.id);
    s.ws = indentTask(s.ctx, s.ws, c.id);
    // With b nested, a is the sibling above c: c nests under a, after b.
    expect(outline(s)).toEqual(['a', '  b', '  c', 'd']);
    s.ws = indentTask(s.ctx, s.ws, c.id);
    expect(outline(s)).toEqual(['a', '  b', '    c', 'd']);
    expect(taskDepth(s.ws, c.id)).toBe(2);
    expect(titles(ancestors(s.ws, c.id))).toEqual(['a', 'b']);
    s.ws = outdentTask(s.ctx, s.ws, b.id);
    expect(outline(s)).toEqual(['a', 'b', '  c', 'd']);
  });

  it('does nothing without a sibling above or a parent', () => {
    const s = setup();
    const a = s.add('a');
    expect(canIndent(s.ws, a.id)).toBe(false);
    expect(indentTask(s.ctx, s.ws, a.id)).toBe(s.ws);
    expect(outdentTask(s.ctx, s.ws, a.id)).toBe(s.ws);
  });

  it(`stops at ${MAX_SUBTASK_DEPTH} levels`, () => {
    const s = setup();
    let parent = s.add('top');
    for (let level = 1; level <= MAX_SUBTASK_DEPTH; level += 1) {
      parent = s.add(`level ${level}`, { parentId: parent.id });
    }
    expect(() => s.add('too deep', { parentId: parent.id })).toThrow('too deep');
    const sibling = s.add('sibling', { parentId: parent.parentId });
    expect(canIndent(s.ws, sibling.id)).toBe(false);
  });

  it('flattens the subtree, optionally open only', () => {
    const s = setup();
    const root = s.add('root');
    const a = s.add('a', { parentId: root.id });
    s.add('a1', { parentId: a.id });
    const b = s.add('b', { parentId: root.id });
    s.ws = setTaskStatus(s.ctx, s.ws, b.id, 'done');
    const tree = (openOnly: boolean) =>
      subtaskTree(s.ws, root.id, { openOnly }).map(
        (node) => `${node.depth}:${node.task.title}${node.hasChildren ? '+' : ''}`,
      );
    expect(tree(false)).toEqual(['0:a+', '1:a1', '0:b']);
    expect(tree(true)).toEqual(['0:a+', '1:a1']);
  });

  it('shows dated subtasks in Today on their own', () => {
    const s = setup();
    const parent = s.add('parent');
    s.add('child', {
      parentId: parent.id,
      schedule: { start: '2026-10-21', end: null, allDay: true, timeZone: 'UTC' },
    });
    expect(titles(todayTasks(s.ws, '2026-10-21'))).toEqual(['child']);
  });
});

describe('subtask inheritance and detaching', () => {
  it('gives new and newly nested subtasks the parent tags', () => {
    const s = setup();
    const parent = s.add('parent', { tags: ['home'] });
    const child = s.add('child', { parentId: parent.id, tags: ['urgent'] });
    expect(members(getEntity(s.ws, 'tasks', child.id)!.tags).sort()).toEqual(['home', 'urgent']);
    const loose = s.add('loose');
    const looseChild = s.add('loose child', { parentId: loose.id });
    s.ws = moveTask(s.ctx, s.ws, loose.id, { listId: s.inbox, parentId: parent.id });
    expect(members(getEntity(s.ws, 'tasks', loose.id)!.tags)).toEqual(['home']);
    expect(members(getEntity(s.ws, 'tasks', looseChild.id)!.tags)).toEqual(['home']);
  });

  it('detaches a subtask to the top level, right after its top task', () => {
    const s = setup();
    const top = s.add('top');
    const mid = s.add('mid', { parentId: top.id });
    const deep = s.add('deep', { parentId: mid.id });
    s.add('next');
    s.ws = detachTask(s.ctx, s.ws, deep.id);
    expect(titles(siblings(s.ws, s.inbox, null, null))).toEqual(['top', 'deep', 'next']);
    expect(detachTask(s.ctx, s.ws, top.id)).toBe(s.ws);
  });
});

describe('nesting any task under another', () => {
  it('moves a task with its subtasks under another task, in that task list', () => {
    const s = setup();
    const target = s.add('target', { tags: ['home'] });
    const other = s.add('other');
    const child = s.add('child', { parentId: other.id });
    expect(canNestUnder(s.ws, other.id, target.id)).toBe(true);
    s.ws = nestUnder(s.ctx, s.ws, other.id, target.id);
    expect(getEntity(s.ws, 'tasks', other.id)).toMatchObject({ parentId: target.id });
    expect(members(getEntity(s.ws, 'tasks', child.id)!.tags)).toEqual(['home']);
  });

  it('refuses itself, its own subtasks, its current parent, closed tasks and too deep', () => {
    const s = setup();
    const a = s.add('a');
    const b = s.add('b', { parentId: a.id });
    const done = s.add('done');
    s.ws = setTaskStatus(s.ctx, s.ws, done.id, 'done');
    expect(canNestUnder(s.ws, a.id, a.id)).toBe(false);
    expect(canNestUnder(s.ws, a.id, b.id)).toBe(false);
    expect(canNestUnder(s.ws, b.id, a.id)).toBe(false);
    expect(canNestUnder(s.ws, a.id, done.id)).toBe(false);
    let deepest = s.add('top');
    for (let level = 1; level <= MAX_SUBTASK_DEPTH; level += 1) {
      deepest = s.add(`level ${level}`, { parentId: deepest.id });
    }
    expect(canNestUnder(s.ws, a.id, deepest.id)).toBe(false);
    expect(() => nestUnder(s.ctx, s.ws, a.id, a.id)).toThrow('cannot nest');
  });
});

describe('completion date', () => {
  it('stamps on completion only when empty, keeps a user-set date, clears on reopen', () => {
    const s = setup();
    const a = s.add('a');
    s.ws = setTaskStatus(s.ctx, s.ws, a.id, 'done');
    const stamped = getEntity(s.ws, 'tasks', a.id)!.completedAt;
    expect(stamped).toMatch(/Z$/);
    s.ws = setCompletedAt(s.ctx, s.ws, a.id, '2026-10-01T12:00:00.000Z');
    s.ws = setTaskStatus(s.ctx, s.ws, a.id, 'wontdo');
    expect(getEntity(s.ws, 'tasks', a.id)!.completedAt).toBe('2026-10-01T12:00:00.000Z');
    s.ws = setTaskStatus(s.ctx, s.ws, a.id, 'open');
    expect(getEntity(s.ws, 'tasks', a.id)).toMatchObject({ completedAt: null, completedBy: null });
    // Set ahead of time on an open task: completing keeps it.
    const b = s.add('b');
    s.ws = setCompletedAt(s.ctx, s.ws, b.id, '2026-09-30T08:00:00.000Z');
    s.ws = toggleTaskDone(s.ctx, s.ws, b.id);
    expect(getEntity(s.ws, 'tasks', b.id)!.completedAt).toBe('2026-09-30T08:00:00.000Z');
  });

  it('clearing the date of a closed task reopens it', () => {
    const s = setup();
    const a = s.add('a');
    s.ws = setTaskStatus(s.ctx, s.ws, a.id, 'done');
    s.ws = setCompletedAt(s.ctx, s.ws, a.id, null);
    expect(getEntity(s.ws, 'tasks', a.id)).toMatchObject({ status: 'open', completedAt: null });
  });
});
