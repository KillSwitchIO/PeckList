import { act, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryStorage } from '../../adapters/memory-storage.ts';
import { createBrowserPush } from '../../adapters/browser-push.ts';
import { inboxList } from '../../core/lists.ts';
import { createTask } from '../../core/tasks.ts';
import type { BackgroundCheck, HeldPress, NativeShell } from '../../ports/nativeShell.ts';
import type {
  BrowserPush,
  NotificationPermissionState,
  Notifier,
  PushSubscriptionData,
} from '../../ports/notifier.ts';
import { FakeBackend } from '../../test/fakeTransport.ts';
import { mockViewport, renderApp, testStore } from '../../test/renderApp.tsx';
import { logReminder } from '../reminders/reminderLog.ts';
import { BackgroundCheckPrompt } from '../native/BackgroundCheck.tsx';
import { AppProviders } from '../providers.tsx';
import { AppRoutes } from '../routes.tsx';
import { setNativeShell } from '../native/shell.ts';
import { notifier, setBrowserPush, setNotifier } from '../reminders/notifier.ts';
import { createSyncEngine } from '../sync/syncEngine.ts';

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  mockViewport('desktop');
});
const browserNotifier = notifier();
afterEach(() => {
  setBrowserPush(createBrowserPush());
  setNativeShell(null);
  setNotifier(browserNotifier);
});

function fakePush(supported = true) {
  let current: PushSubscriptionData | null = null;
  const push: BrowserPush & { keys: string[] } = {
    keys: [],
    supported: () => supported,
    current: () => Promise.resolve(current),
    subscribe: (key) => {
      push.keys.push(key);
      current = { endpoint: 'https://push.example/ben', keys: { p256dh: 'p', auth: 'a' } };
      return Promise.resolve(current);
    },
    unsubscribe: () => {
      const had = current?.endpoint ?? null;
      current = null;
      return Promise.resolve(had);
    },
  };
  return push;
}

async function signedIn(path: string, backend: FakeBackend) {
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
  return { ...result, sync, transport };
}

describe('notifications with the app closed', () => {
  it('are turned on and off for this device in Settings', async () => {
    const push = fakePush();
    setBrowserPush(push);
    const backend = new FakeBackend();
    backend.addAccount('ben', 'correct horse battery');
    const { transport } = await signedIn('/settings', backend);
    const section = await screen.findByRole('region', { name: 'Notifications' });
    const toggle = within(section).getByRole('switch', {
      name: 'Notify me when Punchlist is closed',
    });
    await waitFor(() => expect(toggle).toBeEnabled());
    expect(toggle).not.toBeChecked();
    await userEvent.click(toggle);
    await waitFor(() => expect(toggle).toBeChecked());
    expect(push.keys).toEqual(['BFAKEKEY']);
    expect(transport.pushed.get('https://push.example/ben')).toBe('ben');
    await userEvent.click(toggle);
    await waitFor(() => expect(toggle).not.toBeChecked());
    expect(transport.pushed.size).toBe(0);
  });

  it('pick which kinds reach me, for every device', async () => {
    setBrowserPush(fakePush());
    const backend = new FakeBackend();
    backend.addAccount('ben', 'correct horse battery');
    const { store } = await signedIn('/settings', backend);
    const section = await screen.findByRole('region', { name: 'Tell me about' });
    const shares = within(section).getByRole('switch', { name: 'Shared lists' });
    expect(shares).toBeChecked();
    await userEvent.click(shares);
    await waitFor(() =>
      expect(store.getState().workspace!.entities.settings[0]!.notifications).toEqual({
        shares: false,
      }),
    );
    expect(within(section).getByRole('switch', { name: 'Reminders' })).toBeChecked();
    await userEvent.click(within(section).getByRole('switch', { name: 'Vibrate' }));
    await waitFor(() =>
      expect(store.getState().workspace!.entities.settings[0]!.notifications).toEqual({
        shares: false,
        vibrate: false,
      }),
    );
  });

  it('say where they cannot work', async () => {
    setBrowserPush(fakePush(false));
    const backend = new FakeBackend();
    backend.addAccount('ben', 'correct horse battery');
    await signedIn('/settings', backend);
    expect(await screen.findByText(/add Punchlist to your Home Screen/)).toBeInTheDocument();
    expect(
      screen.getByRole('switch', { name: 'Notify me when Punchlist is closed' }),
    ).toBeDisabled();
  });

  it('show a reminder the server also sent only once', async () => {
    setBrowserPush(fakePush());
    const backend = new FakeBackend();
    backend.addAccount('ben', 'correct horse battery');
    const { store, sync } = await signedIn('/notifications', backend);
    let taskId = '';
    act(() =>
      store.getState().apply((ctx, ws) => {
        const made = createTask(ctx, ws, { title: 'Water plants', listId: inboxList(ws).id });
        taskId = made.task.id;
        return made.workspace;
      }),
    );
    const at = Date.parse('2026-10-24T14:00:00Z');
    act(() => logReminder({ id: `${taskId}@${at}`, taskId, at }));
    backend.notifications.set('ben', [
      {
        id: 'S1',
        kind: 'reminder',
        at: new Date(at).toISOString(),
        actorId: null,
        taskId,
        listId: null,
        commentId: null,
        read: false,
      },
    ]);
    await act(() => sync.getState().syncNow());
    const list = await screen.findByRole('list', { name: 'Notifications' });
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(1));
  });
});

