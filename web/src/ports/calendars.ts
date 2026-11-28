// The person's calendars on the server (spec: PL-134 Calendar Integration): the accounts they
// connected, how each calendar is used, and the events of the calendars they show. The server does
// the syncing; the app only shows and changes what these routes answer.

import type { ShownEvent } from '../core/calendarEvents.ts';

export type { ShownEvent };

/** How a calendar is used: not at all, its events beside the tasks, or synced with a tag. */
export type CalendarMode = 'off' | 'show' | 'sync';

/** One calendar of a connected account. Times are ISO instants. */
export interface CalendarLinkInfo {
  id: string;
  name: string;
  /** The calendar's own colour (`#rrggbb`), or null when it has none. */
  color: string | null;
  /** Subscribed and holiday calendars: Off and Show events only. */
  readOnly: boolean;
  mode: CalendarMode;
  tagId: string | null;
  listId: string | null;
  madeByPeckList: boolean;
  syncedAt: string | null;
  /** What went wrong last, as a fixed code (`calendar_auth_failed`), or null. */
  problem: string | null;
  /** When the server tries again after a problem, or null. */
  nextAttempt: string | null;
  /**
   * A run someone asked for (a mode just chosen, Sync now) is queued or going on the server. The
   * route answers at once; the app shows "Syncing..." and reads the list again until it ends.
   */
  syncing: boolean;
}

/** A connected calendar account as Settings shows it. Never its password or token. */
export interface CalendarAccountInfo {
  id: string;
  /** `caldav` or `google`. */
  provider: string;
  name: string;
  serverUrl: string;
  username: string | null;
  /** `ok`, `auth_failed` (the person must reconnect) or `error`. */
  status: string;
  problem: string | null;
  canCreateCalendar: boolean;
  calendars: CalendarLinkInfo[];
}

/** A change to a shown event. Start and end are both days or both times. */
export interface ShownEventEdit {
  title?: string;
  notes?: string;
  start?: string;
  end?: string;
  timeZone?: string;
}

/**
 * What a change answered: done, or refused with the server's fixed code, which the app words
 * itself (`too_many` for a 429, with the seconds to wait when the server said).
 */
export type CalendarResult<T> =
  { ok: true; value: T } | { ok: false; code: string; retryAfter?: number };

/** The person's calendar accounts, and the kinds this server can connect right now. */
export interface CalendarAccounts {
  accounts: CalendarAccountInfo[];
  /** `caldav` always; `google` only when a Google client is usable here. */
  providers: string[];
}

/**
 * Where the whole page goes to connect a Google account (PL-134 piece 2). The same address on the
 * web and in the Android app, which opens it in a browser tab itself (Google refuses WebViews).
 */
export const GOOGLE_CONNECT_PATH = '/auth/oidc/calendar-google/link';

/** The person's calendars (servers with `CALENDAR_SYNC` on). Every call answers or throws a `SyncFailure`. */
export interface CalendarsApi {
  list(): Promise<CalendarAccounts>;
  /** Connect a CalDAV account; the server checks it before keeping anything. */
  connectCalDav(input: {
    serverUrl: string;
    username: string;
    password: string;
  }): Promise<CalendarResult<CalendarAccountInfo>>;
  /** Disconnect an account; tasks and the calendar's events both stay. */
  disconnect(accountId: string): Promise<void>;
  setMode(
    linkId: string,
    input: { mode: CalendarMode; tagId?: string; listId?: string },
  ): Promise<CalendarResult<CalendarLinkInfo>>;
  /** "Make a PeckList calendar" in an account, synced with a tag. */
  createCalendar(
    accountId: string,
    input: { name: string; tagId: string; listId?: string },
  ): Promise<CalendarResult<CalendarLinkInfo>>;
  syncNow(linkId: string): Promise<CalendarResult<CalendarLinkInfo>>;
  /**
   * How many of the calendar's events would become tasks if it synced with a tag now: its own events
   * from today on (spec: PL-134 decision 8). The server lists the calendar and writes nothing.
   */
  importPreview(linkId: string): Promise<CalendarResult<number>>;
  /** Shown calendars' events from one day to another, both included (at most 62 days). */
  events(from: string, to: string): Promise<ShownEvent[]>;
  editEvent(id: string, edit: ShownEventEdit): Promise<CalendarResult<ShownEvent>>;
  /**
   * Hide one occurrence, or the whole event with null. The calendar is not changed. `keepalive`:
   * sent as the page goes away, so it must still arrive.
   */
  hide(id: string, occurrence: string | null, options?: { keepalive?: boolean }): Promise<void>;
  /** A task in the Inbox from the event (that day's, for a repeating one); the event is hidden. */
  makeTask(id: string, occurrence: string | null): Promise<CalendarResult<{ taskId: string }>>;
}
