import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router';
import { visibleLists } from '../../core/lists.ts';
import type { List } from '../../core/types.ts';
import type { ShortcutList } from '../../ports/nativeShell.ts';
import { useStoreState } from '../store/hooks.ts';
import { useSyncState } from '../sync/syncContext.ts';
import { nativeShell } from './shell.ts';

/** The shell api with list shortcuts in the launcher's long-press menu. */
export const SHORTCUTS_API = 11;

/** This device's list opened last (a per-device convenience, so local storage). */
const LAST_LIST = 'pecklist.shortcutList';

function lastList(): string | null {
  try {
    return localStorage.getItem(LAST_LIST);
  } catch {
    return null;
  }
}

function remember(id: string | null): void {
  try {
    if (id) localStorage.setItem(LAST_LIST, id);
    else localStorage.removeItem(LAST_LIST);
  } catch {
    // No storage (a private window): the shortcut just follows this run.
  }
}

/** The list the long-press menu offers: the one opened last, while it is still there. */
export function shortcutLists(lists: List[], last: string | null): ShortcutList[] {
  const list = last ? lists.find((each) => each.id === last) : undefined;
  return list ? [{ id: list.id, name: list.name }] : [];
}

/**
 * Keeps the Android launcher's list shortcut on the list opened last (shell api 11), renamed with
 * it, and gone once it is deleted or archived or the person signs out.
 */
export function ListShortcuts() {
  const { pathname } = useLocation();
  const workspace = useStoreState((state) => state.workspace);
  const phase = useSyncState((state) => state.phase);
  const [api, setApi] = useState(0);
  const sent = useRef<string | null>(null);

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
    if (!shell?.setShortcuts || api < SHORTCUTS_API) return;
    const signedOut = phase === 'signed-out';
    if (signedOut) remember(null);
    else {
      if (!workspace) return;
      // Only an id the shell takes (Shortcuts.java); nothing to decode, so a stray escape in a
      // pasted address cannot throw here.
      const opened = /^\/lists\/([A-Za-z0-9_-]{1,64})$/.exec(pathname)?.[1];
      if (opened) remember(opened);
    }
    const lists = signedOut || !workspace ? [] : shortcutLists(visibleLists(workspace), lastList());
    const text = JSON.stringify(lists);
    if (text === sent.current) return;
    sent.current = text;
    shell.setShortcuts(lists).catch(() => undefined);
  }, [pathname, workspace, phase, api]);

  return null;
}
