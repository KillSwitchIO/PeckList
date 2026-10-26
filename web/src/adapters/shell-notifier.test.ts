import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Notifier } from '../ports/notifier.ts';

const shell = vi.hoisted(() => ({
  api: 3,
  display: 'granted' as string,
  scheduled: [] as unknown[][],
  listener: null as null | ((event: unknown) => void),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true, isPluginAvailable: () => true },
  registerPlugin: () => ({
    info: () => Promise.resolve({ api: shell.api }),
    notificationPermission: () => Promise.resolve({ display: shell.display }),
    requestNotificationPermission: () => Promise.resolve({ display: 'granted' }),
    scheduleReminders: ({ reminders }: { reminders: unknown[] }) => {
      shell.scheduled.push(reminders);
      return Promise.resolve();
    },
    showNotification: () => Promise.resolve(),
    addListener: (_: string, listener: (event: unknown) => void) => {
      shell.listener = listener;
      return Promise.resolve({ remove: () => Promise.resolve() });
    },
  }),
}));

const { createShellNotifier, openedOf } = await import('./shell-notifier.ts');

const reminder = {
  title: 'Take the pills',
  body: 'Reminder for 9:00 AM',
  tag: 'T1@1793037600000#2',
  url: '/today?task=T1',
  at: 1793038200000,
  sticky: true,
  repeats: false,
};

function olderShell() {
  const handed: unknown[] = [];
  const older: Notifier = {
    permission: () => 'granted',
    request: () => Promise.resolve('granted'),
    show: () => Promise.resolve(),
    scheduleAhead: (notifications) => {
      handed.push(notifications);
      return Promise.resolve();
    },
  };
  return { older, handed };
}

beforeEach(() => {
  shell.api = 3;
  shell.display = 'granted';
  shell.scheduled = [];
  shell.listener = null;
});

describe('the Android app with its own reminders', () => {
  it('hands them to the shell with their key, and whether they come again or repeat', async () => {
    const { older, handed } = olderShell();
    const notifier = createShellNotifier(() => older)!;
    await notifier.scheduleAhead?.([reminder]);
    expect(shell.scheduled).toEqual([
      [
        {
          key: 'T1@1793037600000#2',
          title: 'Take the pills',
          body: 'Reminder for 9:00 AM',
          at: 1793038200000,
          url: '/today?task=T1',
          constant: true,
          repeats: false,
        },
      ],
    ]);
    expect(handed).toEqual([]);
  });

  it('leaves them to Local Notifications in an older app', async () => {
    shell.api = 2;
    const { older, handed } = olderShell();
    const notifier = createShellNotifier(() => older)!;
    await notifier.scheduleAhead?.([reminder]);
    expect(handed).toEqual([[reminder]]);
    expect(shell.scheduled).toEqual([]);
  });

  it('passes a tap on and a button the app must finish, and nothing it cannot use', async () => {
    const notifier = createShellNotifier(() => null)!;
    const opened: unknown[] = [];
    notifier.onOpen?.((url, action) => opened.push([url, action]));
    await vi.waitFor(() => expect(shell.listener).not.toBeNull());
    shell.listener!({ url: '/today?task=T1' });
    shell.listener!({ url: '/today?task=T1', action: 'snooze', taskId: 'T1', minutes: 10 });
    shell.listener!({ url: 'https://elsewhere.example/' });
    expect(opened).toEqual([
      ['/today?task=T1', undefined],
      ['/today?task=T1', { action: 'snooze', taskId: 'T1', minutes: 10 }],
    ]);
    expect(openedOf({ url: '/x', action: 'delete', taskId: 'T1' })).toEqual({ url: '/x' });
  });
});
