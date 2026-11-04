// Usage counts (PL-116, ADR-0018): what the app counts and how it reports it. Counts go to the
// person's own server, which adds them up and sends one bucketed report a day; nothing goes
// anywhere else. Nothing is counted unless the server reports usage and the person shares
// (Settings > Usage stats), and only names on the list below: no titles, text or ids, ever.

import type { ClientReport, SyncTransport, TelemetryStatus } from '../../ports/sync.ts';
import { nativeShell } from '../native/shell.ts';

/** Everything the app counts; the server drops any other name. */
export type Feature =
  | 'view.today'
  | 'view.inbox'
  | 'view.upcoming'
  | 'view.due'
  | 'view.all'
  | 'view.calendar'
  | 'view.day'
  | 'view.search'
  | 'view.completed'
  | 'view.trash'
  | 'view.list'
  | 'view.tag'
  | 'view.filter'
  | 'view.assigned'
  | 'view.shared'
  | 'view.friends'
  | 'view.notifications'
  | 'view.stats'
  | 'view.settings'
  | 'task.added'
  | 'task.completed'
  | 'quickAdd.date'
  | 'quickAdd.tag'
  | 'quickAdd.list'
  | 'quickAdd.priority'
  | 'drag.reschedule'
  | 'undo'
  | 'shortcut'
  | 'swipe'
  | 'easterEgg'
  | 'dataError'
  | 'reminder.onTime'
  | 'reminder.late1m'
  | 'reminder.late5m'
  | 'reminder.lateMore';

/** What the Android shell may add to a report: how late its reminders showed. */
const SHELL_COUNTS = new Set<string>([
  'reminder.onTime',
  'reminder.late1m',
  'reminder.late5m',
  'reminder.lateMore',
]);

export type Timing = 'coldStart' | 'sync' | 'search';

const KEY = 'pecklist.usage';
const DEVICE_KEY = 'pecklist.usage.device';
/** A device reports at most this often (and on the next start after). */
const EVERY_MS = 6 * 60 * 60 * 1000;
const MAX_SAMPLES = 50;

interface Kept {
  since: number;
  features: Record<string, number>;
  errors: Record<string, number>;
  timings: Record<string, number[]>;
}

let on = false;
let kept: Kept = empty();
let sender: SyncTransport | null = null;
let timer: ReturnType<typeof setInterval> | undefined;

function empty(): Kept {
  return { since: Date.now(), features: {}, errors: {}, timings: {} };
}

function load(): Kept {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...empty(), ...(JSON.parse(raw) as Partial<Kept>) };
  } catch {
    // Unreadable or not allowed: start over.
  }
  return empty();
}

function save(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(kept));
  } catch {
    // Full or not allowed: the counts live in memory until the next report.
  }
}

/** Count one use of a feature (nothing while usage counting is off). */
export function countUse(feature: Feature): void {
  if (!on) return;
  kept.features[feature] = (kept.features[feature] ?? 0) + 1;
  save();
}

/** Note how long something took, in milliseconds. */
export function noteTiming(timing: Timing, milliseconds: number): void {
  if (!on || !Number.isFinite(milliseconds) || milliseconds < 0) return;
  const samples = (kept.timings[timing] ??= []);
  samples.push(Math.round(milliseconds));
  if (samples.length > MAX_SAMPLES) samples.splice(0, samples.length - MAX_SAMPLES);
  save();
}

/**
 * An error, counted by its fingerprint: a hash of its kind and where it was thrown (the first
 * stack frame, with no address or query), so the same bug counts as one and no message goes.
 */
export function countError(error: unknown): void {
  if (!on) return;
  const print = fingerprint(error);
  kept.errors[print] = (kept.errors[print] ?? 0) + 1;
  save();
}

