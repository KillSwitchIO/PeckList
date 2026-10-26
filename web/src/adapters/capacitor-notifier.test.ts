import { beforeEach, describe, expect, it, vi } from 'vitest';

const plugin = vi.hoisted(() => ({
  display: 'granted' as string,
  pending: [] as { id: number }[],
  scheduled: [] as { id: number; schedule?: { at: Date }; extra: { url: string } }[][],
  cancelled: [] as { id: number }[][],
  listener: null as null | ((action: unknown) => void),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true, isPluginAvailable: () => true },
}));
vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: {
    checkPermissions: () => Promise.resolve({ display: plugin.display }),
    requestPermissions: () => Promise.resolve({ display: 'granted' }),
    createChannel: () => Promise.resolve(),
    getPending: () => Promise.resolve({ notifications: plugin.pending }),
    cancel: ({ notifications }: { notifications: { id: number }[] }) => {
      plugin.cancelled.push(notifications);
      return Promise.resolve();
    },
    schedule: ({ notifications }: { notifications: (typeof plugin.scheduled)[number] }) => {
      plugin.scheduled.push(notifications);
      return Promise.resolve({ notifications: [] });
    },
    addListener: (_: string, listener: (action: unknown) => void) => {
      plugin.listener = listener;
      return Promise.resolve({ remove: () => Promise.resolve() });
    },
  },
}));

const { createCapacitorNotifier, idOf } = await import('./capacitor-notifier.ts');

const reminder = (tag: string, at: number) => ({
  title: 'Call mum',
  body: 'At 14:00',
  tag,
  url: '/today?task=t1',
  at,
});

beforeEach(() => {
  plugin.display = 'granted';
  plugin.pending = [];
  plugin.scheduled = [];
  plugin.cancelled = [];
});

describe('the Android notifier', () => {
  it('hands reminders to the system, dropping ones no longer wanted', async () => {
    const notifier = createCapacitorNotifier('Reminders')!;
    plugin.pending = [{ id: idOf('kept') }, { id: idOf('gone') }];
    await notifier.scheduleAhead!([reminder('kept', 1_000), reminder('new', 2_000)]);
    expect(plugin.cancelled).toEqual([[{ id: idOf('gone') }]]);
    const handed = plugin.scheduled[0]!;
    expect(handed.map((each) => each.id)).toEqual([idOf('kept'), idOf('new')]);
    expect(handed[1]!.schedule!.at.getTime()).toBe(2_000);
    expect(handed[1]!.extra.url).toBe('/today?task=t1');
  });

  it('schedules nothing without permission, and asks only when it has not been answered', async () => {
    plugin.display = 'denied';
    const notifier = createCapacitorNotifier('Reminders')!;
    await notifier.scheduleAhead!([reminder('a', 1_000)]);
    expect(plugin.scheduled).toEqual([]);
    expect(await notifier.request()).toBe('denied');
    plugin.display = 'prompt';
    expect(await notifier.request()).toBe('granted');
    // Granted later: what it was handed before is scheduled then.
    expect(plugin.scheduled[0]!.map((each) => each.id)).toEqual([idOf('a')]);
  });

  it('opens what a tapped notification is about, inside the app only', () => {
    const notifier = createCapacitorNotifier('Reminders')!;
    const opened: string[] = [];
    notifier.onOpen!((url) => opened.push(url));
    plugin.listener!({ notification: { extra: { url: '/today?task=t1' } } });
    plugin.listener!({ notification: { extra: { url: 'https://evil.example/' } } });
    plugin.listener!({ notification: {} });
    expect(opened).toEqual(['/today?task=t1']);
  });

  it('gives every key a stable positive id', () => {
    expect(idOf('r:abc')).toBe(idOf('r:abc'));
    expect(idOf('r:abc')).not.toBe(idOf('r:abd'));
    for (const key of ['', 'x', 'r:01JABCDEFG:0']) expect(idOf(key)).toBeGreaterThan(0);
  });

  it('makes the same ids as the background check-in (NativeReminders.idOf, pinned there too)', () => {
    expect(idOf('T1@1793037600000')).toBe(153274604);
    expect(idOf('01JBXYZ@1700000000000')).toBe(779024919);
    expect(idOf('news:01K8ABCDEF')).toBe(798184953);
  });
});
