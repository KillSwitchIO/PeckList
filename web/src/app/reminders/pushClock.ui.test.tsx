// A browser with Web Push on tells the server the clock it reads by its own default (schema 22).
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createBrowserPush } from '../../adapters/browser-push.ts';
import { createMemoryStorage } from '../../adapters/memory-storage.ts';
import { setIntlLocale } from '../../core/intl.ts';
import { updateSettings } from '../../core/settings.ts';
import type { BrowserPush, PushSubscriptionData } from '../../ports/notifier.ts';
import { FakeBackend } from '../../test/fakeTransport.ts';
import { testStore } from '../../test/renderApp.tsx';
import { AppProviders } from '../providers.tsx';
import { createSyncEngine } from '../sync/syncEngine.ts';
import { setBrowserPush } from './notifier.ts';
import { PushClock } from './PushClock.tsx';

const SUBSCRIBED: PushSubscriptionData = {
  endpoint: 'https://push.example/ben',
  keys: { p256dh: 'p', auth: 'a' },
};

function pushWith(current: PushSubscriptionData | null): BrowserPush {
  return {
    supported: () => true,
    current: () => Promise.resolve(current),
    subscribe: () => Promise.resolve(SUBSCRIBED),
    unsubscribe: () => Promise.resolve(null),
  };
}

afterEach(() => {
  setBrowserPush(createBrowserPush());
  setIntlLocale(undefined);
  localStorage.clear();
});

async function mounted(backend: FakeBackend) {
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
  render(
    <AppProviders store={store} sync={sync}>
      <PushClock />
    </AppProviders>,
  );
  await waitFor(() => expect(sync.getState().phase).toBe('ready'));
  return { store, transport };
}

describe('the server hears the clock this browser shows', () => {
  it('says the browser’s own clock, not the picked language’s', async () => {
    setBrowserPush(pushWith(SUBSCRIBED));
    const backend = new FakeBackend();
    backend.addAccount('ben', 'correct horse battery');
    const { store, transport } = await mounted(backend);
    await waitFor(() =>
      expect(transport.pushedClocks).toEqual([{ endpoint: SUBSCRIBED.endpoint, clock24: false }]),
    );

    // German picked: the server reads German's own clock from its table then (Dev 1), so there is
    // nothing new to say, and a push-only browser never goes stale.
    act(() => store.getState().apply((ctx, ws) => updateSettings(ctx, ws, { language: 'de' })));
    await new Promise((done) => setTimeout(done, 50));
    expect(transport.pushedClocks).toHaveLength(1);
  });

  it('not again on every start', async () => {
    setBrowserPush(pushWith(SUBSCRIBED));
    const backend = new FakeBackend();
    backend.addAccount('ben', 'correct horse battery');
    const first = await mounted(backend);
    await waitFor(() => expect(first.transport.pushedClocks).toHaveLength(1));

    // Opened again, the same clock: nothing to say.
    cleanup();
    const again = await mounted(backend);
    await new Promise((done) => setTimeout(done, 50));
    expect(again.transport.pushedClocks).toEqual([]);
  });

  it('again for a new subscription', async () => {
    localStorage.setItem('pecklist.pushClock', 'https://push.example/old|false');
    setBrowserPush(pushWith(SUBSCRIBED));
    const backend = new FakeBackend();
    backend.addAccount('ben', 'correct horse battery');
    const { transport } = await mounted(backend);
    await waitFor(() => expect(transport.pushedClocks).toHaveLength(1));
  });

  it('says nothing without Web Push on here', async () => {
    setBrowserPush(pushWith(null));
    const backend = new FakeBackend();
    backend.addAccount('ben', 'correct horse battery');
    const { transport } = await mounted(backend);
    await new Promise((done) => setTimeout(done, 50));
    expect(transport.pushedClocks).toEqual([]);
  });
});
