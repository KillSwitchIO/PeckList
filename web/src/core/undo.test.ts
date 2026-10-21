import { describe, expect, it } from 'vitest';
import { testContext } from '../test/fixtures.ts';
import { getEntity } from './collections.ts';
import { compareHlc } from './hlc.ts';
import { inboxList } from './lists.ts';
import { mergeWorkspaces } from './merge.ts';
import { members } from './ops.ts';
import { createTask, deleteTask, setTaskTag, toggleTaskDone, updateTask } from './tasks.ts';
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
