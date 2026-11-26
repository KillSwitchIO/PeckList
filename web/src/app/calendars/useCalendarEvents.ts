import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { useStore } from 'zustand';
import {
  eventsBetween,
  monthsCovering,
  placeEvents,
  type PlacedEvent,
  type ShownEvent,
} from '../../core/calendarEvents.ts';
import { localTimeZone } from '../../core/dates.ts';
import type { CalendarsApi } from '../../ports/calendars.ts';
import { t } from '../i18n/i18n.ts';
import { useStoreState } from '../store/hooks.ts';
import { useViewAs } from '../store/viewAs.ts';
import { useSyncState } from '../sync/syncContext.ts';
import type { DeviceCache } from '../sync/syncEngine.ts';
import { commitOutsideUndo, offerOutsideUndo } from '../tasks/outsideUndo.ts';
import { createEventsStore, type EventsState, type EventsStore } from './eventsStore.ts';

const stores = new WeakMap<CalendarsApi, EventsStore>();
/** Every store made, to send their held hides as the page goes. */
const made = new Set<EventsStore>();
let listening = false;

/**
 * A hide waiting on its Undo goes out as the page goes away or the app goes to the background
 * (the Manager, 2026-11-26): closing the tab or switching apps never loses it. Each store sends
 * its own, made to outlive the page, before the Undo is let go.
 */
function flushOnLeave() {
  if (listening) return;
  listening = true;
  const flush = () => {
    for (const store of made) void store.commitHides({ keepalive: true });
    commitOutsideUndo();
  };
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
}

/** The events store for this server, made once. */
function storeFor(api: CalendarsApi, cache: DeviceCache): EventsStore {
  let store = stores.get(api);
  if (!store) {
    store = createEventsStore(api, cache);
    stores.set(api, store);
    made.add(store);
    flushOnLeave();
  }
  return store;
}

/** The device cache key for whether calendar sync was on when the server last answered. */
const SYNC_ON = 'calendar-sync';
/** That answer per device cache, once known here; the cache itself goes at sign-out. */
const remembered = new WeakMap<DeviceCache, boolean>();
const rememberedRead = new WeakSet<DeviceCache>();
const rememberedListeners = new Set<() => void>();

function remember(cache: DeviceCache, on: boolean, save: boolean) {
  if (remembered.get(cache) === on) return;
  remembered.set(cache, on);
  for (const listener of rememberedListeners) listener();
  if (save) void cache.save(SYNC_ON, on).catch(() => undefined);
}

function subscribeRemembered(listener: () => void) {
  rememberedListeners.add(listener);
  return () => rememberedListeners.delete(listener);
}

/**
 * Whether calendar sync was on the last time the server answered, read from the device cache when
 * `wanted` (a start with no answer): so an offline start still shows the last events (QA, PL-134).
 */
function useRememberedOn(cache: DeviceCache, wanted: boolean): boolean {
  useEffect(() => {
    if (!wanted || rememberedRead.has(cache)) return;
    rememberedRead.add(cache);
    cache
      .load(SYNC_ON)
      .then((value) => {
        // A live answer that came in meanwhile is newer.
        if (!remembered.has(cache)) remember(cache, value === true, false);
      })
      .catch(() => undefined);
  }, [cache, wanted]);
  return useSyncExternalStore(subscribeRemembered, () => remembered.get(cache) === true);
}

/**
 * The calendars API when this server has calendar sync on and someone is signed in, else null.
 * With no answer from the server (an offline start), it goes by the last answer this device had.
 * Never in a View as tab: shown events come from the person's own outside calendars, not PeckList,
 * so an admin looking on doesn't see them, and the server refuses those routes there too (the
 * Manager, 2026-11-26). Tasks synced with a tag are PeckList tasks and show as tasks.
 */
