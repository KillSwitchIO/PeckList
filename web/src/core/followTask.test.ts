import { describe, expect, it } from 'vitest';
import { testContext } from '../test/fixtures.ts';
import { addAttachment, removeAttachment } from './attachments.ts';
import { addComment, deleteComment } from './comments.ts';
import { createList, deleteList, inboxList, restoreList } from './lists.ts';
import { updateEntity } from './ops.ts';
import { putEntity } from './collections.ts';
import { pushBatch, type SyncChange } from './sync.ts';
import { createTask, deleteTask, restoreTask, setTaskStatus } from './tasks.ts';
import { ERASED, purgeExpired } from './trash.ts';
import type { Comment, WorkspaceFile } from './types.ts';
import { createWorkspace } from './workspace.ts';

const ME = '01TESTMEMBER00000000000001';
const SAM = '01TESTMEMBER00000000000002';
const SHA = 'a'.repeat(64);

function setup() {
  const ctx = testContext('dev1', undefined, ME);
  // Someone else on the same list: their comments and files are theirs.
  const sam = testContext('dev2', undefined, SAM);
  let ws: WorkspaceFile = createWorkspace(ctx);
  const inbox = inboxList(ws).id;
  const task = (title: string, parentId: string | null = null, listId = inbox) => {
    const made = createTask(ctx, ws, { title, listId, parentId });
    ws = made.workspace;
    return made.task.id;
  };
  const comment = (taskId: string, by = ctx) => {
    const made = addComment(by, ws, taskId, 'A note');
    ws = made.workspace;
    return made.comment.id;
  };
  const file = (taskId: string, by = ctx) => {
    const made = addAttachment(by, ws, {
      taskId,
      name: 'plan.pdf',
      size: 10,
      mime: 'application/pdf',
      sha256: SHA,
    });
    ws = made.workspace;
    return made.attachment.id;
  };
  return {
    ctx,
    sam,
    task,
    comment,
    file,
    get ws() {
      return ws;
    },
    set ws(next) {
      ws = next;
    },
  };
}

const commentOf = (ws: WorkspaceFile, id: string) =>
  ws.entities.comments.find((each) => each.id === id)!;
const fileOf = (ws: WorkspaceFile, id: string) =>
  ws.entities.attachments.find((each) => each.id === id)!;
const taskOf = (ws: WorkspaceFile, id: string) => ws.entities.tasks.find((each) => each.id === id)!;

/** Every field clock but deletedAt's, which is all the server lets change on someone else's. */
const otherClocks = (entity: { _hlc: Record<string, string> }) =>
  Object.fromEntries(Object.entries(entity._hlc).filter(([field]) => field !== 'deletedAt'));

