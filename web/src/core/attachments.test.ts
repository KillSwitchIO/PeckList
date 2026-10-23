import { describe, expect, it } from 'vitest';
import { testContext } from '../test/fixtures.ts';
import {
  addAttachment,
  attachmentsOf,
  canChangeAttachment,
  isPicture,
  removeAttachment,
  renameAttachment,
} from './attachments.ts';
import { inboxList } from './lists.ts';
import { createTask } from './tasks.ts';
import { createWorkspace } from './workspace.ts';

const SHA = 'a'.repeat(64);

describe('attachments', () => {
  it('adds files to a task in order, renames and removes them', () => {
    const ctx = testContext();
    const start = createWorkspace(ctx);
    const made = createTask(ctx, start, { title: 'Trip', listId: inboxList(start).id });
    let ws = made.workspace;
    const first = addAttachment(ctx, ws, {
      taskId: made.task.id,
      name: ' itinerary.pdf ',
      size: 12.7,
      mime: '',
      sha256: SHA,
    });
    ws = addAttachment(ctx, first.workspace, {
      taskId: made.task.id,
      name: 'map.png',
      size: 5,
      mime: 'image/png',
      sha256: SHA,
    }).workspace;
    expect(attachmentsOf(ws, made.task.id).map((each) => each.name)).toEqual([
      'itinerary.pdf',
      'map.png',
    ]);
    expect(first.attachment).toMatchObject({ size: 12, mime: 'application/octet-stream' });

    ws = renameAttachment(ctx, ws, first.attachment.id, 'plan.pdf');
    ws = removeAttachment(ctx, ws, first.attachment.id);
    expect(attachmentsOf(ws, made.task.id).map((each) => each.name)).toEqual(['map.png']);
    expect(() =>
      addAttachment(ctx, ws, {
        taskId: made.task.id,
        name: 'x',
        size: 1,
        mime: '',
        sha256: 'NOPE',
      }),
    ).toThrow('SHA-256');
    expect(() =>
      addAttachment(ctx, ws, { taskId: 'missing', name: 'x', size: 1, mime: '', sha256: SHA }),
    ).toThrow();
  });

  it('lets who added a file change it, and the list owner remove it', () => {
    const ctx = testContext();
    const ws = createWorkspace(ctx);
    const task = createTask(ctx, ws, { title: 'Trip', listId: inboxList(ws).id });
    const mine = addAttachment(ctx, task.workspace, {
      taskId: task.task.id,
      name: 'a',
      size: 1,
      mime: '',
      sha256: SHA,
    });
    expect(canChangeAttachment(mine.workspace, ctx.userId, mine.attachment)).toEqual({
      rename: true,
      remove: true,
    });
    const theirs = { ...mine.attachment, createdBy: 'someone-else' };
    // I own the list (it is my own Mess Drawer): I may remove what others added, not rename it.
    expect(canChangeAttachment(mine.workspace, ctx.userId, theirs)).toEqual({
      rename: false,
      remove: true,
    });
    expect(canChangeAttachment(mine.workspace, 'stranger', theirs)).toEqual({
      rename: false,
      remove: false,
    });
  });

  it('knows which files are pictures the app shows', () => {
    expect(isPicture('image/png')).toBe(true);
    expect(isPicture('image/svg+xml')).toBe(false);
    expect(isPicture('application/pdf')).toBe(false);
  });
});
