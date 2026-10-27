import { describe, expect, it } from 'vitest';
import { sampleTask, sampleWorkspace, testContext } from '../test/fixtures.ts';
import { compareHlc } from './hlc.ts';
import { setElement } from './ops.ts';
import {
  acknowledge,
  applyRejections,
  entityClock,
  joinAccount,
  mergeRemote,
  pendingChanges,
  rekeyOwner,
  type SyncChange,
} from './sync.ts';
import { setTaskTag, updateTask } from './tasks.ts';
import type { Task, WorkspaceFile } from './types.ts';
import { createWorkspace } from './workspace.ts';

const everything = (workspace: WorkspaceFile): SyncChange[] => pendingChanges(workspace, {});

describe('entityClock', () => {
  it('takes the newest of the field clocks and the set elements', () => {
    const ctx = testContext();
    const task = sampleTask(ctx, 'L', 'Mow');
    const fieldsOnly = entityClock(task, 'tasks')!;
    const tagged = { ...task, tags: setElement(ctx, task.tags, 'G1', true) };
    expect(compareHlc(entityClock(tagged, 'tasks'), fieldsOnly)).toBeGreaterThan(0);
    // Sets count only where the collection has them.
    expect(entityClock(tagged, 'lists')).toBe(fieldsOnly);
  });
});

describe('pending changes and acks', () => {
  it('sends everything before the first sync, then only what changed', () => {
    const ctx = testContext();
    const workspace = sampleWorkspace(ctx);
    const first = everything(workspace);
    expect(first.length).toBe(
      Object.values(workspace.entities).reduce((sum, list) => sum + list.length, 0),
    );
    const acks = acknowledge({}, first);
    expect(pendingChanges(workspace, acks)).toEqual([]);

    const task = workspace.entities.tasks[0]!;
    const edited = updateTask(ctx, workspace, task.id, { title: 'Mow the lawn' });
    expect(pendingChanges(edited, acks).map((change) => change.entity.id)).toEqual([task.id]);
  });

  it('still sends an edit made while a sync was in flight', () => {
    const ctx = testContext();
    const workspace = sampleWorkspace(ctx);
    const pushed = everything(workspace);
    // The edit lands before the server's answer comes back.
    const task = workspace.entities.tasks[0]!;
    const edited = updateTask(ctx, workspace, task.id, { title: 'Mow the lawn' });
    const acks = acknowledge({}, pushed);
    expect(pendingChanges(edited, acks).map((change) => change.entity.id)).toEqual([task.id]);
  });

  it('a tag change counts as a change', () => {
    const ctx = testContext();
    const workspace = sampleWorkspace(ctx);
    const acks = acknowledge({}, everything(workspace));
    const task = workspace.entities.tasks[0]!;
    const tagged = setTaskTag(ctx, workspace, task.id, workspace.entities.tags[0]!.id, true);
    expect(pendingChanges(tagged, acks)).toHaveLength(1);
  });

  it('acks never move backwards', () => {
    const ctx = testContext();
    const task = sampleTask(ctx, 'L', 'Mow');
    const newer = { ...task, title: 'Later', _hlc: { ...task._hlc, title: ctx.clock.tick() } };
    const acks = acknowledge({}, [{ collection: 'tasks', entity: newer }]);
    expect(acknowledge(acks, [{ collection: 'tasks', entity: task }])).toEqual(acks);
  });
});

describe('mergeRemote', () => {
  it('merges server copies field by field and adds new entities', () => {
    const local = testContext('dev1');
    const remote = testContext('dev2', Date.UTC(2026, 9, 20, 17));
    const workspace = sampleWorkspace(local);
    const task = workspace.entities.tasks[0]!;
    const fromServer: Task = {
      ...task,
      priority: 3,
      _hlc: { ...task._hlc, priority: remote.clock.tick() },
    };
    const brandNew = sampleTask(remote, task.listId, 'Rake');
    const merged = mergeRemote(workspace, [
      { collection: 'tasks', entity: fromServer },
      { collection: 'tasks', entity: brandNew },
    ]);
    expect(merged.entities.tasks.find((each) => each.id === task.id)?.priority).toBe(3);
    expect(merged.entities.tasks.find((each) => each.id === brandNew.id)?.title).toBe('Rake');
    // Untouched collections stay shared.
    expect(merged.entities.lists).toBe(workspace.entities.lists);
    // So do untouched entities: what changed is told by identity (keepValid, the clock, storage).
    const other = workspace.entities.tasks[1]!;
    expect(merged.entities.tasks.find((each) => each.id === other.id)).toBe(other);
  });

  it('drops revoked ids and ignores unknown collections', () => {
    const workspace = sampleWorkspace();
    const task = workspace.entities.tasks[0]!;
    const merged = mergeRemote(
      workspace,
      [{ collection: 'widgets' as never, entity: task }],
      [task.id],
    );
    expect(merged.entities.tasks.map((each) => each.id)).not.toContain(task.id);
  });

  it('returns the same workspace when there is nothing to do', () => {
    const workspace = sampleWorkspace();
    expect(mergeRemote(workspace, [], [])).toBe(workspace);
  });
});