describe('comments and files follow their task (audit B5)', () => {
  it("go into the Trash with it and its subtasks, at its time, anyone's, changing only deletedAt", () => {
    const s = setup();
    const parent = s.task('Plan the trip');
    const child = s.task('Book the hotel', parent);
    const mine = s.comment(parent);
    const theirs = s.comment(child, s.sam);
    const theirFile = s.file(parent, s.sam);
    const before = s.ws;
    s.ws = deleteTask(s.ctx, s.ws, parent);
    const at = taskOf(s.ws, parent).deletedAt;
    expect(at).not.toBeNull();
    expect(taskOf(s.ws, child).deletedAt).toBe(at);
    for (const id of [mine, theirs]) {
      const now = commentOf(s.ws, id);
      expect(now.deletedAt).toBe(at);
      expect(otherClocks(now)).toEqual(otherClocks(commentOf(before, id)));
      expect(now.body).toBe('A note');
    }
    expect(fileOf(s.ws, theirFile).deletedAt).toBe(at);
    expect(otherClocks(fileOf(s.ws, theirFile))).toEqual(otherClocks(fileOf(before, theirFile)));
  });

  it('come back with it, but not one its author deleted on their own, nor one erased', () => {
    const s = setup();
    const task = s.task('Plan the trip');
    const back = s.comment(task, s.sam);
    const ownDelete = s.comment(task, s.sam);
    const erased = s.comment(task);
    const file = s.file(task);
    const removed = s.file(task);
    s.ws = deleteComment(s.sam, s.ws, ownDelete);
    s.ws = removeAttachment(s.ctx, s.ws, removed);
    const ownAt = commentOf(s.ws, ownDelete).deletedAt;
    s.ws = deleteTask(s.ctx, s.ws, task);
    // Its author's earlier delete keeps its own time.
    expect(commentOf(s.ws, ownDelete).deletedAt).toBe(ownAt);
    s.ws = putEntity(
      s.ws,
      'comments',
      updateEntity(s.ctx, commentOf(s.ws, erased), { body: ERASED } as Partial<Comment>),
    );
    const before = s.ws;
    s.ws = restoreTask(s.ctx, s.ws, task);
    expect(taskOf(s.ws, task).deletedAt).toBeNull();
    expect(commentOf(s.ws, back).deletedAt).toBeNull();
    expect(otherClocks(commentOf(s.ws, back))).toEqual(otherClocks(commentOf(before, back)));
    expect(fileOf(s.ws, file).deletedAt).toBeNull();
    expect(commentOf(s.ws, ownDelete).deletedAt).toBe(ownAt);
    expect(fileOf(s.ws, removed).deletedAt).not.toBeNull();
    expect(commentOf(s.ws, erased).deletedAt).not.toBeNull();
  });

  it('leave a subtask already in the Trash with its own, and come back only with what went', () => {
    const s = setup();
    const parent = s.task('Plan the trip');
    const child = s.task('Book the hotel', parent);
    const onChild = s.comment(child);
    s.ws = deleteTask(s.ctx, s.ws, child);
    const childAt = taskOf(s.ws, child).deletedAt;
    s.ws = deleteTask(s.ctx, s.ws, parent);
    expect(commentOf(s.ws, onChild).deletedAt).toBe(childAt);
    s.ws = restoreTask(s.ctx, s.ws, parent);
    // The subtask went at another time, so it stays, and so does what is on it.
    expect(taskOf(s.ws, child).deletedAt).toBe(childAt);
    expect(commentOf(s.ws, onChild).deletedAt).toBe(childAt);
  });

  it('go with a deleted list and come back with it', () => {
    const s = setup();
    const made = createList(s.ctx, s.ws, { name: 'Trip', color: '#A7C7E7' });
    s.ws = made.workspace;
    const task = s.task('Plan the trip', null, made.list.id);
    const comment = s.comment(task, s.sam);
    const file = s.file(task);
    s.ws = deleteList(s.ctx, s.ws, made.list.id);
    const at = taskOf(s.ws, task).deletedAt;
    expect(commentOf(s.ws, comment).deletedAt).toBe(at);
    expect(fileOf(s.ws, file).deletedAt).toBe(at);
    s.ws = restoreList(s.ctx, s.ws, made.list.id);
    expect(commentOf(s.ws, comment).deletedAt).toBeNull();
    expect(fileOf(s.ws, file).deletedAt).toBeNull();
  });

  it('go with a closed task the Trash takes after the time', () => {
    const s = setup();
    const task = s.task('Old news');
    const comment = s.comment(task);
    s.ws = setTaskStatus(s.ctx, s.ws, task, 'wontdo');
    s.ws = purgeExpired(s.ctx, s.ws, Date.now() + 400 * 86_400_000);
    const gone = taskOf(s.ws, task);
    expect(gone.deletedAt).not.toBeNull();
    expect(commentOf(s.ws, comment).deletedAt).toBe(gone.deletedAt);
  });
});

describe('the next push (audit B5)', () => {
  const change = (collection: SyncChange['collection'], id: string, taskId?: string) =>
    ({
      collection,
      entity: { id, ...(taskId ? { taskId } : {}) },
    }) as unknown as SyncChange;

  it('keeps a task and its comments and files together, in order, past the cut', () => {
    const pending = [
      change('tasks', 't1'),
      change('tasks', 't2'),
      change('tasks', 't3'),
      change('comments', 'c1', 't1'),
      change('comments', 'c2', 't2'),
      change('attachments', 'a3', 't3'),
      change('comments', 'c2b', 't2'),
    ];
    const ids = (batch: SyncChange[]) => batch.map((each) => each.entity.id);
    // Cut after two: t1 and t2 take theirs along; t3 and its file wait together.
    expect(ids(pushBatch(pending, 2))).toEqual(['t1', 't2', 'c1', 'c2', 'c2b']);
    expect(ids(pushBatch(pending, 100))).toEqual(ids(pending));
    // Never past what the server takes: a task that would go over waits, with all of its own.
    expect(ids(pushBatch(pending, 2, 3))).toEqual(['t1', 'c1']);
    // One task always goes, so a sync never stalls.
    expect(ids(pushBatch(pending, 2, 1))).toEqual(['t1', 'c1']);
  });
});
