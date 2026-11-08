import { describe, expect, it } from 'vitest';
import { createAjvValidator } from '../adapters/ajv-validator.ts';
import { sampleTask, testContext } from '../test/fixtures.ts';
import { isLive, putEntity } from './collections.ts';
import { acceptGroupInvite, createGroup, inviteToGroup } from './groups.ts';
import { createList, deleteList, inboxList, restoreList } from './lists.ts';
import { createEntity, type OpContext } from './ops.ts';
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
  mySharesWith,
  removeMember,
  roleOn,
  sendFriendRequest,
  setAssignee,
  shareList,
  sharedWithMe,
  unfriend,
} from './sharing.ts';
import { createTask, deleteTask, restoreTask } from './tasks.ts';
import type { Friendship, GroupMember, User, WorkspaceFile } from './types.ts';
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

  it('ending a friendship ends every live row between the two, and only those', () => {
    const ben = testContext('ben', undefined, BEN);
    // Two requests made offline, one each way, that both reached the device; and one with Jo.
    let workspace = sendFriendRequest(ben, createWorkspace(ben), SAM);
    const second = createEntity<Friendship>(as(SAM), { userA: SAM, userB: BEN, state: 'pending' });
    workspace = putEntity(workspace, 'friendships', second);
    workspace = sendFriendRequest(ben, workspace, JO);
    const first = workspace.entities.friendships[0]!.id;
    workspace = acceptFriendship(as(SAM), workspace, first);
    expect(friendsOf(workspace, BEN).filter((friend) => friend.userId === SAM)).toHaveLength(2);

    const ended = endFriendship(ben, workspace, first);
    expect(friendsOf(ended, BEN).map((friend) => friend.userId)).toEqual([JO]);
    // Unfriend goes the same way.
    const sam = friendsOf(workspace, BEN).find((friend) => friend.state === 'accepted')!;
    const unfriended = unfriend(ben, workspace, sam, false);
    expect(friendsOf(unfriended, BEN).map((friend) => friend.userId)).toEqual([JO]);
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

  describe('unfriending', () => {
    const friendship = (workspace: WorkspaceFile, ctx: OpContext) => {
      const asked = sendFriendRequest(ctx, workspace, SAM);
      return { workspace: asked, friendship: asked.entities.friendships.at(-1)! };
    };

    it('takes back what is in the Trash too, so restoring it shares nothing', () => {
      const { ben, workspace, list } = benWorld();
      const asked = friendship(workspace, ben);
      const shared = shareList(ben, asked.workspace, list.id, `user:${SAM}`, 'editor');
      const made = createTask(ben, shared, { title: 'Binned', listId: inboxList(shared).id });
      const assigned = setAssignee(ben, made.workspace, made.task.id, `user:${SAM}`, true);
      const binned = deleteTask(ben, deleteList(ben, assigned, list.id), made.task.id);
      expect(mySharesWith(binned, BEN, SAM).members).toHaveLength(1);
      expect(mySharesWith(binned, BEN, SAM).tasks).toHaveLength(1);

      const after = unfriend(ben, binned, { friendship: asked.friendship, userId: SAM }, true);
      const back = restoreTask(ben, restoreList(ben, after, list.id), made.task.id);
      expect(roleOn(back, SAM, list.id)).toBeNull();
      expect(assigneesOf(getTask(back, made.task.id)!)).toEqual([]);
    });

    it('takes back my lists and tasks in one change, and ends the friendship', () => {
      const { ben, workspace, list } = benWorld();
      const asked = friendship(workspace, ben);
      let world = shareList(ben, asked.workspace, list.id, `user:${SAM}`, 'editor');
      world = shareList(ben, world, list.id, `user:${JO}`, 'editor');
      const made = createTask(ben, world, { title: 'On the list', listId: list.id });
      world = setAssignee(ben, made.workspace, made.task.id, `user:${SAM}`, true);
      world = setAssignee(ben, world, made.task.id, `user:${JO}`, true);
      const drawer = createTask(ben, world, { title: 'In my drawer', listId: inboxList(world).id });
      world = setAssignee(ben, drawer.workspace, drawer.task.id, `user:${SAM}`, true);
      expect(mySharesWith(world, BEN, SAM).members).toHaveLength(1);
      expect(mySharesWith(world, BEN, SAM).tasks).toHaveLength(2);

      const after = unfriend(ben, world, { friendship: asked.friendship, userId: SAM }, true);
      expect(roleOn(after, SAM, list.id)).toBeNull();
      expect(assigneesOf(getTask(after, made.task.id)!)).toEqual([`user:${JO}`]);
      expect(assigneesOf(getTask(after, drawer.task.id)!)).toEqual([]);
      expect(mySharesWith(after, BEN, SAM)).toEqual({ members: [], tasks: [] });
      expect(isLive(after.entities.friendships.find((f) => f.id === asked.friendship.id)!)).toBe(
        false,
      );
      // Someone else on the list keeps their place.
      expect(roleOn(after, JO, list.id)).toBe('editor');
    });

    it('leaves the shares alone when asked to', () => {
      const { ben, workspace, list } = benWorld();
      const asked = friendship(workspace, ben);
      let world = shareList(ben, asked.workspace, list.id, `user:${SAM}`, 'editor');
      const made = createTask(ben, world, { title: 'On the list', listId: list.id });
      world = setAssignee(ben, made.workspace, made.task.id, `user:${SAM}`, true);

      const after = unfriend(ben, world, { friendship: asked.friendship, userId: SAM }, false);
      expect(roleOn(after, SAM, list.id)).toBe('editor');
      expect(assigneesOf(getTask(after, made.task.id)!)).toEqual([`user:${SAM}`]);
      expect(isLive(after.entities.friendships.find((f) => f.id === asked.friendship.id)!)).toBe(
        false,
      );
    });

    it('does not touch lists they own, or that I only joined', () => {
      const { ben, workspace } = benWorld();
      const asked = friendship(workspace, ben);
      const sam = as(SAM);
      // Sam's list, shared with me: I am on it, and so is Sam's task on it.
      const theirs = createList(sam, asked.workspace, { name: 'Theirs', color: '#CFE3A3' });
      let world = shareList(sam, theirs.workspace, theirs.list.id, `user:${BEN}`, 'owner');
      const task = createTask(sam, world, { title: 'Sam has this', listId: theirs.list.id });
      world = setAssignee(sam, task.workspace, task.task.id, `user:${SAM}`, true);
      // Jo's list, with both of us on it.
      const jo = as(JO);
      const other = createList(jo, world, { name: 'Jo', color: '#CFE3A3' });
      world = shareList(jo, other.workspace, other.list.id, `user:${BEN}`, 'editor');
      world = shareList(jo, world, other.list.id, `user:${SAM}`, 'editor');

      expect(mySharesWith(world, BEN, SAM)).toEqual({ members: [], tasks: [] });
      const after = unfriend(ben, world, { friendship: asked.friendship, userId: SAM }, true);
      expect(roleOn(after, BEN, theirs.list.id)).toBe('owner');
      expect(roleOn(after, SAM, other.list.id)).toBe('editor');
      expect(assigneesOf(getTask(after, task.task.id)!)).toEqual([`user:${SAM}`]);
    });
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

  it('assigning a member takes the task off the group; someone outside it leaves the group on', () => {
    const { ben, workspace, list } = benWorld();
    const task = sampleTask(ben, list.id, 'Mow the lawn');
    const group = '01JBGR0000000000000000000G';
    const member = createEntity<GroupMember>(ben, {
      groupId: group,
      userId: SAM,
      joinedAt: new Date().toISOString(),
      state: 'active',
    });
    let next = putEntity(putEntity(workspace, 'tasks', task), 'groupMembers', member);
    next = setAssignee(ben, next, task.id, `group:${group}`, true);
    next = setAssignee(ben, next, task.id, `user:${JO}`, true);
    expect(assigneesOf(getTask(next, task.id)).sort()).toEqual(
      [`group:${group}`, `user:${JO}`].sort(),
    );
    next = setAssignee(ben, next, task.id, `user:${SAM}`, true);
    expect(assigneesOf(getTask(next, task.id)).sort()).toEqual(
      [`user:${JO}`, `user:${SAM}`].sort(),
    );
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
