import { useTheme } from '@mui/material';
import { useEffect, useState } from 'react';
import { setPhoneClock } from '../../core/intl.ts';
import { phoneScreensClock } from '../format.ts';
import { nativeShell } from './shell.ts';

/** The shell api that reads times on the app's clock in its own screens (schema 22). */
export const CLOCK_API = 17;

/**
 * Hands the app's clock to the Android shell (shell api 17), so the phone's own screens (snooze,
 * widgets) read times as the web app shows them. It is the web app's own rule (`clockIs24`, under
 * WorkspaceTheme, which renders this again when the clock, the language or the phone's setting
 * changes), so the two never disagree. On Automatic, the phone's own 12/24-hour setting decides,
 * ahead of the language (Manager, rc.2): the shell's info reports it, and the shell's screens then
 * read it live (null). A clock picked in the app wins. Until a shell has heard, it keeps the phone's
 * own setting. The shell ignores a clock it already has.
 */
export function NativeClock() {
  // Only to render again with WorkspaceTheme's theme, which changes with any of the above.
  useTheme();
  const [api, setApi] = useState(0);

  useEffect(() => {
    const shell = nativeShell();
    if (!shell) return;
    let live = true;
    const ask = () =>
      shell.info().then(
        (info) => {
          if (!live) return;
          if (info.api >= CLOCK_API && typeof info.clock24 === 'boolean') {
            setPhoneClock(info.clock24);
          }
          setApi(info.api);
        },
        () => undefined,
      );
    void ask();
    // Back from Android's settings with the 12/24-hour switch changed, the app reads it again, as
    // snooze and the widgets do (Dev 1, N4).
    const back = () => {
      if (document.visibilityState === 'visible') void ask();
    };
    document.addEventListener('visibilitychange', back);
    return () => {
      live = false;
      document.removeEventListener('visibilitychange', back);
    };
  }, []);

  const handed = phoneScreensClock();
  useEffect(() => {
    const shell = nativeShell();
    if (!shell?.setClock || api < CLOCK_API) return;
    shell.setClock(handed).catch(() => undefined);
  }, [handed, api]);

  return null;
}
