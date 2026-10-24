import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { problemOf } from '../../adapters/capacitor-shell.ts';
import type { NativeShell, ServerCheck, ShellInfo } from '../../ports/nativeShell.ts';
import { renderApp, testStore } from '../../test/renderApp.tsx';
import { AppProviders } from '../providers.tsx';
import { AppRoutes } from '../routes.tsx';
import { NativeFirstRun } from './FirstRun.tsx';
import { setNativeShell } from './shell.ts';

/** The Android shell, faked: answers checks from a table and records where the app went. */
class FakeShell implements NativeShell {
  went: string[] = [];
  servers = new Map<string, ServerCheck>();
  constructor(public server: string | null = null) {}
  info(): Promise<ShellInfo> {
    return Promise.resolve({ api: 1, server: this.server, version: '0.1.0' });
  }
  checkServer(address: string): Promise<ServerCheck> {
    return Promise.resolve(this.servers.get(address) ?? { ok: false, problem: 'unreachable' });
  }
  connect(url: string): Promise<void> {
    this.went.push(url);
    return Promise.resolve();
  }
  disconnect(): Promise<void> {
    this.went.push('standalone');
    return Promise.resolve();
  }
}

const punchlist = (url: string): ServerCheck => ({
  ok: true,
  url,
  info: { name: 'punchlist', version: '0.5.0', schemaVersion: 6 },
});

beforeEach(() => localStorage.clear());
afterEach(() => setNativeShell(null));

describe('android: connecting to a server', () => {
  it('opens the connect page on first start, until the person picks one way', async () => {
    const shell = new FakeShell();
    setNativeShell(shell);
    const first = render(
      <AppProviders store={testStore()}>
        <MemoryRouter initialEntries={['/today']}>
          <AppRoutes />
          <NativeFirstRun />
        </MemoryRouter>
      </AppProviders>,
    );
    expect(await screen.findByRole('heading', { name: 'Connect to a server' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Use on this device only' }));
    expect(await screen.findByRole('heading', { name: 'Today' })).toBeInTheDocument();
    first.unmount();

    // Next start: the choice stands.
    render(
      <AppProviders store={testStore()}>
        <MemoryRouter initialEntries={['/today']}>
          <AppRoutes />
          <NativeFirstRun />
        </MemoryRouter>
      </AppProviders>,
    );
    expect(await screen.findByRole('heading', { name: 'Today' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Connect to a server' })).toBeNull();
    expect(shell.went).toEqual([]);
  });

  it('checks the address, then moves the app to the origin the server answers on', async () => {
    const shell = new FakeShell();
    shell.servers.set('tasks.example.com', punchlist('https://tasks.example.com'));
    setNativeShell(shell);
    await renderApp('/connect');
    const address = screen.getByRole('textbox', { name: 'Server address' });

    await userEvent.type(address, 'nothing.example.com{Enter}');
    expect(await screen.findByText(/Could not reach that address/)).toBeInTheDocument();
    expect(shell.went).toEqual([]);

    await userEvent.clear(address);
    await userEvent.type(address, 'tasks.example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }));
    await screen.findByRole('button', { name: 'Connecting...' });
    expect(shell.went).toEqual(['https://tasks.example.com']);
  });

  it('asks before using a server on plain http', async () => {
    const shell = new FakeShell();
    shell.servers.set('192.168.1.20:8080', punchlist('http://192.168.1.20:8080'));
    setNativeShell(shell);
    await renderApp('/connect');
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Server address' }),
      '192.168.1.20:8080{Enter}',
    );
    const warning = await screen.findByText(/plain http/);
    expect(shell.went).toEqual([]);
    await userEvent.click(
      within(warning.closest('[role="alert"]')!).getByRole('button', { name: 'Connect anyway' }),
    );
    expect(shell.went).toEqual(['http://192.168.1.20:8080']);
  });

  it('names what is wrong with an address the shell refused', async () => {
    expect(problemOf({ code: 'certificate' })).toBe('certificate');
    expect(problemOf({ code: 'not-punchlist' })).toBe('not-punchlist');
    expect(problemOf(new Error('boom'))).toBe('unreachable');
    expect(problemOf(null)).toBe('unreachable');
  });
});

describe('android: settings > server', () => {
  it('is not there in a browser', async () => {
    await renderApp('/settings');
    expect(screen.queryByRole('region', { name: 'Server' })).toBeNull();
  });

  it('offers to connect when standalone', async () => {
    setNativeShell(new FakeShell());
    await renderApp('/settings');
    const section = await screen.findByRole('region', { name: 'Server' });
    expect(within(section).getByText('This device only')).toBeInTheDocument();
    await userEvent.click(within(section).getByRole('button', { name: 'Connect' }));
    expect(await screen.findByRole('heading', { name: 'Connect to a server' })).toBeInTheDocument();
  });

  it('shows the server and disconnects only after asking', async () => {
    const shell = new FakeShell('https://tasks.example.com');
    setNativeShell(shell);
    await renderApp('/settings');
    const section = await screen.findByRole('region', { name: 'Server' });
    expect(within(section).getByText('https://tasks.example.com')).toBeInTheDocument();
    await userEvent.click(within(section).getByRole('button', { name: 'Disconnect' }));
    const dialog = await screen.findByRole('dialog', { name: 'Use Punchlist without a server?' });
    expect(shell.went).toEqual([]);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Disconnect' }));
    expect(shell.went).toEqual(['standalone']);
  });
});