/** The Android shell with the background check-in (api 2), faked. */
class CheckingShell implements NativeShell {
  state: BackgroundCheck = {
    enabled: true,
    minutes: 5,
    choices: [5, 15, 30, 60],
    unrestricted: false,
    asked: false,
    maker: 'google',
  };
  asks = 0;
  opened = 0;
  constructor(public api = 2) {}
  info() {
    return Promise.resolve({
      api: this.api,
      server: 'https://tasks.example.com',
      version: '0.1.0',
    });
  }
  checkServer() {
    return Promise.resolve({ ok: false as const, problem: 'unreachable' as const });
  }
  connect() {
    return Promise.resolve();
  }
  disconnect() {
    return Promise.resolve();
  }
  backgroundCheck() {
    return Promise.resolve({ ...this.state });
  }
  setBackgroundCheck(change: { enabled?: boolean; minutes?: number }) {
    this.state = { ...this.state, ...change };
    return this.backgroundCheck();
  }
  allowBackground() {
    this.asks++;
    // As if the person said yes in Android's dialog.
    this.state = { ...this.state, asked: true, unrestricted: true };
    return this.backgroundCheck();
  }
  notificationSettings() {
    this.opened++;
    return Promise.resolve();
  }
  carried(): Promise<string | null> {
    return Promise.resolve(null);
  }
  carry(): Promise<void> {
    return Promise.resolve();
  }
  clearCarried(): Promise<void> {
    return Promise.resolve();
  }
  held(): Promise<HeldPress[]> {
    return Promise.resolve([]);
  }
  onHeld(): () => void {
    return () => undefined;
  }
}

function fakeNotifier(start: NotificationPermissionState) {
  let permission = start;
  const fake: Notifier & { requests: number } = {
    requests: 0,
    permission: () => permission,
    request: () => {
      fake.requests++;
      permission = 'granted';
      return Promise.resolve(permission);
    },
    show: () => Promise.resolve(),
  };
  return fake;
}

async function signedInWithPrompt(backend: FakeBackend) {
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
  const result = render(
    <AppProviders store={store} sync={sync}>
      <MemoryRouter initialEntries={['/today']}>
        <AppRoutes />
        <BackgroundCheckPrompt />
      </MemoryRouter>
    </AppProviders>,
  );
  await waitFor(() => expect(sync.getState().phase).toBe('ready'));
  return result;
}

describe('notifications in the Android app', () => {
  it("open the phone's own notification settings for sounds and vibration (api 5)", async () => {
    const shell = new CheckingShell(5);
    setNativeShell(shell);
    setNotifier(fakeNotifier('granted'));
    const backend = new FakeBackend();
    backend.addAccount('ben', 'correct horse battery');
    await signedIn('/settings', backend);
    const kinds = await screen.findByRole('region', { name: 'Tell me about' });
    await userEvent.click(within(kinds).getByRole('button', { name: 'Manage on the phone' }));
    expect(shell.opened).toBe(1);
  });

  it('an older app (api 4 and below) has no such button', async () => {
    setNativeShell(new CheckingShell(4));
    setNotifier(fakeNotifier('granted'));
    const backend = new FakeBackend();
    backend.addAccount('ben', 'correct horse battery');
    await signedIn('/settings', backend);
    const kinds = await screen.findByRole('region', { name: 'Tell me about' });
    expect(within(kinds).queryByRole('button', { name: 'Manage on the phone' })).toBeNull();
  });

  it('check in with the server in the background: on, every 5 minutes, until changed', async () => {
    const shell = new CheckingShell();
    setNativeShell(shell);
    setNotifier(fakeNotifier('granted'));
    const backend = new FakeBackend();
    backend.addAccount('ben', 'correct horse battery');
    await signedIn('/settings', backend);
    const section = await screen.findByRole('region', { name: 'Notifications' });
    const toggle = await within(section).findByRole('switch', {
      name: 'Check for updates in the background',
    });
    expect(toggle).toBeChecked();
    // No Web Push in the app: its switch is not offered.
    expect(
      within(section).queryByRole('switch', { name: 'Notify me when Punchlist is closed' }),
    ).toBeNull();

    await userEvent.click(within(section).getByRole('combobox', { name: 'Check every' }));
    await userEvent.click(await screen.findByRole('option', { name: '15 minutes' }));
    await waitFor(() => expect(shell.state.minutes).toBe(15));

    // Android may still put it to sleep: the app says so, and asks when told to.
    const asleep = within(section).getByText(/Android may put Punchlist to sleep/);
    await userEvent.click(
      within(asleep.closest('[role="alert"]')!).getByRole('button', { name: 'Allow' }),
    );
    await waitFor(() =>
      expect(within(section).queryByText(/Android may put Punchlist to sleep/)).toBeNull(),
    );

    await userEvent.click(toggle);
    await waitFor(() => expect(shell.state.enabled).toBe(false));
    expect(within(section).getByRole('combobox', { name: 'Check every' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('asks once, after signing in, to show notifications and run in the background', async () => {
    const shell = new CheckingShell();
    setNativeShell(shell);
    const fake = fakeNotifier('default');
    setNotifier(fake);
    const backend = new FakeBackend();
    backend.addAccount('ben', 'correct horse battery');
    const first = await signedInWithPrompt(backend);
    await waitFor(() => expect(shell.asks).toBe(1));
    expect(fake.requests).toBe(1);
    first.unmount();

    // Next start: asked already, so Settings is where to change it.
    await signedInWithPrompt(backend);
    await act(() => new Promise((done) => setTimeout(done, 50)));
    expect(shell.asks).toBe(1);
  });
});
