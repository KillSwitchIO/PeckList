// @vitest-environment node
// Three people on a real server: friends, a group, a shared list, a group chore. Runs only when
// PUNCHLIST_URL and PUNCHLIST_ADMIN_PASSWORD name a server (see harness.ts).
import { describe, expect, it } from 'vitest';
import { addAttachment, attachmentsOf } from '../core/attachments.ts';
import { addComment, commentsOf } from '../core/comments.ts';
import { acceptGroupInvite, createGroup, inviteToGroup } from '../core/groups.ts';
import { createList } from '../core/lists.ts';
import {
  acceptFriendship,
  assigneesOf,
  claimTask,
  sendFriendRequest,
  shareList,
} from '../core/sharing.ts';
import { createTask, setTaskStatus, updateTask } from '../core/tasks.ts';
import { hashFile } from '../app/attachments/fileStore.ts';
import { admin, enabled, fresh, settle, type Person } from './harness.ts';

const task = (person: Person, id: string) =>
  person.ws().entities.tasks.find((each) => each.id === id);

describe.skipIf(!enabled)('collaboration on a real server', () => {
  it('friends, a group, a shared list and a group chore stay in step for everyone', async () => {
    const boss = await admin();
    const ben = await boss.addUser(fresh('ben'));
    const kim = await boss.addUser(fresh('kim'));
    const sam = await boss.addUser(fresh('sam'));

    // Friends: Ben asks, Kim and Sam accept.
    await ben.act((ctx, ws) => sendFriendRequest(ctx, ws, kim.id));
    await ben.act((ctx, ws) => sendFriendRequest(ctx, ws, sam.id));
    await settle(ben, kim, sam);
    for (const friend of [kim, sam]) {
      const request = friend.ws().entities.friendships.find((each) => each.deletedAt === null);
      expect(request, `${friend.name} sees the request`).toBeDefined();
      await friend.act((ctx, ws) => acceptFriendship(ctx, ws, request!.id));
    }
    await settle(ben, kim, sam);

    // A group: Ben makes it and invites both; they accept.
    let groupId = '';
    await ben.act((ctx, ws) => {
      const made = createGroup(ctx, ws, { name: 'Household', color: '#A7C7E7' });
      groupId = made.group.id;
      return inviteToGroup(
        ctx,
        inviteToGroup(ctx, made.workspace, groupId, kim.id),
        groupId,
        sam.id,
      );
    });
    await settle(ben, kim, sam);
    for (const member of [kim, sam]) {
      const invite = member
        .ws()
        .entities.groupMembers.find(
          (each) => each.groupId === groupId && each.userId === member.id,
        );
      expect(invite, `${member.name} sees the group invite`).toBeDefined();
      await member.act((ctx, ws) => acceptGroupInvite(ctx, ws, invite!.id));
    }
    await settle(ben, kim, sam);

    // A list shared with the group, a chore on it given to the group.
    let listId = '';
    let choreId = '';
    await ben.act((ctx, ws) => {
      const list = createList(ctx, ws, { name: 'Chores', color: '#CFE3A3' });
      listId = list.list.id;
      const shared = shareList(ctx, list.workspace, listId, `group:${groupId}`, 'editor');
      const chore = createTask(ctx, shared, {
        title: 'Take out the bins',
        listId,
        assignees: [`group:${groupId}`],
        schedule: {
          start: '2030-01-07T19:00',
          end: null,
          allDay: false,
          timeZone: 'America/Chicago',
        },
        reminders: [{ before: 30 }],
      });
      choreId = chore.task.id;
      return updateTask(ctx, chore.workspace, choreId, { recurrence: 'FREQ=WEEKLY' });
    });
    await settle(ben, kim, sam);
    for (const person of [kim, sam]) {
      expect(task(person, choreId)?.title, `${person.name} sees the chore`).toBe(
        'Take out the bins',
      );
    }

    // Kim calls dibs: the group comes off for everyone.
    await kim.act((ctx, ws) => claimTask(ctx, ws, choreId));
    await settle(ben, kim, sam);
    for (const person of [ben, kim, sam]) {
      expect(assigneesOf(task(person, choreId)!), `${person.name} sees who has it`).toEqual([
        `user:${kim.id}`,
      ]);
    }

    // Sam comments and mentions Ben; Ben gets a notification.
    await sam.act(
      (ctx, ws) => addComment(ctx, ws, choreId, `@${ben.name} the blue one?`).workspace,
    );
    await settle(ben, kim, sam);
    expect(commentsOf(ben.ws(), choreId).map((each) => each.body)).toEqual([
      `@${ben.name} the blue one?`,
    ]);
    const benNotes = await ben.transport.notifications!.list();
    expect(benNotes.items.map((each) => each.kind)).toContain('mentioned');
    // Kim was given the task: Kim heard about it too.
    const kimNotes = await kim.transport.notifications!.list();
    expect(kimNotes.items.map((each) => each.kind)).toContain('assigned');

    // Kim attaches a file; Sam can download it.
    const file = new Blob(['bin day rota'], { type: 'text/plain' });
    const sha256 = await hashFile(file);
    await kim.sync.getState().blobs.put(sha256, file);
    await kim.act(
      (ctx, ws) =>
        addAttachment(ctx, ws, {
          taskId: choreId,
          name: 'rota.txt',
          size: file.size,
          mime: 'text/plain',
          sha256,
        }).workspace,
    );
    await settle(ben, kim, sam);
    expect(attachmentsOf(sam.ws(), choreId).map((each) => each.name)).toEqual(['rota.txt']);
    const downloaded = await sam.transport.files!.download(sha256);
    expect(await downloaded?.text()).toBe('bin day rota');

    // Kim does it: a done copy stays, the chore moves a week on, for everyone.
    await kim.act((ctx, ws) => setTaskStatus(ctx, ws, choreId, 'done'));
    await settle(ben, kim, sam);
    for (const person of [ben, kim, sam]) {
      expect(task(person, choreId)).toMatchObject({
        status: 'open',
        schedule: { start: '2030-01-14T19:00' },
      });
      const copies = person
        .ws()
        .entities.tasks.filter(
          (each) => each.title === 'Take out the bins' && each.status === 'done',
        );
      expect(copies, `${person.name} sees the done copy`).toHaveLength(1);
    }
  });
});
