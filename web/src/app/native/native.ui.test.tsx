import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { problemOf } from '../../adapters/capacitor-shell.ts';
import type {
  ConnectTrust,
  HeldPress,
  NativeShell,
  ServerCheck,
  ShellInfo,
} from '../../ports/nativeShell.ts';
import { createTask } from '../../core/tasks.ts';
import { renderApp, testStore } from '../../test/renderApp.tsx';
import { AppProviders } from '../providers.tsx';
import { AppRoutes } from '../routes.tsx';
import { NativeFirstRun } from './FirstRun.tsx';
import { setNativeShell } from './shell.ts';

/** The Android shell, faked: answers checks from a table and records where the app went. */
class FakeShell implements NativeShell {
  notificationSettings(): Promise<void> {
    return Promise.resolve();
  }
  /** What the phone handed over on connecting (api 6), and for which server. */
  handed: { workspace: string; server: string } | null = null;
  carry(workspace: string, server: string): Promise<void> {
    this.handed = { workspace, server };
    return Promise.resolve();
  }
  carried(): Promise<string | null> {
    return Promise.resolve(this.handed?.workspace ?? null);
  }
  clearCarried(): Promise<void> {
    this.handed = null;
    return Promise.resolve();
  }
  held(): Promise<HeldPress[]> {
    return Promise.resolve([]);
  }
  onHeld(): () => void {
    return () => undefined;
  }
  went: string[] = [];
  servers = new Map<string, ServerCheck>();
  constructor(
    public server: string | null = null,
    public api = 1,
  ) {}
  info(): Promise<ShellInfo> {
    return Promise.resolve({ api: this.api, server: this.server, version: '0.1.0' });
  }
  checkServer(address: string): Promise<ServerCheck> {
    return Promise.resolve(this.servers.get(address) ?? { ok: false, problem: 'unreachable' });
  }
  /** What the person agreed to on each connect (api 8). */
  trusted: ConnectTrust[] = [];
  /** The shell's own dialog says no (api 8, audit A4). */
  refuse = false;
  connect(url: string, trust: ConnectTrust = {}): Promise<void> {
    if (this.refuse)
      return Promise.reject(Object.assign(new Error('cancelled'), { code: 'cancelled' }));
    this.went.push(url);
    this.trusted.push(trust);
    return Promise.resolve();
  }
  disconnect(): Promise<void> {
    this.went.push('standalone');
    return Promise.resolve();
  }
  // Api 1: a shell from before the background check-in.
  backgroundCheck(): Promise<never> {
    return Promise.reject(new Error('not implemented'));
  }
  setBackgroundCheck(): Promise<never> {
    return this.backgroundCheck();
  }
  allowBackground(): Promise<never> {
    return this.backgroundCheck();
  }
}

