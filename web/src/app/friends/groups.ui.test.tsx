import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryStorage } from '../../adapters/memory-storage.ts';
import { putEntity } from '../../core/collections.ts';
import { groupsOf, SERVER_GROUP_OWNER } from '../../core/groups.ts';
import { createEntity } from '../../core/ops.ts';
import type { Friendship, Group, GroupMember, User, WorkspaceFile } from '../../core/types.ts';
import type { OpContext } from '../../core/ops.ts';
import { FakeBackend } from '../../test/fakeTransport.ts';
import { mockViewport, renderApp, testStore } from '../../test/renderApp.tsx';
import { createSyncEngine } from '../sync/syncEngine.ts';

const SAM = '01JBSAM0000000000000000002';

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  mockViewport('desktop');
});

/** Signed in, with Sam as a friend, plus whatever `extra` adds; on the friends page. */
async function setup(extra: (ctx: OpContext, ws: WorkspaceFile) => WorkspaceFile = (_, ws) => ws) {
  const backend = new FakeBackend();
  backend.addAccount('ben', 'correct horse battery');
  const store = testStore();
  await store.getState().init();
  const sync = createSyncEngine({
    transport: Object.assign(backend.device(), { session: 'ben' }),
    workspace: store,
    storage: createMemoryStorage(),
    debounceMs: 60_000,
    intervalMs: 600_000,
  });
  await sync.getState().start();
  store.getState().apply((ctx, ws) => {
    const sam = createEntity<User>(
      ctx,
      { handle: 'sam', displayName: 'Sam', avatarColor: '#F4B6C2', homeServer: 'local' },
      SAM,
    );
    const friendship = createEntity<Friendship>(ctx, {
      userA: ctx.userId,
      userB: SAM,
      state: 'accepted',
    });
    return extra(ctx, putEntity(putEntity(ws, 'users', sam), 'friendships', friendship));
  });
  await store.getState().flush();
  await renderApp('/friends', store, sync);
  await waitFor(() => expect(sync.getState().phase).toBe('ready'));
  const me = () => store.getState().context().userId;
  return { store, me, ws: () => store.getState().workspace! };
}

describe('groups', () => {
  it('makes a group, invites a friend, and leaves it', async () => {
    const { ws, me } = await setup();
    const section = await screen.findByRole('region', { name: 'Groups' });
    expect(within(section).getByText(/No groups yet/)).toBeInTheDocument();

    await userEvent.click(within(section).getByRole('button', { name: 'New group' }));
    await userEvent.type(await screen.findByLabelText('Group name'), 'Household{Enter}');
    const dialog = await screen.findByRole('dialog', { name: /Household/ });
    const members = within(dialog).getByRole('list', { name: 'Members of Household' });
    expect(within(members).getByText('Owner')).toBeInTheDocument();

    await userEvent.click(within(dialog).getByLabelText('Invite a friend'));
    await userEvent.click(await screen.findByRole('option', { name: 'Sam' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Invite' }));
    expect(within(members).getByText('Sam')).toBeInTheDocument();
    expect(within(members).getByText('Invited')).toBeInTheDocument();
    expect(within(dialog).getByText('All your friends are in this group.')).toBeInTheDocument();

    // Sam has only been invited: leaving archives it.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Leave group' }));
    const confirm = await screen.findByText(/Nobody is left in it/);
    await userEvent.click(
      within(confirm.closest('[role="dialog"]') as HTMLElement).getByRole('button', {
        name: 'Leave group',
      }),
    );
    await waitFor(() => expect(groupsOf(ws(), me())[0]?.mine ?? null).toBeNull());
  });

  it('a server group shows as one, and nobody leaves it from the app', async () => {
    await setup((ctx, workspace) => {
      const group = createEntity<Group>(ctx, {
        name: 'Household',
        color: '#6B7280',
        ownerId: SERVER_GROUP_OWNER,
        archived: false,
      });
      const mine = createEntity<GroupMember>(ctx, {
        groupId: group.id,
        userId: ctx.userId,
        joinedAt: new Date().toISOString(),
        state: 'active',
      });
      return putEntity(putEntity(workspace, 'groups', group), 'groupMembers', mine);
    });
    const section = await screen.findByRole('region', { name: 'Groups' });
    expect(await within(section).findByText(/Server group/)).toBeInTheDocument();
    await userEvent.click(within(section).getByText('Household'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/admins decide who is in it/)).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Leave group' })).toBeNull();
    expect(within(dialog).queryByRole('button', { name: 'Rename' })).toBeNull();
  });

  it('joins a group someone invited me to', async () => {
    const { ws, me } = await setup((ctx, workspace) => {
      const group = createEntity<Group>(ctx, {
        name: 'Book club',
        color: '#CDB4E6',
        ownerId: SAM,
        archived: false,
      });
      const invite = createEntity<GroupMember>(ctx, {
        groupId: group.id,
        userId: ctx.userId,
        joinedAt: new Date().toISOString(),
        state: 'invited',
      });
      return putEntity(putEntity(workspace, 'groups', group), 'groupMembers', invite);
    });
    const invites = await screen.findByRole('list', { name: 'Group invites' });
    expect(within(invites).getByText('Invited by Sam')).toBeInTheDocument();
    await userEvent.click(within(invites).getByRole('button', { name: 'Join' }));
    await waitFor(() => expect(groupsOf(ws(), me())[0]!.mine?.state).toBe('active'));
    expect(screen.queryByRole('list', { name: 'Group invites' })).toBeNull();
    expect(screen.getByText('Book club')).toBeInTheDocument();
  });
});
