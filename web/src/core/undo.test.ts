import { describe, expect, it } from 'vitest';
import { testContext } from '../test/fixtures.ts';
import { addAttachment } from './attachments.ts';
import { getEntity } from './collections.ts';
import { addComment } from './comments.ts';
import { compareHlc } from './hlc.ts';
import { createList, deleteList, inboxList, restoreList } from './lists.ts';
import { mergeWorkspaces } from './merge.ts';
import { members } from './ops.ts';
import {
  createTask,
  deleteTask,
  restoreTask,
  setTaskTag,
  toggleTaskDone,
  updateTask,
} from './tasks.ts';
import { revertChange } from './undo.ts';
import { createWorkspace } from './workspace.ts';

function setup() {
  const ctx = testContext();
  const ws = createWorkspace(ctx);
  const { workspace, task } = createTask(ctx, ws, { title: 'Mow', listId: inboxList(ws).id });
  return { ctx, ws: workspace, task };
}

describe('revertChange', () => {
  it('reverts field changes with newer HLCs', () => {
    const { ctx, ws, task } = setup();
    const after = updateTask(ctx, ws, task.id, { title: 'Mow lawn', priority: 3 });
    const undone = revertChange(ctx, ws, after, after);
    const reverted = getEntity(undone, 'tasks', task.id)!;
    expect(reverted).toMatchObject({ title: 'Mow', priority: 0 });
    expect(compareHlc(reverted._hlc.title, getEntity(after, 'tasks', task.id)!._hlc.title)).toBe(1);
  });

  it('keeps later unrelated changes', () => {
    const { ctx, ws, task } = setup();
    const after = updateTask(ctx, ws, task.id, { title: 'Renamed' });
    const later = updateTask(ctx, after, task.id, { priority: 2 });
    const undone = revertChange(ctx, ws, after, later);
    expect(getEntity(undone, 'tasks', task.id)).toMatchObject({ title: 'Mow', priority: 2 });
  });

  it('trashes created entities and restores deleted ones', () => {
    const { ctx, ws } = setup();
    const created = createTask(ctx, ws, { title: 'New', listId: inboxList(ws).id });
    const undoneCreate = revertChange(ctx, ws, created.workspace, created.workspace);
    expect(getEntity(undoneCreate, 'tasks', created.task.id)?.deletedAt).not.toBeNull();

    const deleted = deleteTask(ctx, created.workspace, created.task.id);
    const undoneDelete = revertChange(ctx, created.workspace, deleted, deleted);
    expect(getEntity(undoneDelete, 'tasks', created.task.id)?.deletedAt).toBeNull();
  });

  // Audit B5: undoing a restore must not put the task back at its old time. A file held back on
  // the server may still be in the Trash at that time, and the server refuses a task at a time
  // something on it already has, so the undo would be refused.
  it('puts a restored task back in the Trash at a fresh time, with what came back with it', () => {
    const { ctx, ws, task } = setup();
    const commented = addComment(ctx, ws, task.id, 'Paint it');
    const filed = addAttachment(ctx, commented.workspace, {
      taskId: task.id,
      name: 'plan.pdf',
      size: 1,
      mime: 'application/pdf',
      sha256: 'a'.repeat(64),
    });
    const deleted = deleteTask(ctx, filed.workspace, task.id);
    const wentAt = getEntity(deleted, 'tasks', task.id)!.deletedAt;
    const restored = restoreTask(ctx, deleted, task.id);
    expect(getEntity(restored, 'comments', commented.comment.id)!.deletedAt).toBeNull();

    const undone = revertChange(ctx, deleted, restored, restored);
    const times = [
      getEntity(undone, 'tasks', task.id)!.deletedAt,
      getEntity(undone, 'comments', commented.comment.id)!.deletedAt,
      getEntity(undone, 'attachments', filed.attachment.id)!.deletedAt,
    ];
    expect(times[0]).not.toBeNull();
    expect(times[0]).not.toBe(wentAt);
    expect(times).toEqual([times[0], times[0], times[0]]);
  });

  it('puts a restored list and its tasks back in the Trash together, at one fresh time', () => {
    const { ctx, ws } = setup();
    const made = createList(ctx, ws, { name: 'Shed', color: '#A7C7E7' });
    const first = createTask(ctx, made.workspace, { title: 'Paint', listId: made.list.id });
    const second = createTask(ctx, first.workspace, { title: 'Sand', listId: made.list.id });
    const deleted = deleteList(ctx, second.workspace, made.list.id);
    const wentAt = getEntity(deleted, 'lists', made.list.id)!.deletedAt;
    const restored = restoreList(ctx, deleted, made.list.id);

    const undone = revertChange(ctx, deleted, restored, restored);
    const list = getEntity(undone, 'lists', made.list.id)!.deletedAt;
    expect(list).not.toBeNull();
    expect(list).not.toBe(wentAt);
    expect(getEntity(undone, 'tasks', first.task.id)!.deletedAt).toBe(list);
    expect(getEntity(undone, 'tasks', second.task.id)!.deletedAt).toBe(list);
  });

  it('reverts element-set changes per element', () => {
    const { ctx, ws, task } = setup();
    const tagged = setTaskTag(ctx, ws, task.id, 'a', true);
    const twice = setTaskTag(ctx, tagged, task.id, 'b', true);
    const undone = revertChange(ctx, tagged, twice, twice);
    expect(members(getEntity(undone, 'tasks', task.id)!.tags)).toEqual(['a']);
  });

  it('reverts completion including subtasks', () => {
    const { ctx, ws, task } = setup();
    const child = createTask(ctx, ws, { title: 'child', listId: task.listId, parentId: task.id });
    const done = toggleTaskDone(ctx, child.workspace, task.id);
    const undone = revertChange(ctx, child.workspace, done, done);
    expect(getEntity(undone, 'tasks', task.id)?.status).toBe('open');
    expect(getEntity(undone, 'tasks', child.task.id)?.status).toBe('open');
  });

  it('wins over the original change when merged with another copy', () => {
    const { ctx, ws, task } = setup();
    const after = updateTask(ctx, ws, task.id, { title: 'Renamed' });
    const undone = revertChange(ctx, ws, after, after);
    expect(getEntity(mergeWorkspaces(after, undone), 'tasks', task.id)?.title).toBe('Mow');
  });

  it('ignores entities that disappeared from the current copy', () => {
    const { ctx, ws, task } = setup();
    const after = updateTask(ctx, ws, task.id, { title: 'x' });
    const current = { ...after, entities: { ...after.entities, tasks: [] } };
    expect(revertChange(ctx, ws, after, current).entities.tasks).toEqual([]);
  });
});