const pecklist = (url: string): ServerCheck => ({
  ok: true,
  url,
  info: { name: 'pecklist', version: '0.5.0', schemaVersion: 6 },
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
    // The first render loads the lazy routes cold: slow with coverage on a busy machine.
    const slow = { timeout: 10_000 };
    expect(
      await screen.findByRole('heading', { name: 'Connect to a server' }, slow),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Use on this device only' }));
    expect(await screen.findByRole('heading', { name: 'Today' }, slow)).toBeInTheDocument();
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
    expect(await screen.findByRole('heading', { name: 'Today' }, slow)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Connect to a server' })).toBeNull();
    expect(shell.went).toEqual([]);
  });

  it('checks the address, then moves the app to the origin the server answers on', async () => {
    const shell = new FakeShell();
    shell.servers.set('tasks.example.com', pecklist('https://tasks.example.com'));
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

  it("hands the phone's own tasks to the server it connects to, and nothing when it has none (PL-070)", async () => {
    const shell = new FakeShell(null, 6);
    shell.servers.set('tasks.example.com', pecklist('https://tasks.example.com'));
    setNativeShell(shell);
    const store = testStore();
    await renderApp('/connect', store);
    store.getState().apply((ctx, ws) => {
      const inbox = ws.entities.lists.find((list) => list.isInbox)!.id;
      return createTask(ctx, ws, { title: 'Pick up the garlic', listId: inbox }).workspace;
    });
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Server address' }),
      'tasks.example.com{Enter}',
    );
    await screen.findByRole('button', { name: 'Connecting...' });
    expect(shell.went).toEqual(['https://tasks.example.com']);
    expect(shell.handed?.server).toBe('https://tasks.example.com');
    expect(shell.handed?.workspace).toContain('Pick up the garlic');
  });

  it('hands nothing over from a phone with no tasks of its own', async () => {
    const shell = new FakeShell(null, 6);
    shell.servers.set('tasks.example.com', pecklist('https://tasks.example.com'));
    setNativeShell(shell);
    await renderApp('/connect');
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Server address' }),
      'tasks.example.com{Enter}',
    );
    await screen.findByRole('button', { name: 'Connecting...' });
    expect(shell.went).toEqual(['https://tasks.example.com']);
    expect(shell.handed).toBeNull();
  });

  it('asks before using a server on plain http', async () => {
    const shell = new FakeShell();
    shell.servers.set('192.168.1.20:8080', pecklist('http://192.168.1.20:8080'));
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
    // The shell keeps that yes for this server only (audit A2).
    expect(shell.trusted).toEqual([{ plainHttp: true }]);
  });

  it('shows where a redirect leads before going there (audit E3)', async () => {
    const shell = new FakeShell();
    shell.servers.set('tasks.example.com', pecklist('https://elsewhere.example.net'));
    setNativeShell(shell);
    await renderApp('/connect');
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Server address' }),
      'tasks.example.com{Enter}',
    );
    const notice = await screen.findByText(/sends the app on to https:\/\/elsewhere\.example\.net/);
    expect(shell.went).toEqual([]);
    await userEvent.click(
      within(notice.closest('[role="alert"]')!).getByRole('button', { name: 'Continue' }),
    );
    expect(shell.went).toEqual(['https://elsewhere.example.net']);
  });

  it('goes straight on when only the scheme changed', async () => {
    const shell = new FakeShell();
    shell.servers.set('http://tasks.example.com', pecklist('https://tasks.example.com'));
    setNativeShell(shell);
    await renderApp('/connect');
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Server address' }),
      'http://tasks.example.com{Enter}',
    );
    await screen.findByRole('button', { name: 'Connecting...' });
    expect(shell.went).toEqual(['https://tasks.example.com']);
  });

  it('says plain http after a redirect to it, too', async () => {
    const shell = new FakeShell();
    shell.servers.set('tasks.example.com', pecklist('http://192.168.1.20:8080'));
    setNativeShell(shell);
    await renderApp('/connect');
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Server address' }),
      'tasks.example.com{Enter}',
    );
    const notice = await screen.findByText(/sends the app on to/);
    await userEvent.click(
      within(notice.closest('[role="alert"]')!).getByRole('button', { name: 'Continue' }),
    );
    expect(await screen.findByText(/plain http/)).toBeInTheDocument();
    expect(shell.went).toEqual([]);
  });

  it('asks before trusting an authority installed on this phone (audit A2)', async () => {
    const shell = new FakeShell(null, 8);
    shell.servers.set('tasks.home.lan', {
      ok: false,
      problem: 'installed-ca',
      url: 'https://tasks.home.lan',
    });
    setNativeShell(shell);
    await renderApp('/connect');
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Server address' }),
      'tasks.home.lan{Enter}',
    );
    const warning = await screen.findByText(/authority installed on this phone/);
    expect(shell.went).toEqual([]);
    await userEvent.click(
      within(warning.closest('[role="alert"]')!).getByRole('button', { name: 'Trust it' }),
    );
    expect(shell.went).toEqual(['https://tasks.home.lan']);
    expect(shell.trusted).toEqual([{ installedCa: true }]);
  });

  it("goes back to the address when the shell's own dialog says no (audit A4)", async () => {
    const shell = new FakeShell('https://tasks.example.com', 8);
    shell.servers.set('other.example.com', pecklist('https://other.example.com'));
    shell.refuse = true;
    setNativeShell(shell);
    await renderApp('/connect');
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Server address' }),
      'other.example.com{Enter}',
    );
    expect(await screen.findByRole('button', { name: 'Connect' })).toBeEnabled();
    expect(shell.went).toEqual([]);
  });

  it('always offers a way off the server, even when connecting fails', async () => {
    const shell = new FakeShell('https://tasks.example.com');
    setNativeShell(shell);
    await renderApp('/connect');
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Server address' }),
      'nothing.example.com{Enter}',
    );
    expect(await screen.findByText(/Could not reach that address/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Use on this device only' }));
    expect(shell.went).toEqual(['standalone']);
  });

  it('names what is wrong with an address the shell refused', async () => {
    expect(problemOf({ code: 'certificate' })).toBe('certificate');
    expect(problemOf({ code: 'not-pecklist' })).toBe('not-pecklist');
    expect(problemOf({ code: 'installed-ca' })).toBe('installed-ca');
    expect(problemOf(new Error('boom'))).toBe('unreachable');
    expect(problemOf(null)).toBe('unreachable');
  });
});

