import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryStorage } from '../../adapters/memory-storage.ts';
import { FakeBackend } from '../../test/fakeTransport.ts';
import { mockViewport, renderApp, testStore } from '../../test/renderApp.tsx';
import { createSyncEngine } from '../sync/syncEngine.ts';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.unstubAllGlobals();
  mockViewport('desktop');
});

async function serverApp(backend: FakeBackend) {
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
  return renderApp('/today', store, sync);
}

function benOn(version: string) {
  const backend = new FakeBackend();
  backend.addAccount('ben', 'correct horse battery');
  backend.serverVersion = version;
  return backend;
}

const slow = { timeout: 10_000 };

describe('versions in the profile menu (R-FB-147)', () => {
  it('a check when this page is the server’s version, a ! that explains when it is not', async () => {
    await serverApp(benOn(__APP_VERSION__));
    await userEvent.click(await screen.findByRole('button', { name: /^Account: / }, slow));
    expect(await screen.findByRole('button', { name: 'Up to date' })).toBeInTheDocument();
  });

  it('a page from another version says so, and offers a reload', async () => {
    await serverApp(benOn('9.9.9'));
    await userEvent.click(await screen.findByRole('button', { name: /^Account: / }, slow));
    await userEvent.click(await screen.findByRole('button', { name: 'Needs an update' }));
    const why = await screen.findByRole('dialog');
    expect(within(why).getByText(/your server runs 9\.9\.9/)).toBeInTheDocument();
    expect(within(why).getByRole('button', { name: 'Reload' })).toBeInTheDocument();
  });
});

describe('the update notice (R-FB-148)', () => {
  it('names a newer release, links its page, and skipping hides it for that release', async () => {
    const backend = benOn('0.2.7');
    backend.latestRelease = { version: '0.2.8', url: 'https://example.test/releases/v0.2.8' };
    await serverApp(backend);
    const notice = await screen.findByRole('status', { name: 'Update available' }, slow);
    expect(
      within(notice).getByText('PeckList 0.2.8 is out. This server runs 0.2.7.'),
    ).toBeInTheDocument();
    expect(within(notice).getByRole('link', { name: 'Release page' })).toHaveAttribute(
      'href',
      'https://example.test/releases/v0.2.8',
    );
    await userEvent.click(within(notice).getByRole('button', { name: 'Skip this release' }));
    await waitFor(() =>
      expect(screen.queryByRole('status', { name: 'Update available' })).toBeNull(),
    );
    expect(localStorage.getItem('punchlist.skippedRelease')).toBe('0.2.8');
  });

  it('shows nothing while the server is on the newest release, or knows of none', async () => {
    const backend = benOn('0.2.8');
    backend.latestRelease = { version: '0.2.8', url: 'https://example.test' };
    await serverApp(backend);
    await screen.findByRole('button', { name: /^Account: / }, slow);
    expect(screen.queryByRole('status', { name: 'Update available' })).toBeNull();
  });
});

describe('the hidden menu (R-FB-149)', () => {
  it('slides out when the mouse rests at the left edge and goes when it leaves', async () => {
    localStorage.setItem('punchlist.sidebarCollapsed', 'true');
    await renderApp('/today', testStore());
    expect(screen.queryByRole('complementary', { name: 'Menu' })).toBeNull();
    fireEvent.pointerEnter(await screen.findByTestId('sidebar-peek-edge'));
    const menu = await screen.findByRole('complementary', { name: 'Menu' });
    expect(within(menu).getByText('Today')).toBeInTheDocument();
    fireEvent.pointerMove(document, { clientX: 900, clientY: 300 });
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Menu' })).toBeNull());
  });
});
