import { describe, expect, it } from 'vitest';
import { createAjvValidator } from '../adapters/ajv-validator.ts';
import { sampleTask, testContext } from '../test/fixtures.ts';
import { putEntity } from './collections.ts';
import { acceptGroupInvite, createGroup, inviteToGroup } from './groups.ts';
import { createList } from './lists.ts';
import { createEntity } from './ops.ts';
import {
  acceptFriendship,
  assigneesOf,
  assigneeCandidates,
  assignedTo,
  canEditList,
  canClaim,
  canEditTask,
  claimTask,
  describePrincipal,
  inviteAndAssign,
  endFriendship,
  friendsOf,
  isShared,
  listMembersOf,
  makePrivate,
  removeMember,
  roleOn,
  sendFriendRequest,
  setAssignee,
  shareList,
  sharedWithMe,
} from './sharing.ts';
import type { GroupMember, User, WorkspaceFile } from './types.ts';
import { createWorkspace } from './workspace.ts';

const getTask = (workspace: WorkspaceFile, id: string) =>
  workspace.entities.tasks.find((task) => task.id === id)!;

const BEN = '01JBBEN0000000000000000001';
const SAM = '01JBSAM0000000000000000002';
const JO = '01JBJ00000000000000000000J';

function benWorld() {
  const ben = testContext('ben', undefined, BEN);
  const { workspace, list } = createList(ben, createWorkspace(ben), {
    name: 'Garden',
    color: '#CFE3A3',
  });
  return { ben, workspace, list };
}

/** The same data as Sam's device would hold it, with Sam's clock. */
const as = (userId: string) => testContext(userId.slice(4, 7).toLowerCase(), undefined, userId);

describe('friends', () => {
  it('sends, accepts and ends a friendship', () => {
    const ben = testContext('ben', undefined, BEN);
    let workspace = sendFriendRequest(ben, createWorkspace(ben), SAM);
    expect(sendFriendRequest(ben, workspace, SAM)).toBe(workspace);
    expect(sendFriendRequest(ben, workspace, BEN)).toBe(workspace);
    expect(friendsOf(workspace, BEN).map((friend) => friend.state)).toEqual(['outgoing']);
    expect(friendsOf(workspace, SAM).map((friend) => friend.state)).toEqual(['incoming']);

    const id = workspace.entities.friendships[0]!.id;
    // Only the asked side accepts.
    expect(acceptFriendship(ben, workspace, id)).toBe(workspace);
    workspace = acceptFriendship(as(SAM), workspace, id);
    expect(friendsOf(workspace, BEN)[0]!.state).toBe('accepted');

    const sam = createEntity<User>(
      ben,
      { handle: 'sam', displayName: 'Sam', avatarColor: '#F4B6C2', homeServer: 'local' },
      SAM,
    );
    expect(friendsOf(putEntity(workspace, 'users', sam), BEN)[0]!.user?.displayName).toBe('Sam');

    expect(friendsOf(endFriendship(as(SAM), workspace, id), BEN)).toEqual([]);
  });
});

