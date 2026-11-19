import { useEffect } from 'react';
import { localTimeZone, todayIn } from '../../core/dates.ts';
import { useSyncState } from '../sync/syncContext.ts';
import { SHORTCUTS_API, forgetShortcutList } from './listShortcuts.ts';
import { nativeShell } from './shell.ts';
import { WIDGETS_API } from './widgetFeed.ts';

/**
 * Signed out: the launcher's list shortcut and the home-screen widgets show nothing of the
 * account any more. ListShortcuts and WidgetFeed cannot do it, as the sign-in page replaces the
 * app (and them) at that moment, so this sits beside the sign-in gate (SyncProvider).
 */
export function PhoneSignedOut() {
  const phase = useSyncState((state) => state.phase);
  useEffect(() => {
    if (phase === 'signed-out') void forgetOnPhone();
  }, [phase]);
  return null;
}

async function forgetOnPhone(): Promise<void> {
  const shell = nativeShell();
  if (!shell) return;
  const api = await shell.info().then(
    (info) => info.api,
    () => 0,
  );
  if (api >= SHORTCUTS_API && shell.setShortcuts) {
    forgetShortcutList();
    await shell.setShortcuts([]).catch(() => undefined);
  }
  if (api >= WIDGETS_API && shell.setWidgetTasks) {
    const asOf = todayIn(localTimeZone(), Date.now());
    await shell.setWidgetTasks({ asOf, tasks: [], signedOut: true }).catch(() => undefined);
  }
}
