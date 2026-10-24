import { useEffect, useState } from 'react';
import { createCapacitorShell } from '../../adapters/capacitor-shell.ts';
import type { NativeShell, ShellInfo } from '../../ports/nativeShell.ts';

let current: NativeShell | null | undefined;

/** The Android shell around the app, or null in a browser (tests swap in a fake). */
export function nativeShell(): NativeShell | null {
  if (current === undefined) current = createCapacitorShell();
  return current;
}

export function setNativeShell(next: NativeShell | null): void {
  current = next;
}

/** The shell and what it says about itself; info is null while it answers (or in a browser). */
export function useShellInfo(): { shell: NativeShell | null; info: ShellInfo | null } {
  const shell = nativeShell();
  const [info, setInfo] = useState<ShellInfo | null>(null);
  useEffect(() => {
    let live = true;
    shell?.info().then(
      (answer) => live && setInfo(answer),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [shell]);
  return { shell, info };
}

/**
 * Whether this is the Android app's bundled web build (standalone), not a server's. Its service
 * worker would only get in the way: the build updates with the app, and a cached copy would keep
 * serving the old one after an update.
 */
export function isBundledApp(): boolean {
  return nativeShell() !== null && window.location.origin === 'https://localhost';
}

/** Drop a service worker the bundled build registered before it knew better. */
export function forgetServiceWorker(): void {
  void navigator.serviceWorker
    ?.getRegistrations()
    .then((registrations) => registrations.forEach((each) => void each.unregister()));
}

const STANDALONE_KEY = 'punchlist.native.standalone';

/** Whether the person chose to use the app without a server, so the connect page stays away. */
export function choseStandalone(): boolean {
  try {
    return localStorage.getItem(STANDALONE_KEY) === '1';
  } catch {
    return false;
  }
}

export function rememberStandalone(): void {
  try {
    localStorage.setItem(STANDALONE_KEY, '1');
  } catch {
    // Storage refused: the connect page shows again next start, which is harmless.
  }
}
