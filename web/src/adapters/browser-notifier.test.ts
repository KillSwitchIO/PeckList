import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBrowserNotifier } from './browser-notifier.ts';

const note = { title: 'Dentist', body: 'Reminder for 10:00', tag: 't1@1', url: '/today?task=t1' };

function stubNotification(permission: NotificationPermission) {
  const made: { title: string; options: NotificationOptions }[] = [];
  const Fake = vi.fn(function (
    this: { onclick: unknown },
    title: string,
    options: NotificationOptions,
  ) {
    made.push({ title, options });
    this.onclick = null;
  }) as unknown as typeof Notification & { permission: NotificationPermission };
  Object.assign(Fake, {
    permission,
    requestPermission: vi.fn(() => Promise.resolve('granted' as NotificationPermission)),
  });
  vi.stubGlobal('Notification', Fake);
  return { made, Fake };
}

afterEach(() => vi.unstubAllGlobals());

describe('browser notifier', () => {
  it('says unsupported where the browser has no notifications', async () => {
    vi.stubGlobal('Notification', undefined);
    Reflect.deleteProperty(window, 'Notification');
    const notifier = createBrowserNotifier();
    expect(notifier.permission()).toBe('unsupported');
    expect(await notifier.request()).toBe('unsupported');
  });

  it('asks only while undecided', async () => {
    const { Fake } = stubNotification('default');
    const notifier = createBrowserNotifier();
    expect(await notifier.request()).toBe('granted');
    expect(Fake.requestPermission).toHaveBeenCalledTimes(1);
    Fake.permission = 'denied';
    expect(await notifier.request()).toBe('denied');
    expect(Fake.requestPermission).toHaveBeenCalledTimes(1);
  });

  it('shows through the service worker when there is one, else from the page', async () => {
    const { made } = stubNotification('granted');
    const showNotification = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', {
      ...navigator,
      serviceWorker: { getRegistration: () => Promise.resolve({ showNotification }) },
    });
    await createBrowserNotifier().show(note);
    expect(showNotification).toHaveBeenCalledWith(
      'Dentist',
      expect.objectContaining({ body: note.body, tag: note.tag, data: { url: note.url } }),
    );
    expect(made).toHaveLength(0);

    vi.stubGlobal('navigator', {
      ...navigator,
      serviceWorker: { getRegistration: () => Promise.resolve(undefined) },
    });
    await createBrowserNotifier().show(note);
    expect(made.map((each) => each.title)).toEqual(['Dentist']);
  });

  it('shows nothing without permission', async () => {
    const { made } = stubNotification('denied');
    await createBrowserNotifier().show(note);
    expect(made).toHaveLength(0);
  });
});
