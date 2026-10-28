import { createContext, useContext } from 'react';

/** One notification as the app shows it: from the server, or a reminder fired on this device. */
export interface NotificationItem {
  id: string;
  kind:
    | 'assigned'
    | 'groupAssigned'
    | 'claimed'
    | 'shared'
    | 'mentioned'
    | 'commented'
    | 'commentEdited'
    | 'reminder';
  /** When (ms) */
  at: number;
  actorId: string | null;
  taskId: string | null;
  listId: string | null;
  /** The comment it is about (comments and mentions) */
  commentId: string | null;
  read: boolean;
  /** Kept in this browser only (a reminder fired here). */
  local: boolean;
}

export interface Notifications {
  items: NotificationItem[];
  unread: number;
  /** Mark some (null: all) read. */
  read: (ids: string[] | null) => void;
  /** Clear some (null: all). */
  clear: (ids: string[] | null) => void;
}

const NONE: Notifications = { items: [], unread: 0, read: () => undefined, clear: () => undefined };

export const NotificationsContext = createContext<Notifications>(NONE);

export const useNotifications = () => useContext(NotificationsContext);