export function fingerprint(error: unknown): string {
  const kind = error instanceof Error ? error.name : typeof error;
  const stack = error instanceof Error ? (error.stack ?? '') : '';
  const frame =
    stack
      .split('\n')
      .map((line) => line.trim())
      .find((line) => /^at |@/.test(line)) ?? '';
  // The file and line only: no origin, query or hash, so no server address goes either.
  const place = (/([\w.-]+\.(?:m?js|tsx?)):(\d+)/.exec(frame) ?? []).slice(1).join(':');
  let hash = 0x811c9dc5;
  for (const char of `${kind}|${place}`) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function deviceId(): string {
  try {
    const known = localStorage.getItem(DEVICE_KEY);
    if (known) return known;
    const made = crypto.randomUUID().replace(/-/g, '');
    localStorage.setItem(DEVICE_KEY, made);
    return made;
  } catch {
    return 'unsaved-device-id';
  }
}

/** The device's kind, from what the browser says about itself, in the server's words. */
export function deviceKind(): Omit<ClientReport, 'device' | 'features' | 'errors' | 'timings'> {
  const agent = navigator.userAgent;
  const browser = /Edg\//.test(agent)
    ? 'edge'
    : /SamsungBrowser/.test(agent)
      ? 'samsung'
      : /Firefox\//.test(agent)
        ? 'firefox'
        : /Chrome\//.test(agent)
          ? 'chrome'
          : /Safari\//.test(agent)
            ? 'safari'
            : 'other';
  const os = /Android/.test(agent)
    ? 'android'
    : /iPhone|iPad|iPod/.test(agent)
      ? 'ios'
      : /CrOS/.test(agent)
        ? 'chromeos'
        : /Windows/.test(agent)
          ? 'windows'
          : /Mac OS X|Macintosh/.test(agent)
            ? 'macos'
            : /Linux/.test(agent)
              ? 'linux'
              : 'other';
  const width = Math.min(window.screen?.width ?? window.innerWidth, window.innerWidth || Infinity);
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches ?? false;
  const dark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  return {
    platform: nativeShell() ? 'android' : standalone ? 'pwa' : 'tab',
    browser,
    os,
    screen: width < 600 ? 'phone' : width < 1024 ? 'tablet' : 'desktop',
    theme:
      document.documentElement.dataset.theme === 'dark' ||
      (!document.documentElement.dataset.theme && dark)
        ? 'dark'
        : 'light',
    language: (navigator.language || 'en').slice(0, 2).toLowerCase(),
  };
}

/** Send what was counted, when it is due (or `now`), and start counting afresh. */
async function flush(now = false): Promise<void> {
  if (!on || !sender?.telemetry) return;
  if (!now && Date.now() - kept.since < EVERY_MS) return;
  const nothing =
    Object.keys(kept.features).length === 0 &&
    Object.keys(kept.errors).length === 0 &&
    Object.keys(kept.timings).length === 0 &&
    !nativeShell();
  const report: ClientReport = {
    device: deviceId(),
    ...deviceKind(),
    web: __APP_VERSION__,
    features: kept.features,
    errors: kept.errors,
    timings: kept.timings,
  };
  // The Android shell's own counts and the permissions reminders need.
  const shell = await nativeShell()?.usage?.();
  if (shell) {
    for (const [name, count] of Object.entries(shell.counts)) {
      if (SHELL_COUNTS.has(name) && count > 0)
        report.features[name] = (report.features[name] ?? 0) + count;
    }
    report.notify = shell.permissions.notify;
    report.exact = shell.permissions.exact;
    report.battery = shell.permissions.battery;
  }
  const app = await nativeShell()
    ?.info()
    .then((info) => info.version)
    .catch(() => undefined);
  if (app) report.app = app;
  const before = kept;
  kept = empty();
  save();
  if (nothing && !now) return;
  try {
    await sender.telemetry.report(report);
  } catch {
    // Offline or refused: keep the counts for the next time.
    kept = { ...before, since: before.since };
    save();
  }
}

/** Whether this person's usage is counted now. */
export function counting(): boolean {
  return on;
}

/** The server's answer decides: count or not, and forget what was kept when not. */
export function applyStatus(status: TelemetryStatus | null): void {
  on = status !== null && status.enabled && status.shareUsage;
  if (!on) {
    kept = empty();
    try {
      localStorage.removeItem(KEY);
    } catch {
      // Not allowed: nothing kept anyway.
    }
  }
}

function onError(event: ErrorEvent): void {
  countError(event.error ?? new Error(event.message));
}

function onRejection(event: PromiseRejectionEvent): void {
  countError(event.reason);
}

/** Start counting for a signed-in session (when the server and the person allow it). */
export async function startUsage(transport: SyncTransport): Promise<void> {
  stopUsage();
  if (!transport.telemetry) return;
  sender = transport;
  kept = load();
  applyStatus(await transport.telemetry.status().catch(() => null));
  if (!on) return;
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  timer = setInterval(() => void flush(), 15 * 60 * 1000);
  noteTiming('coldStart', performance.now());
  await flush();
}

/** Stop counting (signed out, or the app goes away). */
export function stopUsage(): void {
  if (timer) clearInterval(timer);
  timer = undefined;
  window.removeEventListener('error', onError);
  window.removeEventListener('unhandledrejection', onRejection);
  on = false;
  sender = null;
}

/** The view a path shows, as a feature name (or null for pages not counted). */
export function viewOf(pathname: string): Feature | null {
  const first = pathname.split('/')[1] ?? '';
  const views: Record<string, Feature> = {
    today: 'view.today',
    inbox: 'view.inbox',
    upcoming: 'view.upcoming',
    due: 'view.due',
    all: 'view.all',
    calendar: 'view.calendar',
    day: 'view.day',
    search: 'view.search',
    completed: 'view.completed',
    trash: 'view.trash',
    lists: 'view.list',
    tags: 'view.tag',
    filters: 'view.filter',
    assigned: 'view.assigned',
    shared: 'view.shared',
    friends: 'view.friends',
    notifications: 'view.notifications',
    stats: 'view.stats',
    settings: 'view.settings',
  };
  return views[first] ?? null;
}
