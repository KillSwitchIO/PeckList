import { describe, expect, it } from 'vitest';
import { testContext } from '../test/fixtures.ts';
import { dropIntoGroup, leavingPinned } from './groupDrop.ts';
import { createList, inboxList } from './lists.ts';
import { members } from './ops.ts';
import { createTag } from './tags.ts';
import { createTask, isPinned } from './tasks.ts';
import type { WorkspaceFile } from './types.ts';
import { createWorkspace } from './workspace.ts';

function setup() {
  const ctx = testContext();
  let ws: WorkspaceFile = createWorkspace(ctx);
  const work = createList(ctx, ws, { name: 'Work', color: '#A7C7E7' });
  ws = work.workspace;
  const a = createTag(ctx, ws, 'errand', '#A8DCC0');
  ws = a.workspace;
  const b = createTag(ctx, ws, 'call', '#E8837E');
  ws = b.workspace;
  const made = createTask(ctx, ws, {
    title: 'Pay bill',
    listId: inboxList(ws).id,
    tags: [a.tag.id],
    schedule: { start: '2026-10-20T09:30', end: null, allDay: false, timeZone: 'UTC' },
  });
  return {
    ctx,
    ws: made.workspace,
    id: made.task.id,
    work: work.list.id,
    errand: a.tag.id,
    call: b.tag.id,
  };
}

const task = (ws: WorkspaceFile, id: string) => ws.entities.tasks.find((each) => each.id === id)!;

describe('dropping a task into a group', () => {
  it('a day sets the date and keeps the time; a span it is in already changes nothing; No date clears it', () => {
    const { ctx, ws, id } = setup();
    const moved = dropIntoGroup(
      ctx,
      ws,
      id,
      { kind: 'date', value: '2026-10-25' },
      undefined,
      'UTC',
    );
    expect(task(moved, id).schedule?.start).toBe('2026-10-25T09:30');
    expect(
      dropIntoGroup(
        ctx,
        ws,
        id,
        { kind: 'date', value: '2026-10-19', until: '2026-10-26' },
        undefined,
        'UTC',
      ),
    ).toBe(ws);
    expect(
      task(dropIntoGroup(ctx, ws, id, { kind: 'date', value: 'none' }, undefined, 'UTC'), id)
        .schedule,
    ).toBeNull();
  });

  it('sets the priority, swaps the tag, and moves to a list', () => {
    const { ctx, ws, id, work, errand, call } = setup();
    expect(
      task(dropIntoGroup(ctx, ws, id, { kind: 'priority', value: '3' }, undefined, 'UTC'), id)
        .priority,
    ).toBe(3);
    const swapped = dropIntoGroup(
      ctx,
      ws,
      id,
      { kind: 'tag', value: call },
      { kind: 'tag', value: errand },
      'UTC',
    );
    expect(members(task(swapped, id).tags)).toEqual([call]);
    const untagged = dropIntoGroup(
      ctx,
      ws,
      id,
      { kind: 'tag', value: 'none' },
      { kind: 'tag', value: errand },
      'UTC',
    );
    expect(members(task(untagged, id).tags)).toEqual([]);
    expect(
      task(dropIntoGroup(ctx, ws, id, { kind: 'list', value: work }, undefined, 'UTC'), id).listId,
    ).toBe(work);
  });

  it('Pinned pins what comes in, and what leaves it is unpinned', () => {
    const { ctx, ws, id } = setup();
    const pinned = dropIntoGroup(ctx, ws, id, { kind: 'pin', value: 'pinned' }, undefined, 'UTC');
    expect(isPinned(task(pinned, id))).toBe(true);
    const out = leavingPinned(ctx, pinned, id, { kind: 'pin', value: 'pinned' });
    expect(isPinned(task(out, id))).toBe(false);
    // Only from Pinned.
    expect(leavingPinned(ctx, pinned, id, { kind: 'priority', value: '3' })).toBe(pinned);
  });
});