describe('list sharing', () => {
  it('a list an admin handed over belongs to its new owner, not its creator', () => {
    const { ben, workspace, list } = benWorld();
    const shared = shareList(ben, workspace, list.id, `user:${SAM}`, 'editor');
    // What the server sends after Admin > hand over: ownerId, and Ben kept on as an editor.
    const handed = putEntity(shared, 'lists', {
      ...shared.entities.lists.find((each) => each.id === list.id)!,
      ownerId: SAM,
    });
    const kept = shareList(as(SAM), handed, list.id, `user:${BEN}`, 'editor');
    expect(roleOn(kept, SAM, list.id)).toBe('owner');
    expect(roleOn(kept, BEN, list.id)).toBe('editor');
    expect(createAjvValidator().validate(kept).errors).toEqual([]);
  });

  it('shares a list in roles that decide who may edit', () => {
    const { ben, workspace, list } = benWorld();
    expect(roleOn(workspace, BEN, list.id)).toBe('owner');
    expect(isShared(workspace, list)).toBe(false);

    let shared = shareList(ben, workspace, list.id, `user:${SAM}`, 'editor');
    shared = shareList(ben, shared, list.id, `user:${JO}`, 'viewer');
    const garden = shared.entities.lists.find((each) => each.id === list.id)!;
    expect(garden.visibility).toBe('shared');
    expect(isShared(shared, garden)).toBe(true);
    expect(roleOn(shared, SAM, list.id)).toBe('editor');
    expect(canEditList(shared, SAM, list.id)).toBe(true);
    expect(canEditList(shared, JO, list.id)).toBe(false);

    // A new role replaces the old one; no second membership.
    const promoted = shareList(ben, shared, list.id, `user:${JO}`, 'editor');
    expect(listMembersOf(promoted, list.id)).toHaveLength(2);
    expect(roleOn(promoted, JO, list.id)).toBe('editor');
    // Only owners share.
    expect(shareList(as(SAM), shared, list.id, `user:${JO}`, 'owner')).toBe(shared);
  });

  it('the Mess Drawer is never shared', () => {
    const { ben, workspace } = benWorld();
    const inbox = workspace.entities.lists.find((list) => list.isInbox)!;
    expect(shareList(ben, workspace, inbox.id, `user:${SAM}`, 'editor')).toBe(workspace);
  });

  it('members leave or are removed; making it private removes everyone', () => {
    const { ben, workspace, list } = benWorld();
    let shared = shareList(ben, workspace, list.id, `user:${SAM}`, 'editor');
    shared = shareList(ben, shared, list.id, `user:${JO}`, 'editor');
    const [samMember, joMember] = listMembersOf(shared, list.id);
    // Sam may leave, but not remove Jo.
    expect(removeMember(as(SAM), shared, joMember!.id)).toBe(shared);
    const left = removeMember(as(SAM), shared, samMember!.id);
    expect(roleOn(left, SAM, list.id)).toBeNull();

    const closed = makePrivate(ben, shared, list.id);
    expect(listMembersOf(closed, list.id)).toEqual([]);
    expect(closed.entities.lists.find((each) => each.id === list.id)!.visibility).toBe('private');
  });

  it('groups count for the people in them', () => {
    const { ben, workspace, list } = benWorld();
    const member = createEntity<GroupMember>(ben, {
      groupId: '01JBGR0000000000000000000G',
      userId: SAM,
      joinedAt: new Date().toISOString(),
      state: 'active',
    });
    const withGroup: WorkspaceFile = putEntity(workspace, 'groupMembers', member);
    const shared = shareList(ben, withGroup, list.id, 'group:01JBGR0000000000000000000G', 'viewer');
    expect(roleOn(shared, SAM, list.id)).toBe('viewer');
  });
});

describe('assignee choices', () => {
  it('lists my groups with their members under them, each person once', () => {
    const { ben, workspace, list } = benWorld();
    const task = sampleTask(ben, list.id, 'Take out bins');
    const kim = '01JBK1M0000000000000000003';
    const { workspace: grouped, group } = createGroup(ben, putEntity(workspace, 'tasks', task), {
      name: 'Household',
      color: '#A7C7E7',
    });
    let next = grouped;
    for (const userId of [kim, SAM]) {
      next = inviteToGroup(ben, next, group.id, userId);
      const invite = next.entities.groupMembers.find((member) => member.userId === userId)!;
      next = acceptGroupInvite(as(userId), next, invite.id);
    }
    // Sam is also a friend, but shows once: under the group.
    next = sendFriendRequest(ben, next, SAM);
    next = acceptFriendship(as(SAM), next, next.entities.friendships[0]!.id);
    next = shareList(ben, next, list.id, `user:${JO}`, 'editor');
    const options = assigneeCandidates(next, BEN, task);
    expect(options.map((each) => [each.principal, each.depth])).toEqual([
      [`user:${BEN}`, 0],
      [`group:${group.id}`, 0],
      [`user:${kim}`, 1],
      [`user:${SAM}`, 1],
      [`user:${JO}`, 0],
    ]);
    // Assigning one member directly needs no dibs.
    next = setAssignee(ben, next, task.id, `user:${kim}`, true);
    expect(assignedTo(next, kim).map((each) => each.title)).toEqual(['Take out bins']);
  });
});

describe('invite on assign', () => {
  it('assigns friends at once and invites anyone else', () => {
    const { ben, workspace, list } = benWorld();
    const task = sampleTask(ben, list.id, 'Paint fence');
    let next = inviteAndAssign(ben, putEntity(workspace, 'tasks', task), task.id, SAM);
    const invite = `invite:${SAM}:${BEN}`;
    expect(assigneesOf(getTask(next, task.id))).toEqual([invite]);
    expect(friendsOf(next, BEN).map((friend) => friend.state)).toEqual(['outgoing']);
    expect(describePrincipal(next, invite).pending).toBe(true);
    // The invite key is part of the file format (a device must be able to open it again).
    expect(createAjvValidator().validate(next).errors).toEqual([]);
    // Waiting on Sam: nothing is assigned to Sam yet.
    expect(assignedTo(next, SAM)).toEqual([]);

    next = acceptFriendship(as(SAM), next, next.entities.friendships[0]!.id);
    next = inviteAndAssign(ben, next, task.id, SAM);
    expect(assigneesOf(getTask(next, task.id))).toContain(`user:${SAM}`);
  });
});