describe('applyRejections', () => {
  it('takes the server copy as is, or drops what has none', () => {
    const ctx = testContext();
    const workspace = sampleWorkspace(ctx);
    const [first, second] = workspace.entities.tasks;
    const edited = updateTask(ctx, workspace, first!.id, { title: 'Not allowed' });
    const result = applyRejections(
      edited,
      [first!.id, second!.id],
      [{ collection: 'tasks', entity: first! }],
    );
    expect(result.entities.tasks.map((task) => task.title)).toEqual(['Mow lawn']);
    // Nothing refused: the same workspace.
    expect(applyRejections(edited, [], [])).toBe(edited);
  });
});

describe('joining an account', () => {
  const ACCOUNT = '01JBACCT000000000000000001';

  it('re-keys every reference to the old owner', () => {
    const ctx = testContext();
    const workspace = sampleWorkspace(ctx);
    const from = workspace.owner;
    const task = workspace.entities.tasks[0]!;
    const assigned = updateTask(ctx, workspace, task.id, {
      completedBy: from,
      assignees: setElement(ctx, task.assignees, `user:${from}`, true),
    });
    const rekeyed = rekeyOwner(assigned, ACCOUNT);
    expect(rekeyed.owner).toBe(ACCOUNT);
    expect(rekeyed.entities.users[0]!.id).toBe(ACCOUNT);
    expect(rekeyed.entities.settings[0]!.userId).toBe(ACCOUNT);
    const after = rekeyed.entities.tasks.find((each) => each.id === task.id)!;
    expect(after.createdBy).toBe(ACCOUNT);
    expect(after.completedBy).toBe(ACCOUNT);
    expect(Object.keys(after.assignees)).toEqual([`user:${ACCOUNT}`]);
    expect(JSON.stringify(rekeyed)).not.toContain(from);
  });

  it('into an empty account: keeps everything, re-keyed', () => {
    const workspace = sampleWorkspace();
    const joined = joinAccount(workspace, ACCOUNT, []);
    expect(joined.entities.lists).toHaveLength(1);
    expect(joined.entities.tasks).toHaveLength(2);
    expect(joined.owner).toBe(ACCOUNT);
  });

  it("into an account with data: the account's Mess Drawer and settings win", () => {
    const device = sampleWorkspace(testContext('dev1'));
    const other = testContext('dev2', Date.UTC(2026, 9, 19), ACCOUNT);
    const account = createWorkspace(other);
    const accountTask = sampleTask(other, account.entities.lists[0]!.id, 'Paint');
    account.entities.tasks.push(accountTask);

    const joined = joinAccount(device, ACCOUNT, everything(account));
    const inbox = account.entities.lists[0]!;
    expect(joined.entities.lists.map((list) => list.id)).toEqual([inbox.id]);
    expect(joined.entities.settings.map((settings) => settings.id)).toEqual([
      account.entities.settings[0]!.id,
    ]);
    expect(joined.entities.tasks.map((task) => task.title).sort()).toEqual([
      'Call vet',
      'Mow lawn',
      'Paint',
    ]);
    expect(new Set(joined.entities.tasks.map((task) => task.listId))).toEqual(new Set([inbox.id]));
    expect(joined.entities.users.map((user) => user.id)).toEqual([ACCOUNT]);
  });

  it("the account's profile replaces the device's placeholder, even a newer one", () => {
    const server = testContext('srv', Date.UTC(2026, 9, 19), ACCOUNT);
    const profile = createWorkspace(server, { displayName: 'Ben', handle: 'ben@tasks.example' })
      .entities.users[0]!;
    // The device's workspace is made later: its placeholder carries newer clocks.
    const device = createWorkspace(testContext('dev1', Date.UTC(2026, 9, 21)));
    const joined = joinAccount(device, ACCOUNT, [{ collection: 'users', entity: profile }]);
    expect(joined.entities.users).toEqual([profile]);
  });
});
