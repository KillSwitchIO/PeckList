import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryStorage } from '../../adapters/memory-storage.ts';
import { putEntity } from '../../core/collections.ts';
import { createList } from '../../core/lists.ts';
import { createEntity } from '../../core/ops.ts';
import { listMembersOf } from '../../core/sharing.ts';
import type { Friendship, User } from '../../core/types.ts';
import { FakeBackend } from '../../test/fakeTransport.ts';
import { mockViewport, renderApp, testStore } from '../../test/renderApp.tsx';
import { createSyncEngine } from '../sync/syncEngine.ts';

const SAM = '01JBSAM0000000000000000002';

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
    return putEntity(putEntity(workspace, 'users', sam), 'friendships', friendship);
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
    expect(within(dialog).getByText('All your friends are on this list.')).toBeInTheDocument();
    const ws = () => store.getState().workspace!;
    expect(listMembersOf(ws(), listId).map((member) => member.role)).toEqual(['editor']);
    expect(ws().entities.lists.find((list) => list.id === listId)!.visibility).toBe('shared');

    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Role of Sam' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Can view' }));
    expect(listMembersOf(ws(), listId).map((member) => member.role)).toEqual(['viewer']);

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
