import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientReport, SyncTransport, TelemetryStatus } from '../../ports/sync.ts';
import {
  applyStatus,
  countError,
  countUse,
  deviceKind,
  fingerprint,
  noteTiming,
  startUsage,
  stopUsage,
  viewOf,
} from './usage.ts';
import { setNativeShell } from '../native/shell.ts';
import type { NativeShell } from '../../ports/nativeShell.ts';

const on: TelemetryStatus = { enabled: true, shareUsage: true, crashReports: 'ask' };

function transport(status: TelemetryStatus) {
  const reports: ClientReport[] = [];
  const fake = {
    telemetry: {
      status: () => Promise.resolve(status),
      choose: () => Promise.resolve(status),
      report: (report: ClientReport) => {
        reports.push(report);
        return Promise.resolve();
      },
    },
  } as unknown as SyncTransport;
  return { fake, reports };
}

beforeEach(() => localStorage.clear());
afterEach(() => stopUsage());

describe('usage counts (PL-116)', () => {
  it('counts nothing unless the server reports and the person shares', async () => {
    const { fake, reports } = transport({ ...on, shareUsage: false });
    localStorage.setItem(
      'pecklist.usage',
      JSON.stringify({ since: 0, features: { 'view.today': 4 }, errors: {}, timings: {} }),
    );
    await startUsage(fake);
    countUse('view.today');
    expect(reports).toEqual([]);
    // What was kept from before is forgotten too.
    expect(localStorage.getItem('pecklist.usage')).toBeNull();
  });

  it('sends what was kept once it is due, with the device kind and nothing else', async () => {
    const { fake, reports } = transport(on);
    localStorage.setItem(
      'pecklist.usage',
      JSON.stringify({
        since: Date.now() - 7 * 60 * 60 * 1000,
        features: { 'view.calendar': 2 },
        errors: {},
        timings: {},
      }),
    );
    await startUsage(fake);
    expect(reports).toHaveLength(1);
    const [report] = reports;
    expect(report?.features).toEqual({ 'view.calendar': 2 });
    expect(report?.device).toMatch(/^[0-9a-f]{32}$/);
    expect(['tab', 'pwa', 'android']).toContain(report?.platform);
    // A second start the same day keeps the same device id and sends nothing yet.
    countUse('undo');
    noteTiming('sync', 120);
    stopUsage();
    await startUsage(fake);
    expect(reports).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem('pecklist.usage')!).features).toEqual({ undo: 1 });
  });

  it('fingerprints an error by its kind and place, never its message or the address it came from', () => {
    const at = (url: string, message = 'Groceries for Sam') => {
      const error = new TypeError(message);
      error.stack = `TypeError: ${message}\n    at render (${url})\n    at other (x.js:1:1)`;
      return fingerprint(error);
    };
    expect(at('https://tasks.example.com/assets/index-abc.js:10:5')).toBe(
      at('https://other.example/assets/index-abc.js:10:9?x=1', 'other text'),
    );
    expect(at('https://tasks.example.com/assets/index-abc.js:10:5')).not.toBe(
      at('https://tasks.example.com/assets/index-abc.js:11:5'),
    );
    expect(fingerprint(new Error('x'))).toMatch(/^[0-9a-f]{8}$/);
  });

  it('counts errors and views only while on', () => {
    applyStatus(null);
    applyStatus(on);
    countError(new RangeError('a'));
    countUse(viewOf('/lists/abc') ?? 'undo');
    const kept = JSON.parse(localStorage.getItem('pecklist.usage')!);
    expect(Object.values(kept.errors)).toEqual([1]);
    expect(kept.features).toEqual({ 'view.list': 1 });
    applyStatus(null);
    countUse('undo');
    expect(localStorage.getItem('pecklist.usage')).toBeNull();
  });

  it('names views by their first path part, and leaves the rest out', () => {
    expect(viewOf('/today')).toBe('view.today');
    expect(viewOf('/day/2026-11-04')).toBe('view.day');
    expect(viewOf('/settings/api-keys')).toBe('view.settings');
    expect(viewOf('/admin/users')).toBeNull();
  });

  it("describes the device in the server's words", () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
    );
    const kind = deviceKind();
    expect([kind.browser, kind.os]).toEqual(['chrome', 'linux']);
    expect(kind.language).toMatch(/^[a-z]{2}$/);
    vi.restoreAllMocks();
  });
});

describe('the Android shell in usage counts (PL-116)', () => {
  afterEach(() => setNativeShell(null));

  it("adds the shell's reminder counts and permission states to a report, and nothing else it says", async () => {
    setNativeShell({
      info: () => Promise.resolve({ api: 4, server: null, version: '0.8.0' }),
      usage: () =>
        Promise.resolve({
          counts: { 'reminder.onTime': 5, 'reminder.lateMore': 1, 'Groceries for Sam': 9 },
          permissions: { notify: 'on', exact: 'off', battery: 'on' },
        }),
    } as unknown as NativeShell);
    const { fake, reports } = transport(on);
    localStorage.setItem(
      'pecklist.usage',
      JSON.stringify({ since: 0, features: {}, errors: {}, timings: {} }),
    );
    await startUsage(fake);
    const [report] = reports;
    expect(report?.platform).toBe('android');
    expect(report?.features).toEqual({ 'reminder.onTime': 5, 'reminder.lateMore': 1 });
    expect([report?.notify, report?.exact, report?.battery]).toEqual(['on', 'off', 'on']);
    // The versions: the web app's, and the Android app's around it.
    expect([report?.web, report?.app]).toEqual([__APP_VERSION__, '0.8.0']);
  });
});
