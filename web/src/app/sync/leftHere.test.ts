import { describe, expect, it } from 'vitest';
import { createGroup, inviteToGroup, removeFromGroup } from '../../core/groups.ts';
import { createList } from '../../core/lists.ts';
import { removeMember, shareList } from '../../core/sharing.ts';
import type { WorkspaceFile } from '../../core/types.ts';
import { createWorkspace } from '../../core/workspace.ts';
import { testContext } from '../../test/fixtures.ts';
import { leftHere } from './syncEngine.ts';

const ME = '01TESTMEMBER00000000000002';
const OWNER = '01TESTMEMBER00000000000001';

describe('lists left on this device', () => {
  it('are the ones whose membership, or whose group membership, ended here', () => {
    const owner = testContext('owner', undefined, OWNER);
    const here = testContext('phone', undefined, ME);
    let ws: WorkspaceFile = createWorkspace(owner);
    const direct = createList(owner, ws, { name: 'Direct', color: '#CFE3A3' });
    const viaGroup = createList(owner, direct.workspace, { name: 'Club', color: '#CFE3A3' });
    const removed = createList(owner, viaGroup.workspace, { name: 'Removed', color: '#CFE3A3' });
    const group = createGroup(owner, removed.workspace, { name: 'Club', color: '#A7C7E7' });
    ws = inviteToGroup(owner, group.workspace, group.group.id, ME);
    ws = shareList(owner, ws, direct.list.id, `user:${ME}`, 'editor');
    ws = shareList(owner, ws, viaGroup.list.id, `group:${group.group.id}`, 'editor');
    ws = shareList(owner, ws, removed.list.id, `user:${ME}`, 'editor');
    const memberOf = (listId: string) =>
      ws.entities.listMembers.find(
        (each) => each.listId === listId && each.principal === `user:${ME}`,
      )!;
    const myGroupMembership = ws.entities.groupMembers.find((each) => each.userId === ME)!;

    // I leave Direct and the group here; the owner takes me off Removed elsewhere.
    ws = removeMember(here, ws, memberOf(direct.list.id).id);
    ws = removeFromGroup(here, ws, myGroupMembership.id);
    ws = removeMember(owner, ws, memberOf(removed.list.id).id);

    expect([...leftHere(ws, ME, 'phone')].sort()).toEqual(
      [direct.list.id, viaGroup.list.id].sort(),
    );
    // On another device of mine, none of it happened here.
    expect(leftHere(ws, ME, 'laptop').size).toBe(0);
  });
});
