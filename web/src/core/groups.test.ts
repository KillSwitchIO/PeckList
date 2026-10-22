import { describe, expect, it } from 'vitest';
import { testContext } from '../test/fixtures.ts';
import {
  acceptGroupInvite,
  activeGroupsOf,
  createGroup,
  groupMembersOf,
  groupsOf,
  inviteToGroup,
  removeFromGroup,
  transferGroup,
  updateGroup,
} from './groups.ts';
import { createWorkspace } from './workspace.ts';

const BEN = '01JBBEN0000000000000000001';
const SAM = '01JBSAM0000000000000000002';
const JO = '01JBJ00000000000000000000J';

const as = (userId: string) => testContext(userId.slice(4, 7).toLowerCase(), undefined, userId);

function household() {
  const ben = as(BEN);
  const { workspace, group } = createGroup(ben, createWorkspace(ben), {
    name: ' Household ',
    color: '#A7C7E7',
  });
  return { ben, workspace, group };
}

describe('groups', () => {
  it('the maker owns it and is its first member', () => {
    const { workspace, group } = household();
    expect(group.name).toBe('Household');
    const [view] = groupsOf(workspace, BEN);
    expect(view!.owner).toBe(true);
    expect(view!.mine?.state).toBe('active');
    expect(activeGroupsOf(workspace, BEN).map((each) => each.id)).toEqual([group.id]);
  });

  it('invites, accepts, and leaves', () => {
    const { ben, workspace, group } = household();
    let next = inviteToGroup(ben, workspace, group.id, SAM);
    // Inviting twice changes nothing; only the owner invites.
    expect(inviteToGroup(ben, next, group.id, SAM)).toBe(next);
    expect(inviteToGroup(as(SAM), next, group.id, JO)).toBe(next);

    const invite = groupMembersOf(next, group.id).find((member) => member.userId === SAM)!;
    expect(groupsOf(next, SAM)[0]!.mine?.state).toBe('invited');
    expect(activeGroupsOf(next, SAM)).toEqual([]);
    // Only the invited accept.
    expect(acceptGroupInvite(ben, next, invite.id)).toBe(next);
    next = acceptGroupInvite(as(SAM), next, invite.id);
    expect(activeGroupsOf(next, SAM).map((each) => each.id)).toEqual([group.id]);

    // Sam cannot take Ben out, but may leave.
    const benRow = groupMembersOf(next, group.id).find((member) => member.userId === BEN)!;
    expect(removeFromGroup(as(SAM), next, benRow.id)).toBe(next);
    next = removeFromGroup(as(SAM), next, invite.id);
    expect(groupsOf(next, SAM)).toEqual([]);
  });

  it('the owner renames it and hands it to an active member', () => {
    const { ben, workspace, group } = household();
    let next = inviteToGroup(ben, workspace, group.id, SAM);
    // Not to someone who has not accepted.
    expect(transferGroup(ben, next, group.id, SAM)).toBe(next);
    const invite = groupMembersOf(next, group.id).find((member) => member.userId === SAM)!;
    next = acceptGroupInvite(as(SAM), next, invite.id);
    expect(updateGroup(as(SAM), next, group.id, { name: 'Mine' })).toBe(next);
    next = updateGroup(ben, next, group.id, { name: 'Home' });
    next = transferGroup(ben, next, group.id, SAM);
    expect(groupsOf(next, SAM)[0]!.owner).toBe(true);
    expect(groupsOf(next, SAM)[0]!.group.name).toBe('Home');
    expect(groupsOf(next, BEN)[0]!.owner).toBe(false);
  });
});