export function useCalendarsApi(): CalendarsApi | null {
  const viewAs = useViewAs() !== null;
  const known = useSyncState((state) =>
    state.server === null ? null : state.server.calendarSync === true,
  );
  const ready = useSyncState((state) => state.phase === 'ready');
  const signedIn = useSyncState((state) => state.account !== null);
  const api = useSyncState((state) => state.transport.calendars ?? null);
  const cache = useSyncState((state) => state.cache);
  useEffect(() => {
    if (known !== null && ready && signedIn && !viewAs) remember(cache, known, true);
  }, [cache, known, ready, signedIn, viewAs]);
  const was = useRememberedOn(cache, known === null && ready && !viewAs);
  if (!api || !ready || viewAs) return null;
  if (known !== null) return known && signedIn ? api : null;
  return was ? api : null;
}

/** The events store, or null where calendars are off. */
export function useEventsStore(): EventsStore | null {
  const api = useCalendarsApi();
  const cache = useSyncState((state) => state.cache);
  return api ? storeFor(api, cache) : null;
}

const NO_MONTHS: Readonly<Record<string, readonly ShownEvent[]>> = {};
const NO_HELD: ReadonlySet<string> = new Set();

/**
 * The shown calendars' events touching `from` to `to` (inclusive), placed on the viewer's days and
 * clock, in order. Empty where calendars are off. While shown they are fetched again on a timer
 * and on focus; offline, the last ones fetched stay.
 */
export function useShownEvents(from: string, to: string): PlacedEvent[] {
  const store = useEventsStore();
  const months = useStoreOrEmpty(store, (state) => state.months, NO_MONTHS);
  const held = useStoreOrEmpty(store, (state) => state.held, NO_HELD);
  const wanted = monthsCovering(from, to).join(',');
  useEffect(() => {
    if (!store) return;
    store.want(wanted.split(','));
  }, [store, wanted]);
  useEffect(() => store?.watch(), [store]);
  const zone = localTimeZone();
  return useMemo(() => {
    const events = wanted.split(',').flatMap((month) => months[month] ?? []);
    return eventsBetween(placeEvents(events, zone, held), from, to);
  }, [months, held, wanted, zone, from, to]);
}

/** A store's slice, or a fixed value when there is no store (hooks run either way). */
function useStoreOrEmpty<T>(
  store: EventsStore | null,
  select: (state: EventsState) => T,
  empty: T,
): T {
  const fallback = useMemo(() => createEmptyStore(), []);
  const value = useStore(store ?? fallback, select);
  return store ? value : empty;
}

function createEmptyStore(): EventsStore {
  // Never fetches: an API that answers nothing, and a cache that keeps nothing.
  return createEventsStore(
    {
      list: () => Promise.resolve({ accounts: [], providers: [] }),
      connectCalDav: () => Promise.resolve({ ok: false, code: 'calendar_failed' }),
      disconnect: () => Promise.resolve(),
      setMode: () => Promise.resolve({ ok: false, code: 'calendar_failed' }),
      createCalendar: () => Promise.resolve({ ok: false, code: 'calendar_failed' }),
      syncNow: () => Promise.resolve({ ok: false, code: 'calendar_failed' }),
      events: () => Promise.resolve([]),
      editEvent: () => Promise.resolve({ ok: false, code: 'calendar_failed' }),
      hide: () => Promise.resolve(),
      makeTask: () => Promise.resolve({ ok: false, code: 'calendar_failed' }),
    },
    { load: () => Promise.resolve(null), save: () => Promise.resolve() },
  );
}

/**
 * Tick a shown event: it goes at once with Undo, and the server hears of it when the Undo goes
 * (spec: PL-134 decision 1, "completing hides in PeckList"; nothing on the calendar changes).
 */
export function useHideEvent(): ((event: ShownEvent) => void) | null {
  const store = useEventsStore();
  const dismissStored = useStoreState((state) => state.dismissUndo);
  if (!store) return null;
  return (event) => {
    // Sent already (the page went to the background while the tick showed): no Undo to offer.
    if (!store.holdHide(event)) return;
    // The newest change gets the Undo button: a workspace change shown before is done with.
    dismissStored();
    offerOutsideUndo(
      t('calendars.event.hidden', { title: event.title || t('calendars.event.untitled') }),
      () => store.releaseHide(event),
      () => void store.commitHides(),
    );
  };
}

/** Whether calendar actions must wait: no answer from the server just now. */
export function useCalendarOffline(): boolean {
  return useSyncState((state) => state.status === 'offline');
}
