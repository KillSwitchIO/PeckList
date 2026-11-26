import { createStore, type StoreApi } from 'zustand/vanilla';
import { eventKey, monthDays, type ShownEvent } from '../../core/calendarEvents.ts';
import type { CalendarResult, CalendarsApi, ShownEventEdit } from '../../ports/calendars.ts';
import type { DeviceCache } from '../sync/syncEngine.ts';

// The shown calendars' events on this device (spec: PL-134): fetched a month at a time, kept in the
// device cache so the views still show the last ones offline, and fetched again when they get old.
// A hide is held back here while its Undo shows, and goes to the server once the Undo goes.

/** A month's events count as fresh this long; older ones are fetched again when looked at. */
export const FRESH_MS = 5 * 60_000;

/** How often the events are fetched again while a view shows them. */
export const REFRESH_MS = 5 * 60_000;

const cacheKey = (month: string) => `calendar-events:${month}`;
/** The calendars' names, for the popover offline. */
const NAMES_KEY = 'calendar-names';

interface Cached {
  events: ShownEvent[];
  at: number;
}

export interface EventsState {
  /** The events known for each month asked for (`YYYY-MM`), fetched or from the cache. */
  months: Readonly<Record<string, readonly ShownEvent[]>>;
  /** Occurrences not to show: hidden while their Undo shows, or hidden until a fetch agrees. */
  held: ReadonlySet<string>;
  /** Each calendar's name by its link id, for the popover's "which calendar". */
  names: Readonly<Record<string, string>>;
}

export interface EventsStore extends StoreApi<EventsState> {
  /** The views show these months: from the cache at once, fetched when not fresh. */
  want(months: readonly string[]): void;
  /** Fetch every month asked for again (focus, the timer, after a change). */
  refresh(): Promise<void>;
  /** Fetch again on a timer and on focus while anything shows events; returns the stop. */
  watch(): () => void;
  /**
   * A ticked occurrence, still showing its tick: sent with the rest if the page goes before
   * `holdHide` (QA, PL-134: leaving within the tick's beat lost it).
   */
  queueHide(event: ShownEvent): void;
  /**
   * Stop showing an occurrence now; the server hears of it on `commitHides`. False when it was
   * sent already, so there is nothing left to undo.
   */
  holdHide(event: ShownEvent): boolean;
  /** Show a held occurrence again (Undo). */
  releaseHide(event: ShownEvent): void;
  /** Send every held hide to the server. */
  commitHides(options?: { keepalive?: boolean }): Promise<void>;
  makeTask(event: ShownEvent): Promise<CalendarResult<{ taskId: string }>>;
  edit(event: ShownEvent, edit: ShownEventEdit): Promise<CalendarResult<ShownEvent>>;
  /** Drop the events of calendars no longer shown (a disconnect, a mode change) and fetch again. */
  forgetLinks(linkIds: ReadonlySet<string>): void;
}

