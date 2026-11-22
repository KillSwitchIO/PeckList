import { act, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryStorage } from '../../adapters/memory-storage.ts';
import { createBrowserPush } from '../../adapters/browser-push.ts';
import { inboxList } from '../../core/lists.ts';
import { updateSettings } from '../../core/settings.ts';
import { createTask } from '../../core/tasks.ts';
import type {
  BackgroundCheck,
  HeldPress,
  NativeShell,
  PhoneChannelKind,
  PhoneChannels,
  SyncedChannelKind,
} from '../../ports/nativeShell.ts';
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
    const { transport } = await signedIn('/settings/notifications', backend);
    const section = await screen.findByRole('region', { name: 'On this device' });
    const toggle = within(section).getByRole('switch', {
      name: 'Notify me when PeckList is closed',
    });
    await waitFor(() => expect(toggle).toBeEnabled());
    expect(toggle).not.toBeChecked();
    await userEvent.click(toggle);
    await waitFor(() => expect(toggle).toBeChecked());
    expect(push.keys).toEqual(['BFAKEKEY']);
    expect(transport.pushed.get('https://push.example/ben')).toBe('ben');
    // With the clock the app shows here on Automatic (schema 22): jsdom's en-US reads 12-hour.
    expect(transport.pushedClocks.at(-1)).toEqual({
      endpoint: 'https://push.example/ben',
      clock24: false,
    });
    await userEvent.click(toggle);
    await waitFor(() => expect(toggle).not.toBeChecked());
    expect(transport.pushed.size).toBe(0);
  });

  it('pick which kinds reach me, for every device', async () => {
    setBrowserPush(fakePush());
    const backend = new FakeBackend();
    backend.addAccount('ben', 'correct horse battery');
    const { store } = await signedIn('/settings/notifications', backend);
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
    await signedIn('/settings/notifications', backend);
    expect(await screen.findByText(/add PeckList to your Home Screen/)).toBeInTheDocument();
    expect(
      screen.getByRole('switch', { name: 'Notify me when PeckList is closed' }),
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

/**
 * The Android shell at api 10, with its notification channels faked as the shell keeps them: each
 * kind on or off on the phone, and only what was switched since the last read reported as changed.
 */
class ChannelShell extends CheckingShell {
  channels: Record<PhoneChannelKind, boolean> = {
    reminders: true,
    constant: true,
    assignments: true,
    shares: true,
    comments: true,
  };
  private seen: Partial<Record<PhoneChannelKind, boolean>> = {};
  openedChannels: PhoneChannelKind[] = [];
  constructor() {
    super(10);
  }
  notificationChannels(): Promise<PhoneChannels> {
    const changed: PhoneChannels['changed'] = {};
    for (const kind of ['reminders', 'assignments', 'shares', 'comments'] as SyncedChannelKind[]) {
      const before = this.seen[kind];
      if (before !== undefined && before !== this.channels[kind])
        changed[kind] = this.channels[kind];
    }
    this.seen = { ...this.channels };
    return Promise.resolve({ channels: { ...this.channels }, changed });
  }
  openNotificationChannel(kind: PhoneChannelKind) {
    this.openedChannels.push(kind);
    return Promise.resolve();
  }
}

/** The app back on screen, as from Android's settings. */
function backOnScreen() {
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
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
    await signedIn('/settings/notifications', backend);
    const kinds = await screen.findByRole('region', { name: 'Tell me about' });
    await userEvent.click(within(kinds).getByRole('button', { name: 'Manage on the phone' }));
    expect(shell.opened).toBe(1);
  });

  it("show each kind as the phone's channel shows it, and open that channel (api 10)", async () => {
    const shell = new ChannelShell();
    shell.channels.comments = false;
    setNativeShell(shell);
    setNotifier(fakeNotifier('granted'));
    const backend = new FakeBackend();
    backend.addAccount('ben', 'correct horse battery');
    const { store } = await signedIn('/settings/notifications', backend);
    const kinds = await screen.findByRole('region', { name: 'Tell me about' });
    const comments = await within(kinds).findByRole('switch', { name: 'Comments and mentions' });
    await waitFor(() => expect(comments).not.toBeChecked());
    expect(within(kinds).getByRole('switch', { name: 'Constant reminders' })).toBeChecked();
    // Off on the phone: the switch opens its channel, where it is turned back on.
    await userEvent.click(comments);
    await userEvent.click(within(kinds).getByRole('switch', { name: 'Shared lists' }));
    await userEvent.click(within(kinds).getByRole('switch', { name: 'Constant reminders' }));
    expect(shell.openedChannels).toEqual(['comments', 'shares', 'constant']);
    expect(store.getState().workspace!.entities.settings[0]!.notifications).toBeUndefined();
  });

  it('a kind switched on the phone is switched for every device', async () => {
    const shell = new ChannelShell();
    setNativeShell(shell);
    setNotifier(fakeNotifier('granted'));
    const backend = new FakeBackend();
    backend.addAccount('ben', 'correct horse battery');
    const { store } = await signedIn('/settings/notifications', backend);
    const kinds = await screen.findByRole('region', { name: 'Tell me about' });
    const comments = await within(kinds).findByRole('switch', { name: 'Comments and mentions' });
    await waitFor(() => expect(comments).toBeChecked());
    shell.channels.comments = false;
    backOnScreen();
    await waitFor(() =>
      expect(store.getState().workspace!.entities.settings[0]!.notifications).toEqual({
        comments: false,
      }),
    );
    expect(comments).not.toBeChecked();
    shell.channels.comments = true;
    backOnScreen();
    await waitFor(() =>
      expect(store.getState().workspace!.entities.settings[0]!.notifications).toEqual({
        comments: true,
      }),
    );
    expect(comments).toBeChecked();
  });

  it('a channel off all along never turns off a kind turned on elsewhere', async () => {
    const shell = new ChannelShell();
    shell.channels.shares = false;
    setNativeShell(shell);
    setNotifier(fakeNotifier('granted'));
    const backend = new FakeBackend();
    backend.addAccount('ben', 'correct horse battery');
    const { store } = await signedIn('/settings/notifications', backend);
    await screen.findByRole('region', { name: 'Tell me about' });
    backOnScreen();
    backOnScreen();
    await waitFor(() => expect(shell.openedChannels).toEqual([]));
    expect(store.getState().workspace!.entities.settings[0]!.notifications).toBeUndefined();
  });

  it('on Android 7, with no channels, the switches turn kinds on and off here', async () => {
    const shell = new ChannelShell();
    shell.notificationChannels = () => Promise.resolve({ channels: {}, changed: {} });
    setNativeShell(shell);
    setNotifier(fakeNotifier('granted'));
    const backend = new FakeBackend();
    backend.addAccount('ben', 'correct horse battery');
    const { store } = await signedIn('/settings/notifications', backend);
    const kinds = await screen.findByRole('region', { name: 'Tell me about' });
    const comments = await within(kinds).findByRole('switch', { name: 'Comments and mentions' });
    await userEvent.click(comments);
    await waitFor(() =>
      expect(store.getState().workspace!.entities.settings[0]!.notifications).toEqual({
        comments: false,
      }),
    );
    expect(comments).not.toBeChecked();
    expect(shell.openedChannels).toEqual([]);
    expect(within(kinds).queryByRole('switch', { name: 'Constant reminders' })).toBeNull();
  });

  it('turning on a kind whose channel is on needs no trip to the phone settings', async () => {
    const shell = new ChannelShell();
    setNativeShell(shell);
    setNotifier(fakeNotifier('granted'));
    const backend = new FakeBackend();
    backend.addAccount('ben', 'correct horse battery');
    const { store } = await signedIn('/settings/notifications', backend);
    act(() =>
      store
        .getState()
        .apply((ctx, ws) => updateSettings(ctx, ws, { notifications: { shares: false } })),
    );
    const kinds = await screen.findByRole('region', { name: 'Tell me about' });
    const shares = await within(kinds).findByRole('switch', { name: 'Shared lists' });
    expect(shares).not.toBeChecked();
    await userEvent.click(shares);
    await waitFor(() =>
      expect(store.getState().workspace!.entities.settings[0]!.notifications).toEqual({
        shares: true,
      }),
    );
    expect(shell.openedChannels).toEqual([]);
  });

  it('an older app (api 4 and below) has no such button', async () => {
    setNativeShell(new CheckingShell(4));
    setNotifier(fakeNotifier('granted'));
    const backend = new FakeBackend();
    backend.addAccount('ben', 'correct horse battery');
    await signedIn('/settings/notifications', backend);
    const kinds = await screen.findByRole('region', { name: 'Tell me about' });
    expect(within(kinds).queryByRole('button', { name: 'Manage on the phone' })).toBeNull();
  });

  it('check in with the server in the background: on, every 5 minutes, until changed', async () => {
    const shell = new CheckingShell();
    setNativeShell(shell);
    setNotifier(fakeNotifier('granted'));
    const backend = new FakeBackend();
    backend.addAccount('ben', 'correct horse battery');
    await signedIn('/settings/notifications', backend);
    const section = await screen.findByRole('region', { name: 'On this device' });
    const toggle = await within(section).findByRole('switch', {
      name: 'Check for updates in the background',
    });
    expect(toggle).toBeChecked();
    // No Web Push in the app: its switch is not offered.
    expect(
      within(section).queryByRole('switch', { name: 'Notify me when PeckList is closed' }),
    ).toBeNull();

    await userEvent.click(within(section).getByRole('combobox', { name: 'Check every' }));
    await userEvent.click(await screen.findByRole('option', { name: '15 minutes' }));
    await waitFor(() => expect(shell.state.minutes).toBe(15));

    // Android may still put it to sleep: the app says so, and asks when told to.
    const asleep = within(section).getByText(/Android may put PeckList to sleep/);
    await userEvent.click(
      within(asleep.closest('[role="alert"]')!).getByRole('button', { name: 'Allow' }),
    );
    await waitFor(() =>
      expect(within(section).queryByText(/Android may put PeckList to sleep/)).toBeNull(),
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
