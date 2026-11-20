import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryStorage } from '../../adapters/memory-storage.ts';
import { putEntity } from '../../core/collections.ts';
import { createGroup } from '../../core/groups.ts';
import { createList } from '../../core/lists.ts';
import { createEntity } from '../../core/ops.ts';
import { listMembersOf } from '../../core/sharing.ts';
import type { Friendship, User } from '../../core/types.ts';
import { FakeBackend } from '../../test/fakeTransport.ts';
import { mockViewport, renderApp, testStore } from '../../test/renderApp.tsx';
import { createSyncEngine } from '../sync/syncEngine.ts';

const SAM = '01JBSAM0000000000000000002';
const ALEX = '01JBALEX000000000000000003';

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  mockViewport('desktop');
});

/** Signed in to a (fake) server, with a list and a friend. */
async function setup() {
  const backend = new FakeBackend();
  backend.addAccount('ben', 'correct horse battery');
  const store = testStore();
  await store.getState().init();
  let listId = '';
  const sync = createSyncEngine({
    transport: Object.assign(backend.device(), { session: 'ben' }),
    workspace: store,
    storage: createMemoryStorage(),
    debounceMs: 60_000,
    intervalMs: 600_000,
  });
  await sync.getState().start();
  store.getState().apply((ctx, ws) => {
    const { workspace, list } = createList(ctx, ws, { name: 'Garden', color: '#CFE3A3' });
    listId = list.id;
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
    const withGroup = createGroup(ctx, workspace, { name: 'Household', color: '#A7C7E7' });
    return putEntity(putEntity(withGroup.workspace, 'users', sam), 'friendships', friendship);
  });
  // Saved before the app opens the store again on mount.
  await store.getState().flush();
  await renderApp(`/lists/${listId}`, store, sync);
  return { store, listId };
}

describe('sharing a list', () => {
  it('adds a friend in a role, changes it, then makes the list private', async () => {
    const { store, listId } = await setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Share' }));
    const dialog = await screen.findByRole('dialog', { name: 'Share Garden' });
    expect(within(dialog).getByText('Only you can see this list.')).toBeInTheDocument();

    await userEvent.click(within(dialog).getByLabelText('Add a friend'));
    await userEvent.click(await screen.findByRole('option', { name: 'Sam' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add' }));
    expect(within(dialog).getByText('Sam')).toBeInTheDocument();
    // My groups are offered too.
    await userEvent.click(within(dialog).getByLabelText('Add a friend'));
    await userEvent.click(await screen.findByRole('option', { name: 'Household (group)' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add' }));
    expect(within(dialog).getByText('Household')).toBeInTheDocument();
    expect(within(dialog).getByText('Group')).toBeInTheDocument();
    expect(within(dialog).getByText('All your friends are on this list.')).toBeInTheDocument();
    const ws = () => store.getState().workspace!;
    expect(listMembersOf(ws(), listId).map((member) => member.role)).toEqual(['editor', 'editor']);
    expect(ws().entities.lists.find((list) => list.id === listId)!.visibility).toBe('shared');

    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Role of Sam' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Can view' }));
    expect(listMembersOf(ws(), listId).map((member) => member.role)).toEqual(['viewer', 'editor']);

    await userEvent.click(within(dialog).getByRole('button', { name: 'Make private' }));
    const confirm = await screen.findByText(/Everyone else loses it/);
    await userEvent.click(
      within(confirm.closest('[role="dialog"]') as HTMLElement).getByRole('button', {
        name: 'Make private',
      }),
    );
    await waitFor(() => expect(listMembersOf(ws(), listId)).toEqual([]));
    expect(ws().entities.lists.find((list) => list.id === listId)!.visibility).toBe('private');
  });

  it('narrows the friend box to what is typed, by name or username, and shows it', async () => {
    const { store, listId } = await setup();
    // A friend whose username is not their name.
    store.getState().apply((ctx, ws) => {
      const alex = createEntity<User>(
        ctx,
        {
          handle: 'akim@home.example',
          displayName: 'Alex Kim',
          avatarColor: '#A8DCC0',
          homeServer: 'local',
        },
        ALEX,
      );
      const friendship = createEntity<Friendship>(ctx, {
        userA: ctx.userId,
        userB: ALEX,
        state: 'accepted',
      });
      return putEntity(putEntity(ws, 'users', alex), 'friendships', friendship);
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Share' }));
    const dialog = await screen.findByRole('dialog', { name: 'Share Garden' });
    const box = within(dialog).getByRole('combobox', { name: 'Add a friend' });
    const offered = () => screen.getAllByRole('option').map((option) => option.textContent);

    await userEvent.type(box, 'house');
    expect(box).toHaveValue('house');
    expect(offered()).toEqual(['Household (group)']);

    // The username shows under a name it differs from.
    await userEvent.clear(box);
    await userEvent.type(box, 'AKIM');
    expect(offered()).toEqual(['Alex Kimakim@home.example']);

    // The server part of a username does not match.
    await userEvent.clear(box);
    await userEvent.type(box, 'example');
    expect(await screen.findByText('No friend or group by that name')).toBeInTheDocument();

    await userEvent.clear(box);
    await userEvent.type(box, 'zz');
    expect(await screen.findByText('No friend or group by that name')).toBeInTheDocument();

    // Enter takes the first match, Add shares with it and empties the box.
    await userEvent.clear(box);
    await userEvent.type(box, 'sa{Enter}');
    expect(box).toHaveValue('Sam');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add' }));
    expect(box).toHaveValue('');
    expect(
      listMembersOf(store.getState().workspace!, listId).map((member) => member.principal),
    ).toEqual([`user:${SAM}`]);
  });

  it('tells two friends with the same name apart by username', async () => {
    const { store, listId } = await setup();
    const SAM_REYES = '01JBSAMR000000000000000004';
    store.getState().apply((ctx, ws) => {
      const other = createEntity<User>(
        ctx,
        { handle: 'samreyes', displayName: 'Sam', avatarColor: '#A8DCC0', homeServer: 'local' },
        SAM_REYES,
      );
      const friendship = createEntity<Friendship>(ctx, {
        userA: ctx.userId,
        userB: SAM_REYES,
        state: 'accepted',
      });
      return putEntity(putEntity(ws, 'users', other), 'friendships', friendship);
    });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    await userEvent.click(await screen.findByRole('button', { name: 'Share' }));
    const dialog = await screen.findByRole('dialog', { name: 'Share Garden' });
    const box = within(dialog).getByRole('combobox', { name: 'Add a friend' });

    await userEvent.type(box, 'sam');
    const options = screen.getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual(['Sam', 'Samsamreyes']);
    // Each option has its own key, so React does not mix the rows up.
    expect(errors.mock.calls.flat().join(' ')).not.toMatch(/same key/);
    errors.mockRestore();

    await userEvent.click(options[1]!);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add' }));
    expect(
      listMembersOf(store.getState().workspace!, listId).map((member) => member.principal),
    ).toEqual([`user:${SAM_REYES}`]);
  });

  it('is not offered without a server', async () => {
    const store = testStore();
    await store.getState().init();
    let listId = '';
    store.getState().apply((ctx, ws) => {
      const { workspace, list } = createList(ctx, ws, { name: 'Garden', color: '#CFE3A3' });
      listId = list.id;
      return workspace;
    });
    await store.getState().flush();
    await renderApp(`/lists/${listId}`, store);
    expect(screen.queryByRole('button', { name: 'Share' })).toBeNull();
  });
});
