import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryStorage } from '../../adapters/memory-storage.ts';
import type {
  AccountRole,
  AdminApi,
  AdminGroup,
  AdminUser,
  PendingSignIn,
} from '../../ports/admin.ts';
import { FakeBackend } from '../../test/fakeTransport.ts';
import { mockViewport, renderApp, testStore } from '../../test/renderApp.tsx';
import { createSyncEngine } from '../sync/syncEngine.ts';

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  mockViewport('desktop');
});

/** The admin API in memory: just enough server behavior for the screens. */
function memoryAdmin(benId: string) {
  const user = (id: string, username: string, role: AccountRole = 'user'): AdminUser => ({
    id,
    username,
    role,
    disabled: false,
    createdAt: '2026-10-22T08:00:00Z',
    groups: [],
    hasPassword: true,
    mustChangePassword: false,
    providers: [],
  });
  const state = {
    users: [user(benId, 'ben', 'superadmin'), user('U2', 'sam')],
    groups: [] as AdminGroup[],
    friendships: [] as [string, string][],
    handedOver: [] as { from: string; to: string; ids: string[] }[],
    window: null as string | null,
    pending: [
      {
        provider: 'pocket',
        subject: 'kim-sub',
        username: 'kim',
        displayName: 'Kim Lee',
        email: 'kim@example.com',
        groups: ['family'],
        firstSeen: '2026-10-22T08:00:00Z',
        lastSeen: '2026-10-22T08:00:00Z',
      },
    ] as PendingSignIn[],
  };
  const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value });
  const api: AdminApi = {
    users: () => Promise.resolve(state.users.map((each) => ({ ...each }))),
    addUser: (username, role) => {
      if (state.users.some((each) => each.username === username)) {
        return Promise.resolve({ ok: false, reason: 'taken' });
      }
      state.users.push({
        ...user(`U${state.users.length + 1}`, username, role),
        mustChangePassword: true,
      });
      return ok({ id: 'new', password: 'generated-secret-1' });
    },
    setRole: (id, role) => {
      state.users = state.users.map((each) => (each.id === id ? { ...each, role } : each));
      return ok(undefined);
    },
    setDisabled: (id, disabled) => {
      state.users = state.users.map((each) => (each.id === id ? { ...each, disabled } : each));
      return ok(undefined);
    },
    resetPassword: () => ok('reset-secret-2'),
    loginLink: () => ok({ url: 'https://tasks.example.com/auth/link/abc', expires: '' }),
    identities: () => Promise.resolve([]),
    impersonate: (_, reason) =>
      reason.trim().length < 3
        ? Promise.resolve({ ok: false as const, reason: 'reason-required' as const })
        : ok({ token: 'view-token', expires: '' }),
    unlink: () => ok({ stranded: false }),
    friends: (id) =>
      Promise.resolve(
        state.friendships
          .filter((pair) => pair.includes(id))
          .map((pair) => {
            const other = pair.find((each) => each !== id)!;
            const found = state.users.find((each) => each.id === other)!;
            return { userId: other, username: found.username, state: 'accepted' as const };
          }),
      ),
    makeFriends: (a, b) => {
      state.friendships.push([a, b]);
      return Promise.resolve();
    },
    endFriendship: (a, b) => {
      state.friendships = state.friendships.filter(
        (pair) => !(pair.includes(a) && pair.includes(b)),
      );
      return Promise.resolve();
    },
    shared: () =>
      Promise.resolve([
        { kind: 'list' as const, id: 'L1', name: 'Chores', people: 3 },
        { kind: 'group' as const, id: 'G9', name: 'Household', people: 4 },
      ]),
    handOver: (from, to, ids) => {
      state.handedOver.push({ from, to, ids: ids ?? [] });
      return Promise.resolve(ids?.length ?? 0);
    },
    groups: () =>
      Promise.resolve(state.groups.map((each) => ({ ...each, members: [...each.members] }))),
    addGroup: (name, offeredForSharing) => {
      state.groups.push({
        id: `G${state.groups.length + 1}`,
        name,
        offeredForSharing,
        createdAt: '',
        members: [],
      });
      return ok(undefined);
    },
    updateGroup: (id, change) => {
      state.groups = state.groups.map((each) => (each.id === id ? { ...each, ...change } : each));
      return ok(undefined);
    },
    deleteGroup: (id) => {
      state.groups = state.groups.filter((each) => each.id !== id);
      return Promise.resolve();
    },
    setMember: (groupId, accountId, member) => {
      const group = state.groups.find((each) => each.id === groupId)!;
      group.members = member
        ? [...group.members, { accountId, sources: ['manual'] }]
        : group.members.filter((each) => each.accountId !== accountId);
      return Promise.resolve();
    },
    providers: () =>
      Promise.resolve([
        { name: 'pocket', displayName: 'Pocket ID', linked: 2, migrationWindowUntil: state.window },
      ]),
    unbindAll: () => Promise.resolve({ unbound: 2, stranded: ['kim'] }),
    openMigrationWindow: () => {
      state.window = '2026-10-23T08:00:00Z';
      return Promise.resolve(state.window);
    },
    closeMigrationWindow: () => {
      state.window = null;
      return Promise.resolve();
    },
    pending: () => Promise.resolve([...state.pending]),
    approve: (_, subject) => {
      state.pending = state.pending.filter((each) => each.subject !== subject);
      return Promise.resolve();
    },
    dismiss: () => Promise.resolve(),
  };
  return { api, state };
}