export function createEventsStore(
  api: CalendarsApi,
  cache: DeviceCache,
  now: () => number = Date.now,
): EventsStore {
  const store = createStore<EventsState>()(() => ({
    months: {},
    held: new Set<string>(),
    names: {},
  }));
  let named = false;
  const fetchedAt = new Map<string, number>();
  const loading = new Set<string>();
  const fromCache = new Set<string>();
  /** Hides waiting on their Undo: the occurrence, or null for the whole event. */
  const pending = new Map<string, { id: string; occurrence: string | null }>();
  /** Hides sent, by when: a fetch begun before one went out may still list it. */
  const sent = new Map<string, number>();
  let watchers = 0;
  let timer: ReturnType<typeof setInterval> | null = null;

  /** A repeating event hides that day; a single one hides whole (the server's rule too). */
  const hideOf = (event: ShownEvent) => ({
    id: event.id,
    occurrence: event.recurring ? event.occurrence : null,
  });

  const setMonth = (month: string, events: readonly ShownEvent[]) =>
    store.setState((state) => ({ months: { ...state.months, [month]: events } }));

  const hold = (key: string, on: boolean) =>
    store.setState((state) => {
      const held = new Set(state.held);
      if (on) held.add(key);
      else held.delete(key);
      return { held };
    });

  const fetchMonth = async (month: string, force: boolean) => {
    const at = fetchedAt.get(month);
    if (loading.has(month) || (!force && at !== undefined && now() - at < FRESH_MS)) return;
    loading.add(month);
    const began = now();
    try {
      const { from, to } = monthDays(month);
      const events = await api.events(from, to);
      fetchedAt.set(month, now());
      setMonth(month, events);
      // Hides sent before this fetch began are in its answer (left out): no need to hold them.
      for (const [key, when] of sent) {
        if (when < began) {
          sent.delete(key);
          if (!pending.has(key)) hold(key, false);
        }
      }
      await cache.save(cacheKey(month), { events, at: now() } satisfies Cached);
    } catch {
      // Offline, or the server said no: the last events stay as they were, and the next look
      // or the timer tries again.
    } finally {
      loading.delete(month);
    }
  };

  const loadCached = async (month: string) => {
    if (fromCache.has(month)) return;
    fromCache.add(month);
    try {
      const cached = (await cache.load(cacheKey(month))) as Cached | null;
      // A fetch that answered meanwhile is newer than the cache.
      if (cached && Array.isArray(cached.events) && !fetchedAt.has(month)) {
        setMonth(month, cached.events);
      }
    } catch {
      // A cache that cannot be read is no cache: the fetch fills the month.
    }
  };

  const loadNames = async () => {
    named = true;
    try {
      const names: Record<string, string> = {};
      for (const account of (await api.list()).accounts) {
        for (const link of account.calendars) names[link.id] = link.name;
      }
      store.setState({ names });
      void cache.save(NAMES_KEY, names).catch(() => undefined);
    } catch {
      // Names are a nicety: the last ones known, else the popover does without; the next refresh
      // asks again.
      named = false;
      if (Object.keys(store.getState().names).length > 0) return;
      const cached = await cache.load(NAMES_KEY).catch(() => null);
      if (
        cached &&
        typeof cached === 'object' &&
        Object.keys(store.getState().names).length === 0
      ) {
        store.setState({ names: cached as Record<string, string> });
      }
    }
  };

  const refresh = async () => {
    await Promise.all([
      loadNames(),
      ...Object.keys(store.getState().months).map((month) => fetchMonth(month, true)),
    ]);
  };

  const onVisible = () => {
    if (document.visibilityState === 'visible') void refresh();
  };

  return {
    ...store,

    want(months) {
      if (!named) void loadNames();
      for (const month of months) {
        if (!(month in store.getState().months)) setMonth(month, []);
        void loadCached(month).then(() => fetchMonth(month, false));
      }
    },

    refresh,

    watch() {
      watchers += 1;
      if (watchers === 1) {
        timer = setInterval(() => void refresh(), REFRESH_MS);
        document.addEventListener('visibilitychange', onVisible);
      }
      return () => {
        watchers -= 1;
        if (watchers === 0) {
          if (timer) clearInterval(timer);
          timer = null;
          document.removeEventListener('visibilitychange', onVisible);
        }
      };
    },

    queueHide(event) {
      const key = eventKey(event);
      if (!pending.has(key) && !sent.has(key)) pending.set(key, hideOf(event));
    },

    holdHide(event) {
      const key = eventKey(event);
      hold(key, true);
      if (sent.has(key)) return false;
      pending.set(key, hideOf(event));
      return true;
    },

    releaseHide(event) {
      const key = eventKey(event);
      pending.delete(key);
      if (!sent.has(key)) hold(key, false);
    },

    async commitHides(options) {
      const going = [...pending];
      pending.clear();
      await Promise.all(
        going.map(async ([key, { id, occurrence }]) => {
          try {
            await api.hide(id, occurrence, options);
            sent.set(key, now());
          } catch {
            // It did not reach the server: show it again rather than pretend it is hidden.
            hold(key, false);
          }
        }),
      );
      if (going.length > 0 && !options?.keepalive) void refresh();
    },

    async makeTask(event) {
      const result = await api.makeTask(event.id, event.recurring ? event.occurrence : null);
      if (result.ok) {
        const key = eventKey(event);
        sent.set(key, now());
        hold(key, true);
        void refresh();
      }
      return result;
    },

    async edit(event, change) {
      const result = await api.editEvent(event.id, change);
      if (result.ok) {
        // A single event shows once: put the edited one where it was, then let a fetch place it.
        const months = store.getState().months;
        const next: Record<string, readonly ShownEvent[]> = {};
        for (const [month, events] of Object.entries(months)) {
          next[month] = events.map((each) => (each.id === event.id ? result.value : each));
        }
        store.setState({ months: next });
        void refresh();
      } else if (result.code === 'calendar_event_changed') {
        void refresh();
      }
      return result;
    },

    forgetLinks(linkIds) {
      const months = store.getState().months;
      const next: Record<string, readonly ShownEvent[]> = {};
      for (const [month, events] of Object.entries(months)) {
        next[month] = events.filter((each) => !linkIds.has(each.linkId));
      }
      store.setState({ months: next });
      void refresh();
    },
  };
}
