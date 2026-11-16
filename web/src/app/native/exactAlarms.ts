import { useEffect, useState } from 'react';
import type { ExactAlarms } from '../../ports/nativeShell.ts';
import { isPlayBuild, PLAY_API, useShellInfo } from './shell.ts';

/**
 * Whether the Android app may set alarms for the exact minute (api 9), asked again whenever the
 * app comes back to the front (from Android's settings page, say). Null in a browser, on an older
 * shell, or while it answers. 0.12.1 asks only in the Google Play build, so the foss app stays as
 * in 0.12.0.
 */
export function useExactAlarms(): { state: ExactAlarms | null; allow: () => void } {
  const { shell, info } = useShellInfo();
  const [state, setState] = useState<ExactAlarms | null>(null);
  const able = Boolean(shell?.exactAlarms && info && info.api >= PLAY_API && isPlayBuild(info));
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