async function adminApp(role: AccountRole, path = '/admin') {
  const backend = new FakeBackend();
  const ben = backend.addAccount('ben', 'correct horse battery', { role });
  const transport = backend.device();
  transport.session = 'ben';
  const admin = memoryAdmin(ben.id);
  transport.admin = admin.api;
  const store = testStore();
  const sync = createSyncEngine({
    transport,
    workspace: store,
    storage: createMemoryStorage(),
    debounceMs: 60_000,
    intervalMs: 600_000,
  });
  await renderApp(path, store, sync);
  return admin;
}

describe('admin', () => {
  it('is only for admins', async () => {
    await adminApp('user', '/today');
    const nav = screen.getAllByRole('navigation')[0]!;
    await within(nav).findByText('Settings');
    expect(within(nav).queryByText('Admin')).toBeNull();
  });

  it('turns plain users away at the address too', async () => {
    await adminApp('user');
    expect(
      await screen.findByText('Only admins of this server can open this page.'),
    ).toBeInTheDocument();
  });

  it('adds people, resets passwords and turns accounts off', async () => {
    const { state } = await adminApp('superadmin');
    const list = await screen.findByRole('list', { name: 'Users' });
    expect(await within(list).findByRole('listitem', { name: 'sam' })).toHaveTextContent(
      'User · Password',
    );

    await userEvent.click(screen.getByRole('button', { name: 'Add user' }));
    const add = await screen.findByRole('dialog', { name: 'Add user' });
    await userEvent.type(within(add).getByLabelText(/Username/), 'Zoe');
    await userEvent.click(within(add).getByRole('button', { name: 'Add' }));
    const shown = await screen.findByRole('dialog', { name: 'Password for zoe' });
    expect(shown).toHaveTextContent('generated-secret-1');
    await userEvent.click(within(shown).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await within(list).findByRole('listitem', { name: 'zoe' })).toHaveTextContent(
      'Must choose a password',
    );

    await userEvent.click(within(list).getByRole('button', { name: 'Actions for sam' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Reset password' }));
    expect(await screen.findByRole('dialog', { name: 'New password for sam' })).toHaveTextContent(
      'reset-secret-2',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await userEvent.click(within(list).getByRole('button', { name: 'Actions for sam' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Turn off' }));
    const confirm = await screen.findByRole('dialog', { name: 'Turn off sam?' });
    await userEvent.click(within(confirm).getByRole('button', { name: 'Turn off' }));
    await waitFor(() =>
      expect(within(list).getByRole('listitem', { name: 'sam' })).toHaveTextContent('Turned off'),
    );
    expect(state.users.find((each) => each.username === 'sam')?.disabled).toBe(true);

    // The own account cannot be turned off from here.
    await userEvent.click(within(list).getByRole('button', { name: 'Actions for ben' }));
    expect(await screen.findByRole('menuitem', { name: 'Reset password' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Turn off' })).toBeNull();
  });

  it('an admin leaves admin accounts to super admins', async () => {
    await adminApp('admin');
    const nav = screen.getAllByRole('navigation')[0]!;
    expect(within(nav).getByText('Admin')).toBeInTheDocument();
    const list = await screen.findByRole('list', { name: 'Users' });
    await userEvent.click(await within(list).findByRole('button', { name: 'Actions for ben' }));
    expect(
      await screen.findByText("Only a super admin can change an admin's account."),
    ).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Reset password' })).toBeNull();
  });

  it('sets up and ends friendships for people', async () => {
    const { state } = await adminApp('superadmin');
    const list = await screen.findByRole('list', { name: 'Users' });
    await userEvent.click(await within(list).findByRole('button', { name: 'Actions for sam' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Friends' }));
    const dialog = await screen.findByRole('dialog', { name: "sam's friends" });
    expect(await within(dialog).findByText('No friends yet.')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByLabelText('Make friends with'));
    await userEvent.click(await screen.findByRole('option', { name: 'ben' }));
    expect(await within(dialog).findByText('ben')).toBeInTheDocument();
    expect(state.friendships).toHaveLength(1);
    await userEvent.click(within(dialog).getByRole('button', { name: 'End friendship with ben' }));
    expect(await within(dialog).findByText('No friends yet.')).toBeInTheDocument();
  });

  it("hands someone's shared lists to another person", async () => {
    const { state } = await adminApp('superadmin');
    const list = await screen.findByRole('list', { name: 'Users' });
    await userEvent.click(await within(list).findByRole('button', { name: 'Actions for sam' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Hand over shared lists' }));
    const dialog = await screen.findByRole('dialog', { name: "Hand over sam's shared lists" });
    await userEvent.click(await within(dialog).findByRole('checkbox', { name: /Household/ }));
    expect(within(dialog).getByRole('button', { name: 'Hand over' })).toBeDisabled();
    await userEvent.click(within(dialog).getByLabelText('New owner'));
    await userEvent.click(await screen.findByRole('option', { name: 'ben' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Hand over' }));
    expect(await screen.findByText('Handed over 1.')).toBeInTheDocument();
    expect(state.handedOver).toEqual([{ from: 'U2', to: expect.any(String), ids: ['L1'] }]);
  });

  it('a super admin opens a tab viewing the app as someone, saying why', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    await adminApp('superadmin');
    const list = await screen.findByRole('list', { name: 'Users' });
    await userEvent.click(await within(list).findByRole('button', { name: 'Actions for sam' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'View as sam' }));
    const dialog = await screen.findByRole('dialog', { name: 'View the app as sam' });
    await userEvent.type(within(dialog).getByLabelText(/Why/), 'ok');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Open' }));
    expect(await within(dialog).findByText('Say why, in a few words.')).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText(/Why/), ' then, sam asked');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Open' }));
    await waitFor(() =>
      expect(open).toHaveBeenCalledWith('/today#view-as=view-token&name=sam', '_blank'),
    );
    // Not for oneself.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await userEvent.click(within(list).getByRole('button', { name: 'Actions for ben' }));
    await screen.findByRole('menuitem', { name: 'Reset password' });
    expect(screen.queryByRole('menuitem', { name: /View as/ })).toBeNull();
    open.mockRestore();
  });

  it('makes a group and fills it', async () => {
    const { state } = await adminApp('superadmin', '/admin/groups');
    await userEvent.click(await screen.findByRole('button', { name: 'New group' }));
    const made = await screen.findByRole('dialog', { name: 'New group' });
    await userEvent.type(within(made).getByLabelText(/Name/), 'Family');
    await userEvent.click(within(made).getByLabelText('Offer for sharing'));
    await userEvent.click(within(made).getByRole('button', { name: 'Save' }));
    const list = await screen.findByRole('list', { name: 'Groups' });
    await userEvent.click(await within(list).findByText('Family'));

    const group = await screen.findByRole('dialog', { name: 'Family' });
    await userEvent.click(within(group).getByLabelText('Add someone'));
    await userEvent.click(await screen.findByRole('option', { name: 'sam' }));
    expect(await within(group).findByText('Added by hand')).toBeInTheDocument();
    expect(state.groups[0]).toMatchObject({
      name: 'Family',
      offeredForSharing: true,
      members: [{ accountId: 'U2' }],
    });
  });

  it('opens a migration window and lets a waiting person in', async () => {
    const { state } = await adminApp('superadmin', '/admin/sign-in');
    const providers = await screen.findByRole('region', { name: 'Identity providers' });
    expect(await within(providers).findByText('2 linked')).toBeInTheDocument();
    await userEvent.click(within(providers).getByRole('button', { name: 'Open migration window' }));
    expect(await within(providers).findByText(/Migration window open until/)).toBeInTheDocument();

    const waiting = screen.getByRole('region', { name: 'Waiting to be let in' });
    await userEvent.click(await within(waiting).findByRole('button', { name: 'Let in' }));
    expect(await within(waiting).findByText('Nobody is waiting.')).toBeInTheDocument();
    expect(state.pending).toEqual([]);

    await userEvent.click(within(providers).getByRole('button', { name: 'Unbind all' }));
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Unbind all' }),
    );
    expect(await screen.findByText(/No way to sign in now: kim/)).toBeInTheDocument();
  });
});
