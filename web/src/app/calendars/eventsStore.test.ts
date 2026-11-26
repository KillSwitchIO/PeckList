import { describe, expect, it } from 'vitest';
import { eventKey } from '../../core/calendarEvents.ts';
import { fakeEvent, FakeCalendars } from '../../test/fakeCalendars.ts';
import { createEventsStore, FRESH_MS } from './eventsStore.ts';

function memoryCache() {
  const kept = new Map<string, unknown>();
  return {
    kept,
    load: (key: string) => Promise.resolve(kept.get(key) ?? null),
    save: (key: string, value: unknown) => {
      kept.set(key, value);
      return Promise.resolve();
    },
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('the shown events on this device (PL-134)', () => {
  it('fetches a month once while fresh, and again once it is old', async () => {
    const api = new FakeCalendars();
    let now = 1_000_000;
    const store = createEventsStore(api, memoryCache(), () => now);

    store.want(['2026-12']);
    await settle();
    store.want(['2026-12']);
    await settle();
    now += FRESH_MS + 1;
    store.want(['2026-12']);
    await settle();

    expect(api.fetches).toEqual(['2026-12-01..2026-12-31', '2026-12-01..2026-12-31']);
  });

  it('shows a held hide again when it never reaches the server', async () => {
    const api = new FakeCalendars();
    const event = fakeEvent('2026-12-01');
    api.shown = [event];
    const store = createEventsStore(api, memoryCache());

    store.holdHide(event);
    expect(store.getState().held.has(eventKey(event))).toBe(true);
    api.offline = true;
    await store.commitHides();

    expect(store.getState().held.has(eventKey(event))).toBe(false);
  });

  it('hides one day of a repeating event, and a single event whole', async () => {
    const api = new FakeCalendars();
    const store = createEventsStore(api, memoryCache());

    store.holdHide(fakeEvent('2026-12-01', { id: 'gym', recurring: true }));
    store.holdHide(fakeEvent('2026-12-01', { id: 'dentist' }));
    await store.commitHides();

    expect(api.calls).toEqual(['hide gym 2026-12-01', 'hide dentist all']);
  });

  it('keeps what it fetched in the device cache, and starts from it next time', async () => {
    const api = new FakeCalendars();
    api.shown = [fakeEvent('2026-12-03')];
    const cache = memoryCache();
    const first = createEventsStore(api, cache);
    first.want(['2026-12']);
    await settle();
    await settle();

    api.offline = true;
    const next = createEventsStore(api, cache);
    next.want(['2026-12']);
    await settle();
    await settle();

    expect(next.getState().months['2026-12']?.map((each) => each.title)).toEqual(['Dentist']);
  });
});
