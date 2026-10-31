import { cleanup, screen, waitFor, within } from '@testing-library/react';
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

const slow = { timeout: 10_000 };
const DEMO = {
  resetTime: '04:00',
  accounts: [
    { username: 'demo-sam', password: 'try-punchlist-sam' },
    { username: 'demo-alex', password: 'try-punchlist-alex' },
  ],
};

async function serverApp(backend: FakeBackend, signedInAs: string | null) {
  const store = testStore();
  const transport = backend.device();
  transport.session = signedInAs;
  const sync = createSyncEngine({
    transport,
    workspace: store,
    storage: createMemoryStorage(),
    debounceMs: 60_000,
    intervalMs: 600_000,
  });
  return renderApp('/today', store, sync);
}

function demoServer(demo: typeof DEMO | null = DEMO) {
  const backend = new FakeBackend();
  backend.addAccount('ben', 'correct horse battery');
  backend.demo = demo;
  return backend;
}

describe('the demo server banner (PL-117)', () => {
  it('says the server resets nightly and anyone can sign up, on the sign-in page', async () => {
    await serverApp(demoServer(), null);
    const banner = await screen.findByRole('status', { name: 'Demo server' }, slow);
    expect(banner).toHaveTextContent(
      'Demo server: resets every night at 04:00, anyone can sign up',
    );
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('shows the demo accounts and their passwords behind one button', async () => {
    await serverApp(demoServer(), 'ben');
    const banner = await screen.findByRole('status', { name: 'Demo server' }, slow);
    await userEvent.click(within(banner).getByRole('button', { name: 'Demo accounts' }));
    const popover = await screen.findByRole('presentation');
    expect(within(popover).getByText('Try the demo')).toBeInTheDocument();
    expect(within(popover).getByText(/Anyone can sign up/)).toBeInTheDocument();
    expect(within(popover).getByText('demo-sam')).toBeInTheDocument();
    expect(within(popover).getByText('try-punchlist-sam')).toBeInTheDocument();
    expect(within(popover).getByText('demo-alex')).toBeInTheDocument();
    expect(within(popover).getByText('try-punchlist-alex')).toBeInTheDocument();
  });

  it('on a phone, a short line opens the same accounts', async () => {
    mockViewport('phone');
    await serverApp(demoServer(), 'ben');
    const banner = await screen.findByRole('status', { name: 'Demo server' }, slow);
    await userEvent.click(within(banner).getByRole('button', { name: 'Demo, resets at 04:00' }));
    const popover = await screen.findByRole('presentation');
    expect(within(popover).getByText(/Anyone can sign up/)).toBeInTheDocument();
    expect(within(popover).getByText('try-punchlist-sam')).toBeInTheDocument();
  });

  it('stays one line and floats, so the page does not move', async () => {
    await serverApp(demoServer(), 'ben');
    const banner = await screen.findByRole('status', { name: 'Demo server' }, slow);
    expect(getComputedStyle(banner).position).toBe('fixed');
    const line = within(banner).getByText(/resets every night/);
    expect(getComputedStyle(line).whiteSpace).toBe('nowrap');
  });

  it('hides for the rest of the session once closed', async () => {
    const backend = demoServer();
    await serverApp(backend, 'ben');
    const banner = await screen.findByRole('status', { name: 'Demo server' }, slow);
    await userEvent.click(within(banner).getByRole('button', { name: 'Hide for now' }));
    await waitFor(() => expect(screen.queryByRole('status', { name: 'Demo server' })).toBeNull());

    // The same tab opening the app again: still hidden.
    cleanup();
    await serverApp(backend, 'ben');
    await screen.findByRole('button', { name: /^Account: / }, slow);
    expect(screen.queryByRole('status', { name: 'Demo server' })).toBeNull();

    // A new session sees it again.
    cleanup();
    sessionStorage.clear();
    await serverApp(backend, 'ben');
    expect(await screen.findByRole('status', { name: 'Demo server' }, slow)).toBeInTheDocument();
  });

  it('leaves the accounts button out when the server lists none', async () => {
    await serverApp(demoServer({ resetTime: '03:30', accounts: [] }), 'ben');
    const banner = await screen.findByRole('status', { name: 'Demo server' }, slow);
    expect(banner).toHaveTextContent('resets every night at 03:30');
    expect(within(banner).queryByRole('button', { name: 'Demo accounts' })).toBeNull();
  });

  it('is not there on an ordinary server', async () => {
    await serverApp(demoServer(null), 'ben');
    await screen.findByRole('button', { name: /^Account: / }, slow);
    expect(screen.queryByRole('status', { name: 'Demo server' })).toBeNull();
  });
});