describe('android: settings > server', () => {
  it('is not there in a browser', async () => {
    await renderApp('/settings/account');
    expect(screen.queryByRole('region', { name: 'Server' })).toBeNull();
  });

  it('offers to connect when standalone', async () => {
    setNativeShell(new FakeShell());
    await renderApp('/settings/account');
    const section = await screen.findByRole('region', { name: 'Server' });
    expect(within(section).getByText('This device only')).toBeInTheDocument();
    await userEvent.click(within(section).getByRole('button', { name: 'Connect' }));
    expect(await screen.findByRole('heading', { name: 'Connect to a server' })).toBeInTheDocument();
  });

  it('shows the server and disconnects only after asking', async () => {
    const shell = new FakeShell('https://tasks.example.com');
    setNativeShell(shell);
    await renderApp('/settings/account');
    const section = await screen.findByRole('region', { name: 'Server' });
    expect(within(section).getByText('https://tasks.example.com')).toBeInTheDocument();
    await userEvent.click(within(section).getByRole('button', { name: 'Disconnect' }));
    const dialog = await screen.findByRole('dialog', { name: 'Use PeckList without a server?' });
    expect(shell.went).toEqual([]);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Disconnect' }));
    expect(shell.went).toEqual(['standalone']);
  });

  it('leaves the asking to a shell that asks in its own dialog (api 8, audit A4)', async () => {
    const shell = new FakeShell('https://tasks.example.com', 8);
    setNativeShell(shell);
    await renderApp('/settings/account');
    const section = await screen.findByRole('region', { name: 'Server' });
    await userEvent.click(within(section).getByRole('button', { name: 'Disconnect' }));
    expect(screen.queryByRole('dialog', { name: 'Use PeckList without a server?' })).toBeNull();
    expect(shell.went).toEqual(['standalone']);
  });
});

describe('versions', () => {
  // R-FB-77: phones have no sidebar to show the version; the Android app has one of its own too.
  it("show at the bottom of the profile menu, with the Android app's own", async () => {
    setNativeShell(new FakeShell());
    await renderApp('/today', testStore());
    await userEvent.click(screen.getByRole('button', { name: 'Your account' }));
    const menu = await screen.findByRole('menu');
    expect(
      within(menu).getByRole('link', { name: /^PeckList v\d+\.\d+\.\d+.*: what changed$/ }),
    ).toHaveTextContent(/^PeckList v\d/);
    expect(await within(menu).findByText('Android app 0.1.0')).toBeInTheDocument();
  });

  it('show only the web version in a browser', async () => {
    await renderApp('/today', testStore());
    await userEvent.click(screen.getByRole('button', { name: 'Your account' }));
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByText(/^PeckList v\d/)).toBeInTheDocument();
    expect(within(menu).queryByText(/^Android app/)).toBeNull();
  });
});
