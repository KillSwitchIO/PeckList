import { useEffect, useState } from 'react';
import { useStoreState } from '../store/hooks.ts';
import { nativeShell } from './shell.ts';

/** The shell api that takes the language picked in Settings for its own text (PL-148). */
export const LANGUAGE_API = 15;

/**
 * Hands the language picked in Settings (settings.language, synced) to the Android shell, so the
 * phone's own text speaks it too: notification actions and channel names, the widgets, the shell's
 * dialogs (shell api 15). Automatic (null) leaves them in the phone's languages. The tag goes as
 * picked: Android falls back from de-AT to German, and to English for a language it has no strings
 * for, as the web app does. The shell ignores a choice it already has.
 */
export function NativeLanguage() {
  const loaded = useStoreState((state) => state.workspace !== null);
  const choice = useStoreState((state) => state.workspace?.entities.settings[0]?.language ?? null);
  const [api, setApi] = useState(0);

  useEffect(() => {
    const shell = nativeShell();
    if (!shell) return;
    let live = true;
    shell.info().then(
      (info) => live && setApi(info.api),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    const shell = nativeShell();
    // Not before the tasks load: the choice is not known yet, and automatic would undo it.
    if (!loaded || !shell?.setLanguage || api < LANGUAGE_API) return;
    shell.setLanguage(choice).catch(() => undefined);
  }, [loaded, choice, api]);

  return null;
}
