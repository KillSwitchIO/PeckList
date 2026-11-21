import { describe, expect, it } from 'vitest';
import { testContext } from '../test/fixtures.ts';
import { addAttachment, attachmentsOf } from './attachments.ts';
import { isLive } from './collections.ts';
import { duplicateList, duplicateTasks } from './duplicate.ts';
import { inboxList, createList } from './lists.ts';
import { members, setElement } from './ops.ts';
import {
  createTask,
  setPinned,
  setTaskProgress,
  setTaskStatus,
  siblings,
  updateTask,
} from './tasks.ts';
import type { Task, WorkspaceFile } from './types.ts';
import { createWorkspace } from './workspace.ts';

const SHA = 'a'.repeat(64);
const FRIEND = 'user:01TESTFR1END000000000001';

const task = (ws: WorkspaceFile, id: string) => ws.entities.tasks.find((each) => each.id === id)!;
const titles = (tasks: Task[]) => tasks.map((each) => each.title);

/** Inbox: Plan (with Book and Pack under it, Pack done), then Other. */
function setup() {
  const ctx = testContext();
  let ws = createWorkspace(ctx);
  const inbox = inboxList(ws).id;
  const plan = createTask(ctx, ws, {
    title: 'Plan the trip',
    listId: inbox,
    notes: 'Mind the dates',
    priority: 3,
    schedule: {
      start: '2026-11-27T09:00',
      end: '2026-11-27T10:00',
      allDay: false,
      timeZone: 'America/Chicago',
    },
    due: { at: '2026-11-28', allDay: true, timeZone: 'America/Chicago' },
    tags: ['01TESTTAG00000000000000001'],
    assignees: [FRIEND],
    reminders: [{ before: 30 }],
    recurrence: 'FREQ=WEEKLY',
  });
  ws = plan.workspace;
  ws = createTask(ctx, ws, { title: 'Other', listId: inbox }).workspace;
  const book = createTask(ctx, ws, { title: 'Book', listId: inbox, parentId: plan.task.id });
  ws = book.workspace;
  const pack = createTask(ctx, ws, {
    title: 'Pack',
    listId: inbox,
    parentId: plan.task.id,
    tags: ['01TESTTAG00000000000000002'],
  });
  ws = pack.workspace;
  ws = setTaskStatus(ctx, ws, pack.task.id, 'done');
  ws = updateTask(ctx, ws, plan.task.id, { constantReminder: true });
  ws = setPinned(ctx, ws, plan.task.id, true);
  ws = setTaskProgress(ctx, ws, plan.task.id, 40);
  ws = updateTask(ctx, ws, plan.task.id, {
    blockedBy: setElement(ctx, {}, book.task.id, true),
  });
  ws = addAttachment(ctx, ws, {
    taskId: plan.task.id,
    name: 'map.pdf',
    size: 10,
    mime: 'application/pdf',
    sha256: SHA,
  }).workspace;
  return { ctx, ws, inbox, plan: plan.task.id, book: book.task.id, pack: pack.task.id };
}

