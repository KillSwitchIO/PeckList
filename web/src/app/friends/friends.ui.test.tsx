import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryStorage } from '../../adapters/memory-storage.ts';
import { FakeBackend } from '../../test/fakeTransport.ts';
import { mockViewport, renderApp, testStore } from '../../test/renderApp.tsx';
import { CURRENT_SCHEMA_VERSION } from '../../core/migrations.ts';
import { createSyncEngine } from '../sync/syncEngine.ts';
import { putEntity } from '../../core/collections.ts';
import { createList, inboxList } from '../../core/lists.ts';
import { createEntity } from '../../core/ops.ts';
import { setAssignee, shareList } from '../../core/sharing.ts';
import { createTask } from '../../core/tasks.ts';
import type { User } from '../../core/types.ts';

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  mockViewport('desktop');
});

async function signedIn(path: string, backend = new FakeBackend()) {
  if (!backend.accounts.has('ben')) backend.addAccount('ben', 'correct horse battery');
  const store = testStore();
  const transport = backend.device();
  transport.session = 'ben';
  const sync = createSyncEngine({
    transport,
    workspace: store,
    storage: createMemoryStorage(),
    debounceMs: 60_000,
    intervalMs: 600_000,
  });
  const result = await renderApp(path, store, sync);
  await waitFor(() => expect(sync.getState().phase).toBe('ready'));
  return { ...result, transport, backend };
}

describe('friends page', () => {
  it('shows your link and finds people by exact name', async () => {
    const backend = new FakeBackend();
    backend.addAccount('sam', 'sams own password');
    await signedIn('/friends', backend);
    expect(await screen.findByDisplayValue('https://punchlist.test/f/BEN')).toBeInTheDocument();
    expect(screen.getByText(/No friends yet/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'QR code' }));
    expect(
      await screen.findByRole('img', { name: 'QR code for https://punchlist.test/f/BEN' }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    const add = screen.getByRole('region', { name: 'Add a friend' });
    await userEvent.type(within(add).getByLabelText('Their exact username'), 'nobody{Enter}');
    expect(await within(add).findByText('Nobody here goes by that name.')).toBeInTheDocument();

    await userEvent.clear(within(add).getByLabelText('Their exact username'));
    await userEvent.type(within(add).getByLabelText('Their exact username'), 'sam{Enter}');
    await userEvent.click(await within(add).findByRole('button', { name: 'Ask to be friends' }));
    expect(within(add).getByText('Request sent')).toBeInTheDocument();
    // The request shows as waiting.
    const requests = await screen.findByRole('region', { name: 'Requests' });
    expect(within(requests).getByText('Waiting for them')).toBeInTheDocument();
  });

  it('says which admin made a friendship', async () => {
    const backend = new FakeBackend();
    const ben = backend.addAccount('ben', 'correct horse battery');
    const stamp = '2026-10-23T08:00:00.000Z-0000-server';
    const entity = (id: string, fields: Record<string, unknown>) => ({
      id,
      createdAt: '2026-10-23T08:00:00.000Z',
      createdBy: ben.id,
      deletedAt: null,
      origin: 'local',
      ...fields,
      _hlc: Object.fromEntries(
        ['createdAt', 'createdBy', 'deletedAt', 'origin', ...Object.keys(fields)].map((key) => [
          key,
          stamp,
        ]),
      ),
    });
    backend.server.sync(ben.id, {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      cursor: null,
      changes: [
        {
          collection: 'users',
          entity: entity('01JBSAM0000000000000000001', {
            handle: 'sam@punchlist.test',
            displayName: 'Sam',
            avatarColor: '#A7C7E7',
            homeServer: 'punchlist.test',
          }),
        },
        {
          collection: 'friendships',
          entity: entity('01JBFR1END0000000000000001', {
            userA: ben.id,
            userB: '01JBSAM0000000000000000001',
            state: 'accepted',
            madeBy: { id: '01JBADM1N00000000000000001', name: 'kim' },
          }),
        },
      ],
    });
    await signedIn('/friends', backend);
    const list = await screen.findByRole('region', { name: 'Your friends' });
    expect(await within(list).findByText('sam@punchlist.test · Made by kim')).toBeInTheDocument();
  });

  it('says friends need a server when there is none', async () => {
    await renderApp('/friends');
    expect(await screen.findByText(/Friends need a PeckList server/)).toBeInTheDocument();
  });
});

describe('friend link', () => {
  it('shows who it is, then accepts', async () => {
    const backend = new FakeBackend();
    backend.addAccount('sam', 'sams own password');
    const { transport } = await signedIn('/f/SAM', backend);
    expect(await screen.findByText('sam wants to be friends')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Accept' }));
    expect(await screen.findByText('You and sam are friends now.')).toBeInTheDocument();
    expect(transport.accepted).toEqual(['SAM']);
  });

  it('explains a dead link and your own link', async () => {
    await signedIn('/f/GONE');
    expect(await screen.findByText(/no longer valid/)).toBeInTheDocument();
  });

  it('recognizes your own link', async () => {
    await signedIn('/f/BEN');
    expect(await screen.findByText(/This is your own friend link/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull();
  });
});

describe('what you share', () => {
  it('lists shared lists and assigned tasks by person, and stops sharing one', async () => {
    const { store } = await signedIn('/friends');
    expect(await screen.findByText(/Nothing yet\. Share a list/)).toBeInTheDocument();
    const sam = '01JBSAM0000000000000000001';
    act(() =>
      store.getState().apply((ctx, ws) => {
        let next = putEntity(
          ws,
          'users',
          createEntity<User>(ctx, {
            handle: 'sam@punchlist.test',
            displayName: 'Sam',
            avatarColor: '#A7C7E7',
            homeServer: 'punchlist.test',
          }),
        );
        const made = next.entities.users.at(-1)!;
        next = {
          ...next,
          entities: {
            ...next.entities,
            users: [...next.entities.users.slice(0, -1), { ...made, id: sam }],
          },
        };
        const garden = createList(ctx, next, { name: 'Garden', color: '#CFE3A3' });
        next = shareList(ctx, garden.workspace, garden.list.id, `user:${sam}`, 'editor');
        const gift = createTask(ctx, next, { title: 'Hide the gift', listId: inboxList(next).id });
        return setAssignee(ctx, gift.workspace, gift.task.id, `user:${sam}`, true);
      }),
    );
    const section = await screen.findByRole('region', { name: 'What you share' });
    const card = within(section).getByRole('region', { name: 'Sam' });
    expect(within(card).getByRole('button', { name: /Garden\s*Can edit/ })).toBeInTheDocument();
    expect(
      within(card).getByRole('button', { name: /Hide the gift\s*Assigned/ }),
    ).toBeInTheDocument();

    await userEvent.click(
      within(card).getByRole('button', { name: 'Unassign Sam from Hide the gift' }),
    );
    expect(within(card).queryByText('Hide the gift')).toBeNull();
    await userEvent.click(
      within(card).getByRole('button', { name: 'Stop sharing Garden with Sam' }),
    );
    expect(await within(section).findByText(/Nothing yet\. Share a list/)).toBeInTheDocument();
  });
});
