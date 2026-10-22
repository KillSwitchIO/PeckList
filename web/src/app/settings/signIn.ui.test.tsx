import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryStorage } from '../../adapters/memory-storage.ts';
import { FakeBackend } from '../../test/fakeTransport.ts';
import { mockViewport, renderApp, testStore } from '../../test/renderApp.tsx';
import { createSyncEngine } from '../sync/syncEngine.ts';

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  mockViewport('desktop');
});

async function settingsAs(backend: FakeBackend, username: string, path = '/settings') {
  const store = testStore();
  const transport = backend.device();
  transport.session = username;
  const sync = createSyncEngine({
    transport,
    workspace: store,
    storage: createMemoryStorage(),
    debounceMs: 60_000,
    intervalMs: 600_000,
  });
  await renderApp(path, store, sync);
  return screen.findByRole('region', { name: 'Sign-in' });
}

describe('settings: sign-in', () => {
  it('links and unlinks identity providers, never the last way in', async () => {
    const backend = new FakeBackend();
    backend.signIn = {
      providers: [
        { name: 'pocket', displayName: 'Pocket ID' },
        { name: 'keycloak', displayName: 'Keycloak' },
      ],
      localLogin: true,
    };
    // Kim signs in through Pocket ID only.
    backend.addAccount('kim', '');
    backend.identities.set('kim', [
      {
        provider: 'pocket',
        displayName: 'Pocket ID',
        subject: 'kim-sub',
        email: 'kim@example.com',
        linkedAt: '2026-10-22T08:00:00Z',
        lastUsedAt: '2026-10-22T08:00:00Z',
      },
    ]);
    const section = await settingsAs(backend, 'kim', '/settings?link=linked');
    expect(
      within(section).getByText('Linked. You can sign in with it from now on.'),
    ).toBeInTheDocument();
    expect(within(section).getByText('kim@example.com')).toBeInTheDocument();
    expect(within(section).queryByText('Password')).toBeNull();
    expect(within(section).getByRole('link', { name: 'Link Keycloak' })).toHaveAttribute(
      'href',
      '/auth/oidc/keycloak/link',
    );

    await userEvent.click(within(section).getByRole('button', { name: 'Unlink Pocket ID' }));
    expect(
      await within(section).findByText(
        'This is your only way to sign in. Link another account first.',
      ),
    ).toBeInTheDocument();
    expect(within(section).getByText('kim@example.com')).toBeInTheDocument();
  });

  it('a password account unlinks freely; with nothing to link the section stays away', async () => {
    const backend = new FakeBackend();
    backend.signIn = {
      providers: [{ name: 'pocket', displayName: 'Pocket ID' }],
      localLogin: true,
    };
    backend.addAccount('ben', 'correct horse battery');
    backend.identities.set('ben', [
      {
        provider: 'pocket',
        displayName: 'Pocket ID',
        subject: 'ben-sub',
        email: null,
        linkedAt: '2026-10-22T08:00:00Z',
        lastUsedAt: '2026-10-22T08:00:00Z',
      },
    ]);
    const section = await settingsAs(backend, 'ben');
    expect(within(section).getByText('Your username and password')).toBeInTheDocument();
    await userEvent.click(within(section).getByRole('button', { name: 'Unlink Pocket ID' }));
    expect(
      await within(section).findByRole('link', { name: 'Link Pocket ID' }),
    ).toBeInTheDocument();
    expect(within(section).queryByText('ben-sub')).toBeNull();
  });
});
