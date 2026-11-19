import { useEffect, useRef, useState } from 'react';
import { withPhoneChannels } from '../../core/notificationSwitches.ts';
import { updateSettings } from '../../core/settings.ts';
import type { NativeShell, PhoneChannels } from '../../ports/nativeShell.ts';
import { useApply, useStoreState } from '../store/hooks.ts';
import { nativeShell } from './shell.ts';

/** The shell api that makes every notification channel at start and reads them back (PL-115). */
export const CHANNELS_API = 10;

type Apply = ReturnType<typeof useApply>;

/**
 * Reads the phone's notification channels and carries the kinds switched there since the last read
 * into the synced switches (settings.notifications), so a kind muted on the phone is muted on every
 * device. Answers with the channels; null when the shell cannot say.
 */
export async function syncPhoneChannels(
  shell: NativeShell,
  apply: Apply,
): Promise<PhoneChannels | null> {
  if (!shell.notificationChannels) return null;
  // The read takes the changes: the shell counts them seen once it answers, so they are applied
  // here at once, in the same turn.
  const answer = await shell.notificationChannels();
  if (Object.keys(answer.changed).length > 0)
    apply((ctx, ws) => {
      const next = withPhoneChannels(ws.entities.settings[0]?.notifications, answer.changed);
      return next ? updateSettings(ctx, ws, { notifications: next }) : ws;
    });
  return answer;
}

/**
 * The phone's channels, read once the tasks are loaded and again whenever the app comes back to the
 * screen (from Android's settings, say), carrying what was switched there into the synced switches.
 * Null in a browser, on a shell before api 10, until the first read, and on Android 7, which has
 * no channels (the in-app switches then work on their own, as before).
 */
export function usePhoneChannels(): PhoneChannels | null {
  const ready = useStoreState((state) => state.workspace !== null);
  const apply = useApply();
  const act = useRef(apply);
  useEffect(() => {
    act.current = apply;
  });
  const [channels, setChannels] = useState<PhoneChannels | null>(null);
  useEffect(() => {
    const shell = nativeShell();
    if (!ready || !shell?.notificationChannels) return;
    let live = true;
    const read = () =>
      void syncPhoneChannels(shell, act.current).then(
        (answer) =>
          live && setChannels(answer && Object.keys(answer.channels).length > 0 ? answer : null),
        () => undefined,
      );
    const visible = () => {
      if (document.visibilityState === 'visible') read();
    };
    void shell.info().then(
      ({ api }) => {
        if (!live || api < CHANNELS_API) return;
        read();
        document.addEventListener('visibilitychange', visible);
      },
      () => undefined,
    );
    return () => {
      live = false;
      document.removeEventListener('visibilitychange', visible);
    };
  }, [ready]);
  return channels;
}

/** Keeps the synced switches following the phone's channels while the app runs (mounted once, in App). */
export function PhoneChannelSync() {
  usePhoneChannels();
  return null;
}
