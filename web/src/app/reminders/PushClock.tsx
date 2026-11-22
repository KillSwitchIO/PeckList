import { useEffect } from 'react';
import { browserUses24h } from '../../core/intl.ts';
import { nativeShell } from '../native/shell.ts';
import { useSyncState } from '../sync/syncContext.ts';
import { browserPush } from './notifier.ts';
import { withClock } from './withClock.ts';

/** Where this browser notes the clock it last told the server, with the endpoint it told it for. */
const TOLD = 'pecklist.pushClock';

function told(): string | null {
  try {
    return localStorage.getItem(TOLD);
  } catch {
    return null;
  }
}

function tell(value: string): void {
  try {
    localStorage.setItem(TOLD, value);
  } catch {
    // Private mode: it tells the server again next time, which does no harm.
  }
}

/**
 * Keeps the server's copy of this browser's clock current (schema 22): a browser with Web Push on
 * says the clock it reads by its own default when that, or its subscription, is not what it last
 * told the server (an older version saved none). The Android app has no Web Push: its check-in says
 * the phone's clock instead.
 */
export function PushClock() {
  const api = useSyncState((state) => state.transport.push);
  const ready = useSyncState((state) => state.phase === 'ready');

  useEffect(() => {
    if (!api || !ready || nativeShell()) return;
    const push = browserPush();
    if (!push.supported()) return;
    let live = true;
    push.current().then(
      (subscription) => {
        if (!live || !subscription) return;
        const value = `${subscription.endpoint}|${browserUses24h()}`;
        if (told() === value) return;
        api.subscribe(withClock(subscription)).then(
          () => tell(value),
          () => undefined,
        );
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [api, ready]);

  return null;
}
