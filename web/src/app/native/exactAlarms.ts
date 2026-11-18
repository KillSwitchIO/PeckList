import { useEffect, useState } from 'react';
import type { ExactAlarms } from '../../ports/nativeShell.ts';
import { PLAY_API, useShellInfo } from './shell.ts';

/**
 * Whether the Android app may set alarms for the exact minute (api 9), asked again whenever the
 * app comes back to the front (from Android's settings page, say). Null in a browser, on an older
 * shell, or while it answers. Any build: what counts is what Android reports, so a foss install
 * that has USE_EXACT_ALARM answers allowed and is never asked.
 */
export function useExactAlarms(): { state: ExactAlarms | null; allow: () => void } {
  const { shell, info } = useShellInfo();
  const [state, setState] = useState<ExactAlarms | null>(null);
  const able = Boolean(shell?.exactAlarms && info && info.api >= PLAY_API);
  useEffect(() => {
    if (!able || !shell?.exactAlarms) return;
    let live = true;
    const load = () =>
      void shell.exactAlarms?.().then(
        (answer) => live && setState(answer),
        () => undefined,
      );
    load();
    const onVisible = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      live = false;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [able, shell]);
  const allow = () =>
    void shell?.allowExactAlarms?.().then(
      (answer) => setState(answer),
      () => undefined,
    );
  return { state: able ? state : null, allow };
}
