import { describe, expect, it } from 'vitest';
import { createGroup } from '../../core/groups.ts';
import { createList, inboxList } from '../../core/lists.ts';
import { makePrivate, shareList } from '../../core/sharing.ts';
import { createWorkspace } from '../../core/workspace.ts';
import { testContext } from '../../test/fixtures.ts';
import { listName } from './listName.ts';

describe('listName', () => {
  it('shows a list shared with groups as "{list} - {groups}", and plain again once private', () => {
    const ctx = testContext();
    let ws = createWorkspace(ctx);
    expect(listName(inboxList(ws), ws)).toBe('Mess Drawer');
    const made = createList(ctx, ws, { name: 'Groceries', color: '#CFE3A3' });
    ws = made.workspace;
    expect(listName(made.list, ws)).toBe('Groceries');

    const household = createGroup(ctx, ws, { name: 'Household', color: '#F4B6C2' });
    const camp = createGroup(ctx, household.workspace, { name: 'Camp', color: '#F4B6C2' });
    ws = shareList(ctx, camp.workspace, made.list.id, `group:${household.group.id}`, 'editor');
    expect(listName(made.list, ws)).toBe('Groceries - Household');
    ws = shareList(ctx, ws, made.list.id, `group:${camp.group.id}`, 'viewer');
    expect(listName(made.list, ws)).toBe('Groceries - Camp, Household');
    // Shared with people only: the plain name.
    ws = makePrivate(ctx, ws, made.list.id);
    expect(listName(made.list, ws)).toBe('Groceries');
  });
});
