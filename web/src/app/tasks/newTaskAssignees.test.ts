import { describe, expect, it } from 'vitest';
import { putEntity } from '../../core/collections.ts';
import { createList, inboxList } from '../../core/lists.ts';
import { members } from '../../core/ops.ts';
import { createTask } from '../../core/tasks.ts';
import { createWorkspace } from '../../core/workspace.ts';
import { testContext } from '../../test/fixtures.ts';
import { newTaskAssignees } from './newTaskAssignees.ts';

describe('newTaskAssignees', () => {
  it('assigns the maker in shared lists on a server with accounts, nowhere else', () => {
    const ctx = testContext();
    const ws = createWorkspace(ctx);
    const made = createList(ctx, ws, { name: 'Groceries', color: '#CFE3A3' });
    const shared = putEntity(made.workspace, 'lists', { ...made.list, visibility: 'shared' });
    const me = ctx.userId;
    expect(newTaskAssignees(shared, made.list.id, me, true)).toEqual([`user:${me}`]);
    expect(newTaskAssignees(shared, made.list.id, me, false)).toEqual([]);
    expect(newTaskAssignees(shared, inboxList(shared).id, me, true)).toEqual([]);

    const task = createTask(ctx, shared, {
      title: 'Milk',
      listId: made.list.id,
      assignees: newTaskAssignees(shared, made.list.id, me, true),
    }).task;
    expect(members(task.assignees)).toEqual([`user:${me}`]);
  });
});
