import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setTimeZone } from '../../core/dates.ts';
import { useAppliedTimeZone } from './useAppliedTimeZone.ts';

const KEY = 'pecklist.serverTimeZone';
const DEVICE = new Intl.DateTimeFormat().resolvedOptions().timeZone;
// Neither may be the zone of the machine the tests run on.
const SERVER_ZONE = DEVICE === 'Asia/Tokyo' ? 'Europe/Berlin' : 'Asia/Tokyo';
const OWN_ZONE = DEVICE === 'Pacific/Auckland' ? 'America/Lima' : 'Pacific/Auckland';

const state = vi.hoisted(() => ({
  chosen: null as string | null,
  server: null as { timeZone?: string | null } | null,
}));

vi.mock('../store/hooks.ts', () => ({
  useStoreState: (select: (store: unknown) => unknown) =>
    select({ workspace: { entities: { settings: [{ timeZone: state.chosen }] } } }),
}));
vi.mock('../sync/syncContext.ts', () => ({
  useSyncState: (select: (sync: unknown) => unknown) => select({ server: state.server }),
}));

const applied = () => renderHook(() => useAppliedTimeZone()).result.current;

describe('the time zone apps use', () => {
  beforeEach(() => {
    state.chosen = null;
    state.server = null;
    localStorage.clear();
  });
  afterEach(() => setTimeZone(null));

  it('is the server operator’s when TZ is set, and remembers it for offline starts', () => {
    state.server = { timeZone: SERVER_ZONE };
    expect(applied()).toBe(SERVER_ZONE);
    expect(localStorage.getItem(KEY)).toBe(SERVER_ZONE);
  });

  it('is the device’s when the server sends none', () => {
    state.server = { timeZone: null };
    expect(applied()).toBe(DEVICE);
    state.server = {};
    expect(applied()).toBe(DEVICE);
  });

  it('forgets a zone remembered from before, once the server answers with none', () => {
    localStorage.setItem(KEY, SERVER_ZONE);
    state.server = { timeZone: null };
    expect(applied()).toBe(DEVICE);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('keeps the remembered zone until the server has answered', () => {
    localStorage.setItem(KEY, SERVER_ZONE);
    expect(applied()).toBe(SERVER_ZONE);
    expect(localStorage.getItem(KEY)).toBe(SERVER_ZONE);
  });

  it('is the person’s own choice above all', () => {
    state.chosen = OWN_ZONE;
    state.server = { timeZone: SERVER_ZONE };
    expect(applied()).toBe(OWN_ZONE);
    state.server = { timeZone: null };
    expect(applied()).toBe(OWN_ZONE);
  });
});
