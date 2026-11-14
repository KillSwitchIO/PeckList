import { useCallback, useEffect, useState } from 'react';
import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { AccountApi, SupporterStatus } from '../../ports/sync.ts';
import { useSyncState } from '../sync/syncContext.ts';

interface SupporterState {
  /** Null until the server answered, or when it can't say (no server, an older one, a failure). */
  status: SupporterStatus | null;
}

// One per account API, so the sidebar and the Support page agree the moment a key goes in.
const stores = new WeakMap<AccountApi, StoreApi<SupporterState>>();
const NONE = createStore<SupporterState>()(() => ({ status: null }));

function storeFor(api: AccountApi | undefined): StoreApi<SupporterState> {
  if (!api?.supporter) return NONE;
  let store = stores.get(api);
  if (!store) {
    const made = createStore<SupporterState>()(() => ({ status: null }));
    stores.set(api, made);
    api.supporter().then(
      (status) => made.setState({ status }),
      // Saying nothing is the safe answer: no thank-you, and no reminder either.
      () => undefined,
    );
    store = made;
  }
  return store;
}

/**
 * Supporter keys on this server (PL-112): yours and the server's, and the account API to change
 * yours. `api` is undefined where there is no server to hold a key (a build without one).
 */
export function useSupporter(): {
  api: AccountApi | undefined;
  status: SupporterStatus | null;
  supporter: boolean;
  update: (status: SupporterStatus) => void;
} {
  const transport = useSyncState((state) => state.transport);
  const ready = useSyncState((state) => state.phase === 'ready');
  const api = ready && transport.account?.supporter ? transport.account : undefined;
  const store = storeFor(api);
  const status = useStore(store, (state) => state.status);
  const update = useCallback((next: SupporterStatus) => store.setState({ status: next }), [store]);
  return { api, status, supporter: Boolean(status?.mine ?? status?.server), update };
}

const HIDDEN_KEY = 'pecklist.supporterReminder';
const HIDE_DAYS = 30;

/** When the sidebar reminder may show again: never (`forever`), a time, or now. A per-browser convenience. */
function hiddenUntil(): number {
  try {
    const raw = localStorage.getItem(HIDDEN_KEY);
    if (raw === 'forever') return Infinity;
    return raw ? Date.parse(raw) || 0 : 0;
  } catch {
    return 0;
  }
}

/** Whether the sidebar reminder is hidden in this browser, and how to hide it: for 30 days, or for good. */
export function useReminderHidden(): { hidden: boolean; hide: (forGood: boolean) => void } {
  const [until, setUntil] = useState(hiddenUntil);
  const [now] = useState(() => Date.now());
  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key === HIDDEN_KEY) setUntil(hiddenUntil());
    };
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, []);
  const hide = useCallback((forGood: boolean) => {
    const value = forGood ? 'forever' : new Date(Date.now() + HIDE_DAYS * 86_400_000).toISOString();
    try {
      localStorage.setItem(HIDDEN_KEY, value);
    } catch {
      // Storage unavailable: hidden until the page loads again.
    }
    setUntil(forGood ? Infinity : Date.now() + HIDE_DAYS * 86_400_000);
  }, []);
  return { hidden: until > now, hide };
}