describe('duplicating tasks (PL-139)', () => {
  it('copies what makes the task, right below it, and leaves its state and history behind', () => {
    const { ctx, ws: before, inbox, plan } = setup();
    const { workspace: ws, ids } = duplicateTasks(ctx, before, [plan]);
    expect(ids).toHaveLength(1);
    const copy = task(ws, ids[0]!);
    const original = task(ws, plan);
    expect(titles(siblings(ws, inbox, null))).toEqual(['Plan the trip', 'Plan the trip', 'Other']);
    expect(siblings(ws, inbox, null)[1]!.id).toBe(copy.id);
    expect(copy).toMatchObject({
      title: original.title,
      notes: original.notes,
      listId: inbox,
      parentId: null,
      priority: 3,
      schedule: original.schedule,
      due: original.due,
      reminders: [{ before: 30 }],
      recurrence: 'FREQ=WEEKLY',
      constantReminder: true,
      status: 'open',
      progress: 0,
      blockedBy: {},
      createdBy: ctx.userId,
    });
    expect(copy.pinnedAt ?? null).toBeNull();
    expect(members(copy.tags)).toEqual(members(original.tags));
    expect(members(copy.assignees)).toEqual([FRIEND]);
    // As they were assigned there, stamps and all: older than the copy, so the server tells no
    // one (Ben, 2026-11-21: a copy's people are not notified).
    expect(copy.assignees).toEqual(original.assignees);
    expect(copy.assignees[FRIEND]!.hlc < copy._hlc.createdAt!).toBe(true);
    // The file is linked: a new attachment naming the same stored file.
    expect(attachmentsOf(ws, copy.id)).toMatchObject([{ name: 'map.pdf', sha256: SHA, size: 10 }]);
    expect(attachmentsOf(ws, copy.id)[0]!.id).not.toBe(attachmentsOf(ws, plan)[0]!.id);
    // The original is untouched.
    expect(original).toEqual(task(before, plan));
  });

  it('copies the subtasks in order, all open, each with exactly its own tags', () => {
    const { ctx, ws: before, inbox, plan, pack } = setup();
    const { workspace: ws, ids } = duplicateTasks(ctx, before, [plan]);
    const children = siblings(ws, inbox, ids[0]!);
    expect(titles(children)).toEqual(['Book', 'Pack']);
    expect(children.map((each) => each.status)).toEqual(['open', 'open']);
    expect(members(children[1]!.tags)).toEqual(members(task(before, pack).tags));
    expect(task(ws, pack).status).toBe('done');
  });

  it('copies several, each below its own, and a subtask chosen with its parent only once', () => {
    const { ctx, ws: before, inbox, plan, book } = setup();
    const other = siblings(before, inbox, null)[1]!.id;
    const { workspace: ws, ids } = duplicateTasks(ctx, before, [plan, book, other]);
    expect(ids).toHaveLength(2);
    expect(titles(siblings(ws, inbox, null))).toEqual([
      'Plan the trip',
      'Plan the trip',
      'Other',
      'Other',
    ]);
    expect(titles(siblings(ws, inbox, plan))).toEqual(['Book', 'Pack']);
    expect(titles(siblings(ws, inbox, ids[0]!))).toEqual(['Book', 'Pack']);
  });

  it('copies a subtask under the same parent, below itself', () => {
    const { ctx, ws: before, inbox, plan, book } = setup();
    const { workspace: ws, ids } = duplicateTasks(ctx, before, [book]);
    expect(task(ws, ids[0]!).parentId).toBe(plan);
    expect(titles(siblings(ws, inbox, plan))).toEqual(['Book', 'Book', 'Pack']);
  });

  it('skips a deleted task and leaves deleted subtasks out', () => {
    const { ctx, ws: start, plan, book } = setup();
    const before = updateTask(ctx, start, book, { deletedAt: '2026-10-20T16:20:00.000Z' });
    const { workspace: ws, ids } = duplicateTasks(ctx, before, [plan, book]);
    expect(ids).toHaveLength(1);
    expect(
      titles(ws.entities.tasks.filter((each) => each.parentId === ids[0] && isLive(each))),
    ).toEqual(['Pack']);
  });
});

describe('duplicating a list (PL-139)', () => {
  it('makes a private list with the open tasks and their subtasks, and no one else on them', () => {
    const { ctx, ws: start, inbox, plan } = setup();
    let before = start;
    const done = createTask(ctx, before, { title: 'Finished', listId: inbox });
    before = setTaskStatus(ctx, done.workspace, done.task.id, 'done');
    before = updateTask(ctx, before, plan, {
      assignees: setElement(ctx, task(before, plan).assignees, `user:${ctx.userId}`, true),
    });
    const { workspace: ws, list } = duplicateList(ctx, before, inbox, 'Trip (copy)');
    expect(list).toMatchObject({ name: 'Trip (copy)', visibility: 'private', isInbox: false });
    expect(ws.entities.listMembers.filter((each) => each.listId === list.id)).toEqual([]);
    const top = siblings(ws, list.id, null);
    expect(titles(top)).toEqual(['Plan the trip', 'Other']);
    expect(titles(siblings(ws, list.id, top[0]!.id))).toEqual(['Book', 'Pack']);
    expect(members(top[0]!.assignees)).toEqual([`user:${ctx.userId}`]);
    expect(attachmentsOf(ws, top[0]!.id)).toHaveLength(1);
    // The original list keeps all it had.
    expect(siblings(ws, inbox, null)).toHaveLength(3);
  });

  it('keeps the color and icon', () => {
    const ctx = testContext();
    const made = createList(ctx, createWorkspace(ctx), {
      name: 'Garden',
      color: '#2e7d32',
      icon: 'leaf',
    });
    const { list } = duplicateList(ctx, made.workspace, made.list.id, 'Garden (copy)');
    expect(list).toMatchObject({ color: '#2e7d32', icon: 'leaf' });
  });
});
