// Sharing as the app sees it (spec: Sharing & Permissions): friends, list members and roles,
// assignment. The server has the final say (it refuses what a user may not do and sends its copy
// back); these helpers follow the same rules so the app only offers what will stick.

import { getEntity, isLive, putEntity } from './collections.ts';
import {
  createEntity,
  members,
  setElement,
  softDelete,
  updateEntity,
  type OpContext,
} from './ops.ts';
import type { Friendship, Id, List, ListMember, Task, User, WorkspaceFile } from './types.ts';

export type Role = ListMember['role'];

const RANK: Record<Role, number> = { owner: 3, editor: 2, viewer: 1 };

// People ----------------------------------------------------------------------------------------

export interface Friend {
  user: User | null;
  userId: Id;
  friendship: Friendship;
  /** `accepted`; `incoming` (they asked me); `outgoing` (I asked them). */
  state: 'accepted' | 'incoming' | 'outgoing';
}

/** Friends and open requests, people with a profile first, by name. */
export function friendsOf(workspace: WorkspaceFile, me: Id): Friend[] {
  const users = new Map(workspace.entities.users.map((user) => [user.id, user]));
  return workspace.entities.friendships
    .filter(isLive)
    .filter((friendship) => friendship.userA === me || friendship.userB === me)
    .map((friendship): Friend => {
      const other = friendship.userA === me ? friendship.userB : friendship.userA;
      const state =
        friendship.state === 'accepted'
          ? 'accepted'
          : friendship.userB === me
            ? 'incoming'
            : 'outgoing';
      return { user: users.get(other) ?? null, userId: other, friendship, state };
    })
    .sort((a, b) => nameOf(a.user, a.userId).localeCompare(nameOf(b.user, b.userId)));
}

/** A person's name to show: display name, else handle, else a short id. */
export function nameOf(user: User | null | undefined, id: Id): string {
  return user?.displayName || user?.handle || `${id.slice(0, 6)}…`;
}

/** Ask someone to be friends (from a lookup). Nothing happens if a live friendship exists. */
export function sendFriendRequest(
  ctx: OpContext,
  workspace: WorkspaceFile,
  other: Id,
): WorkspaceFile {
  const existing = workspace.entities.friendships.find(
    (each) =>
      isLive(each) &&
      ((each.userA === ctx.userId && each.userB === other) ||
        (each.userA === other && each.userB === ctx.userId)),
  );
  if (existing || other === ctx.userId) return workspace;
  const friendship = createEntity<Friendship>(ctx, {
    userA: ctx.userId,
    userB: other,
    state: 'pending',
  });
  return putEntity(workspace, 'friendships', friendship);
}

export function acceptFriendship(ctx: OpContext, workspace: WorkspaceFile, id: Id): WorkspaceFile {
  const friendship = getEntity(workspace, 'friendships', id);
  if (!friendship || friendship.userB !== ctx.userId || friendship.state === 'accepted')
    return workspace;
  return putEntity(workspace, 'friendships', updateEntity(ctx, friendship, { state: 'accepted' }));
}

/** Decline a request, take one back, or unfriend. */
export function endFriendship(ctx: OpContext, workspace: WorkspaceFile, id: Id): WorkspaceFile {
  const friendship = getEntity(workspace, 'friendships', id);
  if (!friendship) return workspace;
  return putEntity(workspace, 'friendships', softDelete(ctx, friendship));
}

// Lists -----------------------------------------------------------------------------------------

/** Live members of a list. */
export function listMembersOf(workspace: WorkspaceFile, listId: Id): ListMember[] {
  return workspace.entities.listMembers.filter(
    (member) => isLive(member) && member.listId === listId,
  );
}

/** A user's role on a list (null: none): its creator owns it; members get their best role. */
export function roleOn(workspace: WorkspaceFile, me: Id, listId: Id): Role | null {
  const list = getEntity(workspace, 'lists', listId);
  if (!list) return null;
  if (list.createdBy === me) return 'owner';
  if (list.visibility !== 'shared') return null;
  const groups = new Set(
    workspace.entities.groupMembers
      .filter((member) => isLive(member) && member.userId === me && member.state === 'active')
      .map((member) => `group:${member.groupId}`),
  );
  let best: Role | null = null;
  for (const member of listMembersOf(workspace, listId)) {
    if (member.principal !== `user:${me}` && !groups.has(member.principal)) continue;
    if (best === null || RANK[member.role] > RANK[best]) best = member.role;
  }
  return best;
}

export function canEditList(workspace: WorkspaceFile, me: Id, listId: Id): boolean {
  const role = myRole(workspace, me, listId);
  return role === 'owner' || role === 'editor';
}

