// @vitest-environment node
// Edges of sharing on a real server: tasks moving out of a shared list, someone leaving a group
// or a list, subtasks a member adds, a viewer's files, a shared list deleted. Runs only against
// a real server (see harness.ts).
import { describe, expect, it } from 'vitest';
import { hashFile } from '../app/attachments/fileStore.ts';
import { addAttachment } from '../core/attachments.ts';
import { acceptGroupInvite, createGroup, inviteToGroup, removeFromGroup } from '../core/groups.ts';
import { createList, deleteList, inboxList } from '../core/lists.ts';
import { listMembersOf, removeMember, shareList } from '../core/sharing.ts';
import { createTask, moveTask } from '../core/tasks.ts';
import { admin, befriend, enabled, fresh, settle, sharedList, type Person } from './harness.ts';

const liveTask = (person: Person, id: string) =>
  person.ws().entities.tasks.some((each) => each.id === id && each.deletedAt === null);
const liveList = (person: Person, id: string) =>
  person.ws().entities.lists.some((each) => each.id === id && each.deletedAt === null);

describe.skipIf(!enabled)('edges of sharing', () => {
  it('a task moved out of a shared list into a private one leaves the others', async () => {
    const boss = await admin();
    const lou = await boss.addUser(fresh('lou'));
    const max = await boss.addUser(fresh('max'));
    await befriend(lou, max);
    const { taskId } = await sharedList(lou, [[max, 'editor']], 'Shared');
    let subId = '';
    await max.act((ctx, ws) => {
      const sub = createTask(ctx, ws, {
        title: 'Max’s subtask',
        listId: ws.entities.tasks.find((each) => each.id === taskId)!.listId,
        parentId: taskId,
      });
      subId = sub.task.id;
      return sub.workspace;
    });
    await settle(lou, max);
    expect(liveTask(lou, subId), 'Lou sees Max’s subtask').toBe(true);

    await lou.act((ctx, ws) => moveTask(ctx, ws, taskId, { listId: inboxList(ws).id }));
    const notice = await max.syncExpectingNotice();
    await settle(lou, max);
    expect(liveTask(max, taskId), 'gone for Max').toBe(false);
    expect(liveTask(max, subId), 'its subtask too').toBe(false);
    expect(liveTask(lou, taskId), 'Lou keeps it').toBe(true);
    expect(liveTask(lou, subId), 'with Max’s subtask').toBe(true);
    expect(notice?.refused ?? 0).toBe(0);
  });

  it('someone who leaves a group, or a list, loses what came with it', async () => {
    const boss = await admin();
    const ned = await boss.addUser(fresh('ned'));
    const ola = await boss.addUser(fresh('ola'));
    const pat = await boss.addUser(fresh('pat'));
    await befriend(ned, ola);
    await befriend(ned, pat);
    let groupId = '';
    let groupListId = '';
    await ned.act((ctx, ws) => {
      const group = createGroup(ctx, ws, { name: 'Club', color: '#A7C7E7' });
      groupId = group.group.id;
      const list = createList(ctx, inviteToGroup(ctx, group.workspace, groupId, ola.id), {
        name: 'Club list',
        color: '#CFE3A3',
      });
      groupListId = list.list.id;
      return shareList(ctx, list.workspace, groupListId, `group:${groupId}`, 'editor');
    });
    await settle(ned, ola);
    const invite = ola
      .ws()
      .entities.groupMembers.find((each) => each.groupId === groupId && each.userId === ola.id)!;
    await ola.act((ctx, ws) => acceptGroupInvite(ctx, ws, invite.id));
    await settle(ned, ola);
    expect(liveList(ola, groupListId), 'Ola sees the group’s list').toBe(true);

    // Ned takes Ola out of the group: the list goes for Ola.
    await ned.act((ctx, ws) => removeFromGroup(ctx, ws, invite.id));
    const told = await ola.syncExpectingNotice();
    await settle(ned, ola);
    expect(liveList(ola, groupListId), 'gone for Ola').toBe(false);
    // Taken out by someone else: Ola is told.
    expect(told).toEqual({ refused: 0, lostLists: ['Club list'] });

    // Back in, then Ola leaves the group herself: the list goes without a notice.
    await ned.act((ctx, ws) => inviteToGroup(ctx, ws, groupId, ola.id));
    await settle(ned, ola);
    const again = ola
      .ws()
      .entities.groupMembers.find(
        (each) => each.groupId === groupId && each.userId === ola.id && each.deletedAt === null,
      )!;
    await ola.act((ctx, ws) => acceptGroupInvite(ctx, ws, again.id));
    await settle(ned, ola);
    expect(liveList(ola, groupListId), 'Ola sees it again').toBe(true);
    await ola.act((ctx, ws) => removeFromGroup(ctx, ws, again.id));
    await settle(ned, ola);
    expect(liveList(ola, groupListId), 'gone after leaving').toBe(false);

    // Pat leaves a list shared directly.
    const direct = await sharedList(ned, [[pat, 'editor']], 'Direct');
    const mine = listMembersOf(pat.ws(), direct.listId).find(
      (each) => each.principal === `user:${pat.id}`,
    )!;
    // Leaving on purpose is no news: no notice (act checks there is none).
    await pat.act((ctx, ws) => removeMember(ctx, ws, mine.id));
    await settle(ned, pat);
    expect(liveList(pat, direct.listId), 'gone for Pat').toBe(false);
    expect(liveList(ned, direct.listId), 'Ned keeps it').toBe(true);
  });

  it('a viewer downloads a file on a shared list; a deleted shared list goes for its members', async () => {
    const boss = await admin();
    const quin = await boss.addUser(fresh('quin'));
    const rae = await boss.addUser(fresh('rae'));
    await befriend(quin, rae);
    const { listId, taskId } = await sharedList(quin, [[rae, 'viewer']], 'Photos');
    const file = new Blob(['photo bytes'], { type: 'image/jpeg' });
    const sha256 = await hashFile(file);
    await quin.sync.getState().blobs.put(sha256, file);
    await quin.act(
      (ctx, ws) =>
        addAttachment(ctx, ws, {
          taskId,
          name: 'p.jpg',
          size: file.size,
          mime: 'image/jpeg',
          sha256,
        }).workspace,
    );
    await settle(quin, rae);
    expect(await (await rae.transport.files!.download(sha256))?.text()).toBe('photo bytes');

    await quin.act((ctx, ws) => deleteList(ctx, ws, listId));
    await rae.syncExpectingNotice();
    await settle(quin, rae);
    expect(liveList(rae, listId)).toBe(false);
    expect(liveTask(rae, taskId)).toBe(false);
  });
});
