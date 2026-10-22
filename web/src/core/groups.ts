// Groups as the app sees them (spec: Sharing & Permissions, Groups): a named set of people, made by
// any user, who becomes its owner. The owner invites friends, who accept; anyone may leave. When
// the owner leaves, the server hands the group to the longest-standing member, or archives it
// once nobody is left (only the owner may change a group, so the app cannot do it).

import { getEntity, isLive, putEntity } from './collections.ts';
import { createEntity, softDelete, updateEntity, type OpContext } from './ops.ts';
import { nameOf } from './sharing.ts';
import type { Group, GroupMember, Id, User, WorkspaceFile } from './types.ts';

export interface GroupView {
  group: Group;
  /** My membership: `active`, `invited`, or null (an owner from before memberships) */
  mine: GroupMember | null;
  owner: boolean;
  /** Live memberships, active first, then by when they joined. */
  members: GroupMember[];
}

/** Live memberships of a group, active ones first, each by when they joined. */
export function groupMembersOf(workspace: WorkspaceFile, groupId: Id): GroupMember[] {
  return workspace.entities.groupMembers
    .filter((member) => isLive(member) && member.groupId === groupId)
    .sort(
      (a, b) =>
        Number(b.state === 'active') - Number(a.state === 'active') ||
        a.joinedAt.localeCompare(b.joinedAt),
    );
}

/** The groups I own or am in (invites included), not archived, by name. */
export function groupsOf(workspace: WorkspaceFile, me: Id): GroupView[] {
  return workspace.entities.groups
    .filter((group) => isLive(group) && !group.archived)
    .map((group): GroupView => {
      const members = groupMembersOf(workspace, group.id);
      const mine = members.find((member) => member.userId === me) ?? null;
      return { group, mine, owner: group.ownerId === me, members };
    })
    .filter((view) => view.owner || view.mine !== null)
    .sort((a, b) => a.group.name.localeCompare(b.group.name));
}

/** Groups I am an active member of (what I can share with or assign to). */
export function activeGroupsOf(workspace: WorkspaceFile, me: Id): Group[] {
  return groupsOf(workspace, me)
    .filter((view) => view.mine?.state === 'active' || (view.owner && view.mine === null))
    .map((view) => view.group);
}

/** Make a group; I own it and am its first member. */
export function createGroup(
  ctx: OpContext,
  workspace: WorkspaceFile,
  fields: { name: string; color: string },
): { workspace: WorkspaceFile; group: Group } {
  const group = createEntity<Group>(ctx, {
    name: fields.name.trim(),
    color: fields.color,
    ownerId: ctx.userId,
    archived: false,
  });
  const member = createEntity<GroupMember>(ctx, {
    groupId: group.id,
    userId: ctx.userId,
    joinedAt: new Date(ctx.now()).toISOString(),
    state: 'active',
  });
  return {
    workspace: putEntity(putEntity(workspace, 'groups', group), 'groupMembers', member),
    group,
  };
}

/** Rename or recolor a group (its owner). */
export function updateGroup(
  ctx: OpContext,
  workspace: WorkspaceFile,
  groupId: Id,
  fields: Partial<Pick<Group, 'name' | 'color'>>,
): WorkspaceFile {
  const group = getEntity(workspace, 'groups', groupId);
  if (!group || group.ownerId !== ctx.userId) return workspace;
  return putEntity(workspace, 'groups', updateEntity(ctx, group, fields));
}

/** Invite someone (the owner); nothing happens if they are in or invited already. */
export function inviteToGroup(
  ctx: OpContext,
  workspace: WorkspaceFile,
  groupId: Id,
  userId: Id,
): WorkspaceFile {
  const group = getEntity(workspace, 'groups', groupId);
  if (!group || group.ownerId !== ctx.userId) return workspace;
  if (groupMembersOf(workspace, groupId).some((member) => member.userId === userId)) {
    return workspace;
  }
  const member = createEntity<GroupMember>(ctx, {
    groupId,
    userId,
    joinedAt: new Date(ctx.now()).toISOString(),
    state: 'invited',
  });
  return putEntity(workspace, 'groupMembers', member);
}

/** Accept an invite: I join now (joining time decides who takes over later). */
export function acceptGroupInvite(
  ctx: OpContext,
  workspace: WorkspaceFile,
  memberId: Id,
): WorkspaceFile {
  const member = getEntity(workspace, 'groupMembers', memberId);
  if (!member || member.userId !== ctx.userId || member.state !== 'invited') return workspace;
  return putEntity(
    workspace,
    'groupMembers',
    updateEntity(ctx, member, { state: 'active', joinedAt: new Date(ctx.now()).toISOString() }),
  );
}

/** Leave a group or decline its invite (me), or take someone out of it (the owner). */
export function removeFromGroup(
  ctx: OpContext,
  workspace: WorkspaceFile,
  memberId: Id,
): WorkspaceFile {
  const member = getEntity(workspace, 'groupMembers', memberId);
  if (!member) return workspace;
  const group = getEntity(workspace, 'groups', member.groupId);
  if (member.userId !== ctx.userId && group?.ownerId !== ctx.userId) return workspace;
  return putEntity(workspace, 'groupMembers', softDelete(ctx, member));
}

/** Hand a group to one of its active members (the owner). */
export function transferGroup(
  ctx: OpContext,
  workspace: WorkspaceFile,
  groupId: Id,
  userId: Id,
): WorkspaceFile {
  const group = getEntity(workspace, 'groups', groupId);
  if (!group || group.ownerId !== ctx.userId || userId === ctx.userId) return workspace;
  const active = groupMembersOf(workspace, groupId).some(
    (member) => member.userId === userId && member.state === 'active',
  );
  if (!active) return workspace;
  return putEntity(workspace, 'groups', updateEntity(ctx, group, { ownerId: userId }));
}

/** A member's name, from their profile. */
export function memberName(workspace: WorkspaceFile, member: GroupMember): string {
  const user: User | undefined = getEntity(workspace, 'users', member.userId);
  return nameOf(user, member.userId);
}
