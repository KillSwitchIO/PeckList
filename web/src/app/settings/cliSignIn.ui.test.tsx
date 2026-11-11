import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryStorage } from '../../adapters/memory-storage.ts';
import { FakeBackend } from '../../test/fakeTransport.ts';
import { mockViewport, renderApp, testStore } from '../../test/renderApp.tsx';
import { createSyncEngine } from '../sync/syncEngine.ts';
import { formatCode } from './cliCode.ts';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.unstubAllGlobals();
  mockViewport('desktop');
});

const slow = { timeout: 10_000 };

function waiting(
  backend: FakeBackend,
  overrides: { adminAsked?: boolean; mayGrantAdmin?: boolean } = {},
) {
  backend.cliSignIns.set('WDJBMJHT', {
    userCode: 'WDJB-MJHT',
    name: 'CLI on build-box',
    requestedAt: '2026-11-10T15:04:00.000Z',
    address: '203.0.113.9',
    yourAddress: '198.51.100.4',
    adminAsked: overrides.adminAsked ?? false,
    mayGrantAdmin: overrides.mayGrantAdmin ?? false,
    state: 'pending',
  });
}

async function open(backend: FakeBackend) {
  backend.addAccount('ben', 'correct horse battery');
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
  return renderApp('/cli', store, sync);
}

describe('signing a terminal in (PL-133)', () => {
  it('formats a typed code as it is shown', () => {
    expect(formatCode('wdjb mjht')).toBe('WDJB-MJHT');
    expect(formatCode('wd1j')).toBe('WDJ');
    expect(formatCode('WDJB-MJHTXX')).toBe('WDJB-MJHT');
  });

  it('shows which terminal asked and from where, and approves it without the admin permission', async () => {
    const backend = new FakeBackend();
    waiting(backend, { adminAsked: true, mayGrantAdmin: true });
    await open(backend);

    await userEvent.type(await screen.findByRole('textbox', { name: 'Code' }, slow), 'wdjbmjht');
    expect(screen.getByRole('textbox', { name: 'Code' })).toHaveValue('WDJB-MJHT');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByText('CLI on build-box wants to sign in')).toBeInTheDocument();
    expect(screen.getByText(/from 203\.0\.113\.9/)).toBeInTheDocument();
    expect(screen.getByText('You are at 198.51.100.4')).toBeInTheDocument();
    // Another address than the approver's: said plainly.
    expect(screen.getByText(/another address than yours/)).toBeInTheDocument();
    expect(screen.getByText(/Only approve a code you just started/)).toBeInTheDocument();
    // Asked for, allowed, and still off until ticked.
    expect(screen.getByRole('checkbox', { name: /admin pages/ })).not.toBeChecked();

    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(
      await screen.findByText(/Your terminal signs in within a few seconds/),
    ).toBeInTheDocument();
    expect(screen.getByText(/CLI: CLI on build-box/)).toBeInTheDocument();
    expect(backend.cliSignIns.get('WDJBMJHT')).toMatchObject({ state: 'approved', admin: false });
  });

  it('offers no admin box unless the terminal asked and the role allows, and denies', async () => {
    const backend = new FakeBackend();
    waiting(backend, { adminAsked: true, mayGrantAdmin: false });
    await open(backend);

    await userEvent.type(await screen.findByRole('textbox', { name: 'Code' }, slow), 'WDJB-MJHT');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByText('CLI on build-box wants to sign in');
    expect(screen.queryByRole('checkbox')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Deny' }));
    expect(await screen.findByText(/no key was made/)).toBeInTheDocument();
    expect(backend.cliSignIns.get('WDJBMJHT')?.state).toBe('denied');
  });

  it('says when no terminal waits with the code', async () => {
    const backend = new FakeBackend();
    await open(backend);
    await userEvent.type(await screen.findByRole('textbox', { name: 'Code' }, slow), 'BCDFGHJK');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText(/No terminal is waiting with this code/)).toBeInTheDocument();
  });
});
