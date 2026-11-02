import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { inboxList } from '../../core/lists.ts';
import { createTask } from '../../core/tasks.ts';
import type {
  BackgroundCheck,
  HeldPress,
  NativeShell,
  ServerCheck,
  ShellInfo,
} from '../../ports/nativeShell.ts';
import type { NotificationAction, Notifier } from '../../ports/notifier.ts';
import { testStore } from '../../test/renderApp.tsx';
import { AppProviders } from '../providers.tsx';
import { notifier, setNotifier } from '../reminders/notifier.ts';
import { AppRoutes } from '../routes.tsx';
import { NotificationOpen } from './NotificationOpen.tsx';
import { setNativeShell } from './shell.ts';

const browser = notifier();
afterEach(() => setNotifier(browser));

/** Android's notifications, faked: the test plays the taps. */
function tapping() {
  let tap: ((url: string, action?: NotificationAction) => void) | null = null;
  const fake: Notifier = {
    permission: () => 'granted',
    request: () => Promise.resolve('granted'),
    show: () => Promise.resolve(),
    onOpen: (handler) => {
      tap = handler;
      return () => undefined;
    },
  };
  setNotifier(fake);
  return (url: string, action?: NotificationAction) => tap!(url, action);
}

async function withTask(title: string) {
  const store = testStore();
  let taskId = '';
  render(
    <AppProviders store={store}>
      <MemoryRouter initialEntries={['/inbox']}>
        <AppRoutes />
        <NotificationOpen />
      </MemoryRouter>
    </AppProviders>,
  );
  await screen.findByRole('heading', { level: 1 }, { timeout: 10_000 });
  act(() =>
    store.getState().apply((ctx, ws) => {
      const made = createTask(ctx, ws, { title, listId: inboxList(ws).id });
      taskId = made.task.id;
      return made.workspace;
    }),
  );
  const task = () => store.getState().workspace!.entities.tasks.find((each) => each.id === taskId)!;
  return { taskId, task };
}

describe('android: a reminder button the app finishes', () => {
  it('completes the task (offline, standalone, or a repeating task)', async () => {
    const tap = tapping();
    const { taskId, task } = await withTask('Water plants');
    act(() => tap(`/today?task=${taskId}`, { action: 'complete', taskId, minutes: 10 }));
    await waitFor(() => expect(task().status).toBe('done'));
  });

  it('snoozes it, with a reminder that syncs like any other', async () => {
    const tap = tapping();
    const { taskId, task } = await withTask('Call mum');
    act(() => tap(`/today?task=${taskId}`, { action: 'snooze', taskId, minutes: 10 }));
    await waitFor(() => expect(task().reminders).toHaveLength(1));
    expect(task().status).toBe('open');
    expect(task().reminders![0]).toHaveProperty('at');
  });
});

/** A shell (api 7) holding presses for the app: the test plays them, and the held event. */
class HoldingShell implements NativeShell {
  presses: HeldPress[] = [];
  private listener: (() => void) | null = null;
  constructor(private readonly api = 7) {}
  info(): Promise<ShellInfo> {
    return Promise.resolve({ api: this.api, server: null, version: '0.1.0' });
  }
  held(): Promise<HeldPress[]> {
    const taken = this.presses;
    this.presses = [];
    return Promise.resolve(taken);
  }
  onHeld(listener: () => void): () => void {
    this.listener = listener;
    return () => {
      this.listener = null;
    };
  }
  /** A press held while the app runs: the shell says so. */
  press(press: HeldPress) {
    this.presses.push(press);
    this.listener?.();
  }
  checkServer(): Promise<ServerCheck> {
    return Promise.reject(new Error('not used'));
  }
  connect(): Promise<void> {
    return Promise.resolve();
  }
  disconnect(): Promise<void> {
    return Promise.resolve();
  }
  backgroundCheck(): Promise<BackgroundCheck> {
    return Promise.reject(new Error('not used'));
  }
  setBackgroundCheck(): Promise<BackgroundCheck> {
    return Promise.reject(new Error('not used'));
  }
  allowBackground(): Promise<BackgroundCheck> {
    return Promise.reject(new Error('not used'));
  }
  notificationSettings(): Promise<void> {
    return Promise.resolve();
  }
  carry(): Promise<void> {
    return Promise.resolve();
  }
  carried(): Promise<string | null> {
    return Promise.resolve(null);
  }
  clearCarried(): Promise<void> {
    return Promise.resolve();
  }
}

describe('android: a reminder button pressed without opening the app (shell api 7)', () => {
  afterEach(() => setNativeShell(null));

  it('completes the task as of the press, when the app next runs or hears of it', async () => {
    const shell = new HoldingShell();
    setNativeShell(shell);
    const { taskId, task } = await withTask('Water plants');
    const at = Date.parse('2026-11-01T15:00:00.000Z');
    act(() => shell.press({ action: 'complete', taskId, minutes: 10, at }));
    await waitFor(() => expect(task().status).toBe('done'));
    expect(task().completedAt).toBe('2026-11-01T15:00:00.000Z');
  });

  it('snoozes when the time is still ahead, and leaves a snooze the phone already rang for', async () => {
    const shell = new HoldingShell();
    setNativeShell(shell);
    const { taskId, task } = await withTask('Call mum');
    act(() => shell.press({ action: 'snooze', taskId, minutes: 10, at: Date.now() - 60 * 60_000 }));
    act(() => shell.press({ action: 'snooze', taskId, minutes: 30, at: Date.now() }));
    await waitFor(() => expect(task().reminders).toHaveLength(1));
    expect(task().status).toBe('open');
  });

  it('takes nothing from an older shell', async () => {
    const shell = new HoldingShell(6);
    setNativeShell(shell);
    shell.presses.push({ action: 'complete', taskId: 'none', minutes: 10, at: Date.now() });
    await withTask('Water plants');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(shell.presses).toHaveLength(1);
  });
});
