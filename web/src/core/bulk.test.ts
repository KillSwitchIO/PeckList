import { describe, expect, it } from 'vitest';
import { testContext } from '../test/fixtures.ts';
import {
  completeTasks,
  dateTasks,
  deleteTasks,
  moveTasks,
  prioritizeTasks,
  toggleTagOnTasks,
  togglePinOnTasks,
} from './bulk.ts';
import { createList, inboxList } from './lists.ts';
import { members } from './ops.ts';
import { createTag } from './tags.ts';
import { createTask, isPinned } from './tasks.ts';
import type { WorkspaceFile } from './types.ts';
import { createWorkspace } from './workspace.ts';

function setup() {
  const ctx = testContext();
  let ws: WorkspaceFile = createWorkspace(ctx);
  const inbox = inboxList(ws).id;
  const work = createList(ctx, ws, { name: 'Work', color: '#A7C7E7' });
  ws = work.workspace;
  const add = (title: string, extra: Partial<Parameters<typeof createTask>[2]> = {}) => {
    const made = createTask(ctx, ws, { title, listId: inbox, ...extra });
    ws = made.workspace;
    return made.task.id;
  };
  const a = add('a', {
    schedule: {
      start: '2026-10-20T09:30',
      end: '2026-10-20T10:30',
      allDay: false,
      timeZone: 'UTC',
    },
  });
  const b = add('b');
  const child = add('child', { parentId: b });
  return { ctx, ws, work: work.list.id, a, b, child };
}

const task = (ws: WorkspaceFile, id: string) => ws.entities.tasks.find((each) => each.id === id)!;

describe('changing many tasks at once', () => {
  it('completes, prioritizes and pins them all', () => {
    const { ctx, ws: start, a, b } = setup();
    let ws = completeTasks(ctx, start, [a, b]);
    expect([task(ws, a).status, task(ws, b).status]).toEqual(['done', 'done']);
    ws = prioritizeTasks(ctx, start, [a, b], 3);
    expect([task(ws, a).priority, task(ws, b).priority]).toEqual([3, 3]);
    ws = togglePinOnTasks(ctx, start, [a, b]);
    expect([isPinned(task(ws, a)), isPinned(task(ws, b))]).toEqual([true, true]);
    ws = togglePinOnTasks(ctx, ws, [a, b]);
    expect(isPinned(task(ws, a))).toBe(false);
  });

  it('dates them: a timed one keeps its time and length, an undated one becomes all day', () => {
    const { ctx, ws: start, a, b } = setup();
    const ws = dateTasks(ctx, start, [a, b], '2026-10-25', 'UTC');
    expect(task(ws, a).schedule).toMatchObject({
      start: '2026-10-25T09:30',
      end: '2026-10-25T10:30',
    });
    expect(task(ws, b).schedule).toMatchObject({ start: '2026-10-25', allDay: true });
    expect(task(dateTasks(ctx, ws, [a], null, 'UTC'), a).schedule).toBeNull();
  });

  it('moves and deletes a picked parent with its picked child as one', () => {
    const { ctx, ws: start, work, b, child } = setup();
    let ws = moveTasks(ctx, start, [child, b], work);
    expect(task(ws, b).listId).toBe(work);
    expect(task(ws, child).parentId).toBe(b);
    ws = deleteTasks(ctx, ws, [b, child]);
    expect(task(ws, b).deletedAt).not.toBeNull();
  });

  it('tags them all, or takes it off when they all have it', () => {
    const { ctx, ws: start, a, b } = setup();
    const tagged = createTag(ctx, start, 'urgent', '#E8837E');
    let ws = toggleTagOnTasks(ctx, tagged.workspace, [a, b], tagged.tag.id);
    expect(members(task(ws, a).tags)).toContain(tagged.tag.id);
    expect(members(task(ws, b).tags)).toContain(tagged.tag.id);
    ws = toggleTagOnTasks(ctx, ws, [a, b], tagged.tag.id);
    expect(members(task(ws, a).tags)).not.toContain(tagged.tag.id);
  });
});