/**
 * My role on a list on this device. A list that is not shared is mine (only its owner gets it),
 * which also covers lists made before signing in; a list this device does not have is nobody's.
 */
export function myRole(workspace: WorkspaceFile, me: Id, listId: Id): Role | null {
  const list = getEntity(workspace, 'lists', listId);
  if (!list) return null;
  return list.visibility === 'shared' ? roleOn(workspace, me, listId) : 'owner';
}

/** Whether I may change a task: its list lets me edit, or it is assigned to me (as the server rules). */
export function canEditTask(workspace: WorkspaceFile, me: Id, task: Task): boolean {
  return (
    canEditList(workspace, me, task.listId) ||
    principalsOf(workspace, me).some((principal) => assigneesOf(task).includes(principal))
  );
}

/** Me and the groups I am an active member of, as principals. */
function principalsOf(workspace: WorkspaceFile, me: Id): string[] {
  return [
    `user:${me}`,
    ...workspace.entities.groupMembers
      .filter((member) => isLive(member) && member.userId === me && member.state === 'active')
      .map((member) => `group:${member.groupId}`),
  ];
}

/** Whether a list is shared with anyone (the sidebar marks it). */
export function isShared(workspace: WorkspaceFile, list: List): boolean {
  return list.visibility === 'shared' && listMembersOf(workspace, list.id).length > 0;
}

/**
 * Share a list with someone (`user:<id>` or `group:<id>`) in a role: the list becomes shared and
 * the member is added, or their role changes. Owners only; the Mess Drawer stays private.
 */
export function shareList(
  ctx: OpContext,
  workspace: WorkspaceFile,
  listId: Id,
  principal: string,
  role: Role,
): WorkspaceFile {
  const list = getEntity(workspace, 'lists', listId);
  if (!list || list.isInbox || roleOn(workspace, ctx.userId, listId) !== 'owner') return workspace;
  let next = workspace;
  if (list.visibility !== 'shared') {
    next = putEntity(next, 'lists', updateEntity(ctx, list, { visibility: 'shared' }));
  }
  const existing = listMembersOf(next, listId).find((member) => member.principal === principal);
  const member = existing
    ? updateEntity(ctx, existing, { role })
    : createEntity<ListMember>(ctx, { listId, principal, role });
  return putEntity(next, 'listMembers', member);
}

/** Take someone off a list (owners), or leave it yourself. */
export function removeMember(
  ctx: OpContext,
  workspace: WorkspaceFile,
  memberId: Id,
): WorkspaceFile {
  const member = getEntity(workspace, 'listMembers', memberId);
  if (!member) return workspace;
  const own = member.principal === `user:${ctx.userId}`;
  if (!own && roleOn(workspace, ctx.userId, member.listId) !== 'owner') return workspace;
  return putEntity(workspace, 'listMembers', softDelete(ctx, member));
}

/** Make a shared list private again: every member loses it. */
export function makePrivate(ctx: OpContext, workspace: WorkspaceFile, listId: Id): WorkspaceFile {
  const list = getEntity(workspace, 'lists', listId);
  if (!list || roleOn(workspace, ctx.userId, listId) !== 'owner') return workspace;
  const at = new Date(ctx.now()).toISOString();
  let next = putEntity(workspace, 'lists', updateEntity(ctx, list, { visibility: 'private' }));
  for (const member of listMembersOf(next, listId)) {
    next = putEntity(next, 'listMembers', softDelete(ctx, member, at));
  }
  return next;
}

// Tasks -----------------------------------------------------------------------------------------

/** Assign a task to someone (`user:<id>` or `group:<id>`) or take the assignment off. */
export function setAssignee(
  ctx: OpContext,
  workspace: WorkspaceFile,
  taskId: Id,
  principal: string,
  assigned: boolean,
): WorkspaceFile {
  const task = getEntity(workspace, 'tasks', taskId);
  if (!task) return workspace;
  const assignees = setElement(ctx, task.assignees, principal, assigned);
  if (assignees === task.assignees) return workspace;
  return putEntity(workspace, 'tasks', updateEntity(ctx, task, { assignees }));
}

/** Who a task is assigned to: `user:<id>` and `group:<id>` principals. */
export function assigneesOf(task: Task): string[] {
  return members(task.assignees);
}

export interface Assignee {
  principal: string;
  /** The person's profile (null for a group or someone not synced yet) */
  user: User | null;
  name: string;
  color: string;
}

const NO_COLOR = '#B8BCC4';

