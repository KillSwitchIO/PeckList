import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBrowserPush, keyBytes } from './browser-push.ts';

afterEach(() => vi.unstubAllGlobals());

function stubBrowser(permission: NotificationPermission) {
  let current: {
    endpoint: string;
    toJSON: () => unknown;
    unsubscribe: () => Promise<boolean>;
  } | null = null;
  const subscribe = vi.fn((options: { applicationServerKey: Uint8Array }) => {
    current = {
      endpoint: 'https://push.example/abc',
      toJSON: () => ({ keys: { p256dh: 'P', auth: 'A' }, key: options.applicationServerKey }),
      unsubscribe: () => {
        current = null;
        return Promise.resolve(true);
      },
    };
    return Promise.resolve(current);
  });
  const pushManager = { getSubscription: () => Promise.resolve(current), subscribe };
  vi.stubGlobal('navigator', {
    ...navigator,
    serviceWorker: { ready: Promise.resolve({ pushManager }) },
  });
  vi.stubGlobal('PushManager', function PushManager() {});
  vi.stubGlobal(
    'Notification',
    Object.assign(function Notification() {}, {
      permission,
      requestPermission: vi.fn(() => Promise.resolve(permission)),
    }),
  );
  return { subscribe };
}

describe('browser push', () => {
  it('turns a base64url key into its bytes', () => {
    expect([...keyBytes('BAEC_-8')]).toEqual([4, 1, 2, 255, 239]);
  });

  it('subscribes with the server key, then unsubscribes', async () => {
    const { subscribe } = stubBrowser('granted');
    const push = createBrowserPush();
    expect(push.supported()).toBe(true);
    expect(await push.current()).toBeNull();
    const made = await push.subscribe('BAEC');
    expect(made).toEqual({
      endpoint: 'https://push.example/abc',
      keys: { p256dh: 'P', auth: 'A' },
    });
    expect(subscribe).toHaveBeenCalledWith(expect.objectContaining({ userVisibleOnly: true }));
    expect(await push.current()).toEqual(made);
    expect(await push.unsubscribe()).toBe('https://push.example/abc');
    expect(await push.unsubscribe()).toBeNull();
  });

  it('refuses without permission', async () => {
    stubBrowser('denied');
    await expect(createBrowserPush().subscribe('BAEC')).rejects.toThrow(/not allowed/);
  });
});
