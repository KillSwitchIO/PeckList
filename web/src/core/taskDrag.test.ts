import { describe, expect, it } from 'vitest';
import { testContext } from '../test/fixtures.ts';
import { inboxList } from './lists.ts';
import { keyboardMove, projectDrop, type DragRow } from './taskDrag.ts';
import { createTask, MAX_SUBTASK_DEPTH, moveTask } from './tasks.ts';
import type { WorkspaceFile } from './types.ts';
import { createWorkspace } from './workspace.ts';

/** A (B (C)), D and a loose task X to drag in. */
function setup() {
  const ctx = testContext();
  let ws: WorkspaceFile = createWorkspace(ctx);
  const listId = inboxList(ws).id;
  const add = (title: string, parentId: string | null = null) => {
    const made = createTask(ctx, ws, { title, listId, parentId });
    ws = made.workspace;
    return made.task.id;
  };
  const a = add('A');
  const b = add('B', a);
  const c = add('C', b);
  const d = add('D');
  const x = add('X');
  const rows: DragRow[] = [
    { id: a, depth: 0 },
    { id: b, depth: 1 },
    { id: c, depth: 2 },
    { id: d, depth: 0 },
  ];
  return {
    ctx,
    ws: () => ws,
    set: (next: WorkspaceFile) => (ws = next),
    listId,
    a,
    b,
    c,
    d,
    x,
    rows,
  };
}

const titlesUnder = (ws: WorkspaceFile, parentId: string | null) =>
  ws.entities.tasks
    .filter((task) => task.parentId === parentId && task.deletedAt === null)
    .sort((p, q) => (p.order < q.order ? -1 : 1))
    .map((task) => task.title);

describe('projectDrop', () => {
  it('keeps the depth between what the rows around allow', () => {
    const s = setup();
    const at = (index: number, depth: number) =>
      projectDrop(s.ws(), s.x, s.listId, null, s.rows, index, depth);
    // Top: nothing to nest under.
    expect(at(0, 3).depth).toBe(0);
    // Under A: top level or A's child; under C: anything from 0 to 3, but D (below) is top
    // level so 0 is allowed.
    expect(at(1, 5).depth).toBe(1);
    expect(at(4, 9).depth).toBe(1);
    expect(at(3, 9).depth).toBe(3);
    // Between B and C: C stays B's child, so at least depth 2.
    expect(at(2, 0).depth).toBe(2);
  });

  it('turns the slot into parent and neighbours that moveTask understands', () => {
    const s = setup();
    // Below C, one level in: C's first child.
    let drop = projectDrop(s.ws(), s.x, s.listId, null, s.rows, 3, 3);
    expect(drop.target).toMatchObject({ parentId: s.c });
    s.set(moveTask(s.ctx, s.ws(), s.x, drop.target));
    expect(titlesUnder(s.ws(), s.c)).toEqual(['X']);

    // Below C at depth 1: B's sibling, right after B.
    drop = projectDrop(s.ws(), s.x, s.listId, null, s.rows, 3, 1);
    expect(drop.target).toMatchObject({ parentId: s.a, afterId: s.b });
    s.set(moveTask(s.ctx, s.ws(), s.x, drop.target));
    expect(titlesUnder(s.ws(), s.a)).toEqual(['B', 'X']);

    // Above A at the top: before A.
    drop = projectDrop(s.ws(), s.x, s.listId, null, s.rows, 0, 0);
    expect(drop.target).toMatchObject({ parentId: null, beforeId: s.a });
    s.set(moveTask(s.ctx, s.ws(), s.x, drop.target));
    expect(titlesUnder(s.ws(), null)).toEqual(['X', 'A', 'D']);
  });

  it('stops nesting where the dragged subtree would get too deep', () => {
    const s = setup();
    // A tall task: T with a chain of MAX - 1 subtasks below it.
    const tall = createTask(s.ctx, s.ws(), { title: 'T', listId: s.listId });
    s.set(tall.workspace);
    let top = tall.task.id;
    for (let level = 1; level < MAX_SUBTASK_DEPTH; level += 1) {
      const child = createTask(s.ctx, s.ws(), {
        title: `t${level}`,
        listId: s.listId,
        parentId: top,
      });
      s.set(child.workspace);
      top = child.task.id;
    }
    // Already MAX - 1 levels below T: it can go one level in at most.
    expect(projectDrop(s.ws(), tall.task.id, s.listId, null, s.rows, 3, 3).depth).toBe(1);
  });
});

describe('keyboardMove', () => {
  it('moves among siblings, nests and outdents', () => {
    const s = setup();
    const run = (key: string, id: string) => s.set(keyboardMove(key)!(s.ctx, s.ws(), id));
    expect(titlesUnder(s.ws(), null)).toEqual(['A', 'D', 'X']);
    run('ArrowUp', s.x);
    expect(titlesUnder(s.ws(), null)).toEqual(['A', 'X', 'D']);
    run('ArrowDown', s.a);
    expect(titlesUnder(s.ws(), null)).toEqual(['X', 'A', 'D']);
    // At the top already: nothing happens.
    const before = s.ws();
    run('ArrowUp', s.x);
    expect(s.ws()).toBe(before);
    run('ArrowRight', s.d);
    expect(titlesUnder(s.ws(), s.a)).toEqual(['B', 'D']);
    run('ArrowLeft', s.d);
    expect(titlesUnder(s.ws(), null)).toEqual(['X', 'A', 'D']);
    expect(keyboardMove('Enter')).toBeNull();
  });
});