describe('dibs', () => {
  it('a group member takes a group task for themselves', () => {
    const { ben, workspace, list } = benWorld();
    const task = sampleTask(ben, list.id, 'Take out bins');
    const group = '01JBGR0000000000000000000G';
    const member = createEntity<GroupMember>(ben, {
      groupId: group,
      userId: SAM,
      joinedAt: new Date().toISOString(),
      state: 'active',
    });
    let next = putEntity(putEntity(workspace, 'tasks', task), 'groupMembers', member);
    next = setAssignee(ben, next, task.id, `group:${group}`, true);
    expect(canClaim(next, SAM, getTask(next, task.id))).toBe(true);
    // Not in the group: nothing to claim.
    expect(canClaim(next, JO, getTask(next, task.id))).toBe(false);
    expect(claimTask(as(JO), next, task.id)).toBe(next);

    next = claimTask(as(SAM), next, task.id);
    expect(assigneesOf(getTask(next, task.id))).toEqual([`user:${SAM}`]);
    expect(canClaim(next, SAM, getTask(next, task.id))).toBe(false);
  });
});

describe('editing tasks', () => {
  it('follows the list role, or an assignment', () => {
    const { ben, workspace, list } = benWorld();
    const task = sampleTask(ben, list.id, 'Fix fence');
    let next = putEntity(workspace, 'tasks', task);
    // A list that is not shared is mine on this device.
    expect(canEditTask(next, BEN, task)).toBe(true);
    next = shareList(ben, next, list.id, `user:${SAM}`, 'editor');
    next = shareList(ben, next, list.id, `user:${JO}`, 'viewer');
    expect(canEditTask(next, SAM, task)).toBe(true);
    expect(canEditTask(next, JO, task)).toBe(false);
    next = setAssignee(ben, next, task.id, `user:${JO}`, true);
    expect(canEditTask(next, JO, getTask(next, task.id))).toBe(true);

    // Assigned from a list this device does not have.
    const withoutList: WorkspaceFile = {
      ...next,
      entities: {
        ...next.entities,
        lists: next.entities.lists.filter((each) => each.id !== list.id),
      },
    };
    expect(canEditTask(withoutList, JO, getTask(next, task.id))).toBe(true);
    expect(canEditTask(withoutList, SAM, getTask(next, task.id))).toBe(false);
  });
});

describe('assignment', () => {
  it('assigns and lists what is assigned to me', () => {
    const { ben, workspace, list } = benWorld();
    const task = sampleTask(ben, list.id, 'Fix fence');
    let next = putEntity(workspace, 'tasks', task);
    next = setAssignee(ben, next, task.id, `user:${SAM}`, true);
    expect(assignedTo(next, SAM).map((each) => each.title)).toEqual(['Fix fence']);
    expect(assignedTo(next, BEN)).toEqual([]);
    expect(sharedWithMe(next, SAM).map((each) => each.title)).toEqual(['Fix fence']);
    expect(sharedWithMe(next, BEN)).toEqual([]);
    next = setAssignee(ben, next, task.id, `user:${SAM}`, false);
    expect(assignedTo(next, SAM)).toEqual([]);
  });

  it('offers me, my friends, the people on the list and anyone already assigned', () => {
    const { ben, workspace, list } = benWorld();
    const task = sampleTask(ben, list.id, 'Fix fence');
    let next = putEntity(workspace, 'tasks', task);
    next = putEntity(
      next,
      'users',
      createEntity<User>(
        ben,
        { handle: 'sam', displayName: 'Sam', avatarColor: '#F4B6C2', homeServer: 'local' },
        SAM,
      ),
    );
    // Only me while nobody else is around.
    expect(assigneeCandidates(next, BEN, task).map((each) => each.principal)).toEqual([
      `user:${BEN}`,
    ]);
    next = sendFriendRequest(ben, next, SAM);
    // A request someone has not accepted does not count.
    expect(assigneeCandidates(next, BEN, task)).toHaveLength(1);
    next = acceptFriendship(as(SAM), next, next.entities.friendships[0]!.id);
    next = shareList(ben, next, list.id, `user:${JO}`, 'editor');
    next = setAssignee(ben, next, task.id, 'group:01JBGR0000000000000000000G', true);
    const candidates = assigneeCandidates(next, BEN, getTask(next, task.id));
    expect(candidates.map((each) => each.principal)).toEqual([
      `user:${BEN}`,
      // Groups and people without a profile show a short id until they sync.
      'group:01JBGR0000000000000000000G',
      `user:${JO}`,
      `user:${SAM}`,
    ]);
    expect(candidates.find((each) => each.principal === `user:${SAM}`)!.name).toBe('Sam');

    // On Jo's side, the list's owner is offered too.
    expect(
      assigneeCandidates(next, JO, getTask(next, task.id)).map((each) => each.principal),
    ).toContain(`user:${BEN}`);
  });
});
