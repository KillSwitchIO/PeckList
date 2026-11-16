import { useEffect, useState } from 'react';
import { createCapacitorShell } from '../../adapters/capacitor-shell.ts';
import type { NativeShell, ShellInfo } from '../../ports/nativeShell.ts';

let current: NativeShell | null | undefined;

/** The shell api that hands this phone's own tasks to a server on connecting (PL-070). */
export const CARRY_API = 6;

/** The shell api that holds a reminder's Complete and Snooze for the app instead of opening it. */
export const HELD_API = 7;

/**
 * The shell api that asks in its own dialog before a server's page connects it elsewhere or
 * disconnects it (audit A4), so the page need not ask as well.
 */
export const CONFIRM_API = 8;

/**
 * The shell api that says which build it is (`distribution`: the Google Play one or foss), answers
 * whether exact alarms are allowed, and takes a fresh sign-in (`fresh=1`) through to its browser tab.
 */
export const PLAY_API = 9;

/** Whether this is the Google Play build of the app. Browsers, the PWA and older shells: no. */
export function isPlayBuild(info: ShellInfo | null): boolean {
  return info?.distribution === 'play';
}

/** The host (and port) an address names, read as the shell reads it: https when none is typed. */
export function hostOf(address: string): string | null {
  const text = address.trim();
  try {
    return new URL(text.includes('://') ? text : `https://${text}`).host.toLowerCase();
  } catch {
    return null;
  }
}

/** The Android shell around the app, or null in a browser (tests swap in a fake). */
export function nativeShell(): NativeShell | null {
  if (current === undefined) current = createCapacitorShell();
  return current;
}

/** What the shell last said about itself, so a later screen starts with it rather than blank. */
let known: { shell: NativeShell; info: ShellInfo } | null = null;

export function setNativeShell(next: NativeShell | null): void {
  current = next;
  known = null;
}

/** The shell and what it says about itself; info is null while it answers (or in a browser). */
export function useShellInfo(): { shell: NativeShell | null; info: ShellInfo | null } {
  const shell = nativeShell();
  const [info, setInfo] = useState<ShellInfo | null>(() =>
    known && known.shell === shell ? known.info : null,
  );
  useEffect(() => {
    let live = true;
    shell?.info().then(
      (answer) => {
        known = { shell, info: answer };
        if (live) setInfo(answer);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [shell]);
  return { shell, info };
}

/**
 * Whether this is the Google Play build (api 9), which leaves out what Play does not allow: links
 * to pay or donate, and the app's own update notice. False until the shell answers, and always in
 * a browser.
 */
export function usePlayBuild(): boolean {
  return isPlayBuild(useShellInfo().info);
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

const STANDALONE_KEY = 'pecklist.native.standalone';

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
