import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { ServerNotification } from '../../ports/sync.ts';
import {
  clearReminders,
  readReminders,
  reminderLog,
  REMINDER_LOG_EVENT,
  type LoggedReminder,
} from '../reminders/reminderLog.ts';
import { useSyncState } from '../sync/syncContext.ts';
import { NotificationsContext, type NotificationItem } from './notificationsContext.ts';

// The device's reminder log as an external store: changes in this tab or another re-read it.
let logText = '';
let logValue: LoggedReminder[] = [];
function readLog(): LoggedReminder[] {
  const text = JSON.stringify(reminderLog());
  if (text !== logText) {
    logText = text;
    logValue = JSON.parse(text) as LoggedReminder[];
  }
  return logValue;
}
function subscribe(changed: () => void): () => void {
  window.addEventListener(REMINDER_LOG_EVENT, changed);
  window.addEventListener('storage', changed);
  return () => {
    window.removeEventListener(REMINDER_LOG_EVENT, changed);
    window.removeEventListener('storage', changed);
  };
}

/**
 * My notifications (spec: PL-061): the server's (assignments, shares, mentions), fetched after
 * every sync, and the reminders that fired on this device. Reading or clearing goes to both.
 */
export function NotificationsProvider({ children }: { children: ReactNode }) {
  const api = useSyncState((state) => state.transport.notifications);
  const ready = useSyncState((state) => state.phase === 'ready');
  const synced = useSyncState((state) => state.lastSynced);
  const [fetched, setServer] = useState<ServerNotification[]>([]);
  const local = useSyncExternalStore(subscribe, readLog);
  // Signed out or without a server: nothing from it.
  const server = useMemo(() => (api && ready ? fetched : []), [api, ready, fetched]);

  useEffect(() => {
    if (!api || !ready) return;
    let current = true;
    api.list().then(
      (feed) => {
        if (current) setServer(feed.items);
      },
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [api, ready, synced]);

  const value = useMemo(() => {
    const items: NotificationItem[] = [
      ...server.map((each) => ({
        id: each.id,
        kind: each.kind,
        at: Date.parse(each.at),
        actorId: each.actorId,
        taskId: each.taskId,
        listId: each.listId,
        commentId: each.commentId,
        read: each.read,
        local: false,
      })),
      // A reminder the server sent too (its time within a minute) shows once.
      ...local
        .filter(
          (each) =>
            !server.some(
              (sent) =>
                sent.kind === 'reminder' &&
                sent.taskId === each.taskId &&
                Math.abs(Date.parse(sent.at) - each.at) < 60_000,
            ),
        )
        .map((each) => ({
          id: each.id,
          kind: 'reminder' as const,
          at: each.at,
          actorId: null,
          taskId: each.taskId,
          listId: null,
          commentId: null,
          read: each.read,
          local: true,
        })),
    ].sort((a, b) => b.at - a.at);
    const split = (ids: string[] | null) => ({
      mine: ids === null ? null : ids.filter((id) => local.some((each) => each.id === id)),
      theirs: ids === null ? null : ids.filter((id) => server.some((each) => each.id === id)),
    });
    return {
      items,
      unread: items.filter((each) => !each.read).length,
      read: (ids: string[] | null) => {
        const { mine, theirs } = split(ids);
        if (mine === null || mine.length > 0) readReminders(mine);
        setServer((before) =>
          before.map((each) =>
            theirs === null || theirs.includes(each.id) ? { ...each, read: true } : each,
          ),
        );
        if (api && (theirs === null || theirs.length > 0))
          void api.read(theirs).catch(() => undefined);
      },
      clear: (ids: string[] | null) => {
        const { mine, theirs } = split(ids);
        if (mine === null || mine.length > 0) clearReminders(mine);
        setServer((before) =>
          theirs === null ? [] : before.filter((each) => !theirs.includes(each.id)),
        );
        if (api && (theirs === null || theirs.length > 0))
          void api.clear(theirs).catch(() => undefined);
      },
    };
  }, [server, local, api]);

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}
