import { useEffect, useRef, useState } from 'react';
import { useSyncState } from '../sync/syncContext.ts';
import { nativeShell } from './shell.ts';

/** The shell api that writes a sign-in to disk when asked. */
export const SAVE_SIGN_IN_API = 14;

/**
 * Has the Android shell write the WebView's cookies to disk as soon as an account is signed in
 * (shell api 14). Android saves them on its own schedule, so a sign-in only seconds old was lost
 * when the app was stopped before then, and the next start asked for it again (QA). Saving when
 * the app leaves the screen caught only some of those.
 */
export function SaveSignIn() {
  const account = useSyncState((state) => state.account?.id ?? null);
  const [api, setApi] = useState(0);
  const saved = useRef<string | null>(null);

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
    if (!shell?.saveSignIn || api < SAVE_SIGN_IN_API) return;
    // Once per account signed in; signing out lets the next sign-in save again.
    if (account === saved.current) return;
    saved.current = account;
    if (account) shell.saveSignIn().catch(() => undefined);
  }, [account, api]);

  return null;
}
