// @vitest-environment node
// What the server changes or refuses itself: admin hand-over, removing an account, making a list
// private, a viewer's edits, two people editing the same task. Runs only against a real server
// (see harness.ts).
import { describe, expect, it } from 'vitest';
import { addComment, commentsOf } from '../core/comments.ts';
import { createGroup, inviteToGroup, acceptGroupInvite } from '../core/groups.ts';
import { makePrivate, setAssignee } from '../core/sharing.ts';
import { createTask, updateTask } from '../core/tasks.ts';
import {
  admin,
  befriend,
  enabled,
  fresh,
  settle,
  sharedList,
  signIn,
  type Person,
} from './harness.ts';

const task = (person: Person, id: string) =>
  person.ws().entities.tasks.find((each) => each.id === id);
const list = (person: Person, id: string) =>
  person.ws().entities.lists.find((each) => each.id === id);

describe.skipIf(!enabled)('what the server changes or refuses', () => {
  it('an admin hands one person’s lists and groups to another, and everyone’s data stays valid', async () => {
    const boss = await admin();
    const ann = await boss.addUser(fresh('ann'));
    const bob = await boss.addUser(fresh('bob'));
    const cy = await boss.addUser(fresh('cy'));
    await befriend(ann, bob);
    await befriend(ann, cy);
    const { listId, taskId } = await sharedList(
      ann,
      [
        [bob, 'editor'],
        [cy, 'viewer'],
      ],
      'Garden',
    );
    let groupId = '';
    await ann.act((ctx, ws) => {
      const made = createGroup(ctx, ws, { name: 'Neighbours', color: '#A7C7E7' });
      groupId = made.group.id;
      return inviteToGroup(ctx, made.workspace, groupId, bob.id);
    });
    await settle(ann, bob);
    const invite = bob
      .ws()
      .entities.groupMembers.find((each) => each.groupId === groupId && each.userId === bob.id)!;
    await bob.act((ctx, ws) => acceptGroupInvite(ctx, ws, invite.id));
    await settle(ann, bob, cy);

    const moved = await boss.api.handOver(ann.id, bob.id);
    expect(moved).toBeGreaterThan(0);
    await settle(ann, bob, cy);
    for (const person of [ann, bob, cy]) {
      const shown = list(person, listId);
      expect(shown, `${person.name} still sees the list`).toBeDefined();
    }
    // Bob owns it now: he can edit in it and make it private, which Cy is told about.
    await bob.act((ctx, ws) => updateTask(ctx, ws, taskId, { title: 'Garden task, now Bob’s' }));
    await settle(ann, bob, cy);
    expect(task(ann, taskId)?.title).toBe('Garden task, now Bob’s');
    await bob.act((ctx, ws) => makePrivate(ctx, ws, listId));
    // Cy, and Ann too (it is no longer hers), are told the list went; nothing was refused.
    for (const person of [cy, ann]) {
      const told = await person.syncExpectingNotice();
      expect(told, `${person.name} is told`).toEqual({ refused: 0, lostLists: ['Garden'] });
    }
    await settle(ann, bob, cy);
  });

  it('removing an account with shared lists, assignments and comments leaves the others valid', async () => {
    const boss = await admin();
    const dee = await boss.addUser(fresh('dee'));
    const eli = await boss.addUser(fresh('eli'));
    await befriend(dee, eli);
    const mine = await sharedList(dee, [[eli, 'editor']], 'Dee list');
    const theirs = await sharedList(eli, [[dee, 'editor']], 'Eli list');
    // Eli adds a task to Dee's list too.
    let elisInDees = '';
    await eli.act((ctx, ws) => {
      const made = createTask(ctx, ws, { title: 'Eli in Dee list', listId: mine.listId });
      elisInDees = made.task.id;
      return made.workspace;
    });
    await dee.act((ctx, ws) => setAssignee(ctx, ws, theirs.taskId, `user:${dee.id}`, true));
    await dee.act((ctx, ws) => addComment(ctx, ws, theirs.taskId, 'On it').workspace);
    await settle(dee, eli);

    const removed = await boss.api.deleteUser(dee.id);
    expect(removed.ok).toBe(true);
    const now = await boss.api.removeNow(dee.id);
    expect(now.ok, 'removed at once').toBe(true);
    const notice = await eli.syncExpectingNotice();
    await settle(eli);
    // Eli keeps their own list and task; the assignment and Dee's list go or pass on, validly.
    expect(list(eli, theirs.listId)).toBeDefined();
    expect(task(eli, theirs.taskId)).toBeDefined();
    // What Dee owned goes for everyone: on a new device of Eli's and on the one Eli had open.
    const again = await signIn(eli.name, eli.password);
    const live = (person: Person, collection: 'lists' | 'tasks' | 'comments', id: string) =>
      (person.ws().entities[collection] as { id: string; deletedAt: string | null }[]).some(
        (each) => each.id === id && each.deletedAt === null,
      );
    for (const device of [again, eli]) {
      expect(live(device, 'lists', mine.listId), 'Dee’s list is gone').toBe(false);
      expect(live(device, 'tasks', mine.taskId), 'its task is gone').toBe(false);
      expect(
        commentsOf(device.ws(), theirs.taskId).map((each) => each.body),
        'Dee’s comment is gone',
      ).toEqual([]);
    }
    expect(notice?.refused ?? 0).toBe(0);
    void elisInDees;
  });

  it('a list made private leaves its members, who are told', async () => {
    const boss = await admin();
    const fay = await boss.addUser(fresh('fay'));
    const gus = await boss.addUser(fresh('gus'));
    await befriend(fay, gus);
    const { listId } = await sharedList(fay, [[gus, 'editor']], 'Secret');
    await fay.act((ctx, ws) => makePrivate(ctx, ws, listId));
    await settle(fay);
    const notice = await gus.syncExpectingNotice();
    expect(notice?.lostLists, 'Gus is told the list went').toHaveLength(1);
    expect(list(gus, listId), 'gone for Gus').toBeUndefined();
    await gus.syncNow();
  });

  it('a viewer’s edits are refused and undone; the viewer ends up where the server is', async () => {
    const boss = await admin();
    const hal = await boss.addUser(fresh('hal'));
    const ivy = await boss.addUser(fresh('ivy'));
    await befriend(hal, ivy);
    const { listId, taskId } = await sharedList(hal, [[ivy, 'viewer']], 'Look only');
    ivy.store.getState().apply((ctx, ws) => updateTask(ctx, ws, taskId, { title: 'Ivy was here' }));
    ivy.store
      .getState()
      .apply((ctx, ws) => createTask(ctx, ws, { title: 'Sneaky', listId }).workspace);
    const notice = await ivy.syncExpectingNotice();
    expect(notice?.refused, 'both refused').toBe(2);
    await settle(hal, ivy);
    expect(task(ivy, taskId)?.title).toBe('Look only task');
    expect(
      ivy.ws().entities.tasks.some((each) => each.title === 'Sneaky' && each.deletedAt === null),
    ).toBe(false);
    expect(hal.ws().entities.tasks.some((each) => each.title === 'Sneaky')).toBe(false);
  });

  it('two people editing one task at once end up with the same task', async () => {
    const boss = await admin();
    const jo = await boss.addUser(fresh('jo'));
    const ken = await boss.addUser(fresh('ken'));
    await befriend(jo, ken);
    const { taskId } = await sharedList(jo, [[ken, 'editor']], 'Both');
    jo.store
      .getState()
      .apply((ctx, ws) => updateTask(ctx, ws, taskId, { title: 'Jo’s title', priority: 3 }));
    ken.store
      .getState()
      .apply((ctx, ws) =>
        updateTask(ctx, ws, taskId, { title: 'Ken’s title', notes: 'Ken’s notes' }),
      );
    await jo.syncNow();
    await ken.syncNow();
    await settle(jo, ken);
    const a = task(jo, taskId)!;
    const b = task(ken, taskId)!;
    expect(a.title).toBe(b.title);
    expect([a.priority, a.notes]).toEqual([3, 'Ken’s notes']);
    expect(b).toEqual(a);
  });
});