/** A principal as the app shows it: a person's name and color, or a group's. */
export function describePrincipal(workspace: WorkspaceFile, principal: string): Assignee {
  const id = principal.slice(principal.indexOf(':') + 1);
  if (principal.startsWith('group:')) {
    const group = getEntity(workspace, 'groups', id);
    return {
      principal,
      user: null,
      name: group?.name ?? nameOf(null, id),
      color: group?.color ?? NO_COLOR,
    };
  }
  const user = getEntity(workspace, 'users', id) ?? null;
  return { principal, user, name: nameOf(user, id), color: user?.avatarColor ?? NO_COLOR };
}

/** A choice in the assignee picker; group members sit under their group (`depth` 1). */
export interface AssigneeOption extends Assignee {
  depth: 0 | 1;
}

/**
 * Who a task may be assigned to, in picker order: me; each of my groups followed by its active
 * members (assign the chore to the group, or straight to one person in it); then my friends, the
 * people on its list (its owner and members) and anyone already assigned, by name. Each person
 * shows once.
 */
export function assigneeCandidates(workspace: WorkspaceFile, me: Id, task: Task): AssigneeOption[] {
  const byName = (a: Assignee, b: Assignee) => a.name.localeCompare(b.name);
  const shown = new Set<string>([`user:${me}`]);
  const options: AssigneeOption[] = [{ ...describePrincipal(workspace, `user:${me}`), depth: 0 }];

  const groups = principalsOf(workspace, me)
    .filter((principal) => principal.startsWith('group:'))
    .map((principal) => getEntity(workspace, 'groups', principal.slice(6)))
    .filter((group) => group !== undefined && isLive(group) && !group.archived)
    .map((group) => describePrincipal(workspace, `group:${group!.id}`))
    .sort(byName);
  for (const group of groups) {
    shown.add(group.principal);
    options.push({ ...group, depth: 0 });
    const members = workspace.entities.groupMembers
      .filter(
        (member) =>
          isLive(member) &&
          member.groupId === group.principal.slice(6) &&
          member.state === 'active' &&
          member.userId !== me,
      )
      .map((member) => describePrincipal(workspace, `user:${member.userId}`))
      .sort(byName);
    for (const member of members) {
      if (shown.has(member.principal)) continue;
      shown.add(member.principal);
      options.push({ ...member, depth: 1 });
    }
  }

  const others = new Set<string>();
  const list = getEntity(workspace, 'lists', task.listId);
  if (list) others.add(`user:${list.createdBy}`);
  for (const member of listMembersOf(workspace, task.listId)) others.add(member.principal);
  for (const friend of friendsOf(workspace, me)) {
    if (friend.state === 'accepted') others.add(`user:${friend.userId}`);
  }
  for (const principal of assigneesOf(task)) others.add(principal);
  const rest = [...others]
    .filter((principal) => !shown.has(principal))
    .map((principal) => describePrincipal(workspace, principal))
    .sort(byName);
  return [...options, ...rest.map((each) => ({ ...each, depth: 0 as const }))];
}

/**
 * Dibs (spec: Group-assigned tasks): take a task assigned to a group I am in for myself. The
 * group comes off and I go on, so the group sees who took it.
 */
export function claimTask(ctx: OpContext, workspace: WorkspaceFile, taskId: Id): WorkspaceFile {
  const task = getEntity(workspace, 'tasks', taskId);
  if (!task) return workspace;
  const mine = new Set(principalsOf(workspace, ctx.userId));
  const groups = assigneesOf(task).filter(
    (principal) => principal.startsWith('group:') && mine.has(principal),
  );
  if (groups.length === 0) return workspace;
  let next = workspace;
  for (const principal of groups) next = setAssignee(ctx, next, taskId, principal, false);
  return setAssignee(ctx, next, taskId, `user:${ctx.userId}`, true);
}

/** Whether a task is assigned to a group I am in (and so open for dibs). */
export function canClaim(workspace: WorkspaceFile, me: Id, task: Task): boolean {
  const mine = new Set(principalsOf(workspace, me));
  return assigneesOf(task).some(
    (principal) => principal.startsWith('group:') && mine.has(principal),
  );
}

/** Open tasks assigned to me, directly or through a group I am in. */
export function assignedTo(workspace: WorkspaceFile, me: Id): Task[] {
  const mine = new Set(principalsOf(workspace, me));
  return workspace.entities.tasks.filter(
    (task) =>
      isLive(task) &&
      task.status === 'open' &&
      assigneesOf(task).some((principal) => mine.has(principal)),
  );
}

/** Tasks I can see only because someone shared them: in lists I do not own, or assigned from elsewhere. */
export function sharedWithMe(workspace: WorkspaceFile, me: Id): Task[] {
  const mineLists = new Set(
    workspace.entities.lists.filter((list) => list.createdBy === me).map((list) => list.id),
  );
  return workspace.entities.tasks.filter(
    (task) => isLive(task) && task.status === 'open' && !mineLists.has(task.listId),
  );
}
