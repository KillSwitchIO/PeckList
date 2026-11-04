// Crash reports (PL-116): what the app would send about an error it could not get past, built so
// the person can read it all before saying yes. Addresses, queries, emails and long ids are taken
// out here, and again on the server.

import type { ShellCrash } from '../../ports/nativeShell.ts';
import type { CrashReportDraft } from '../../ports/sync.ts';
import { nativeShell } from '../native/shell.ts';
import { deviceKind, fingerprint } from './usage.ts';

/** Text with addresses, queries, emails and long tokens taken out. */
export function scrub(text: string): string {
  return text
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^/\s)"']+/gi, '')
    .replace(/[?#][^\s)"':]*/g, '')
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[email]')
    .replace(/\b[A-Za-z0-9_-]{24,}\b/g, '[id]');
}

/** The report for an error: its kind, fingerprint and stack (scrubbed), and the device's kind. */
export function crashReport(error: unknown, componentStack?: string | null): CrashReportDraft {
  const kind = error instanceof Error ? error.name : typeof error;
  const stack = [
    error instanceof Error ? (error.stack ?? `${error.name}: ${error.message}`) : String(error),
    componentStack ?? '',
  ]
    .filter(Boolean)
    .join('\n');
  const device = deviceKind();
  return {
    source: nativeShell() ? 'android' : 'web',
    version: __APP_VERSION__,
    kind: /^[A-Za-z_$][\w.$]{0,79}$/.test(kind) ? kind : 'Error',
    fingerprint: fingerprint(error),
    stack: scrub(stack).slice(0, 8 * 1024),
    device: Object.entries(device).map(([dimension, value]) => `${dimension}:${value}`),
  };
}

/** The report for a crash or ANR the Android shell noticed, with the shell's version. */
export function nativeCrashReport(crash: ShellCrash, version: string): CrashReportDraft {
  const kind = /^[A-Za-z_$][\w.$]{0,79}$/.test(crash.kind) ? crash.kind : 'Error';
  const place =
    crash.stack
      .split('\n')
      .find((line) => /^\s*at /.test(line))
      ?.trim() ?? '';
  const error = Object.assign(new Error(kind), { name: kind, stack: `${kind}\n    ${place}` });
  return {
    source: 'android',
    version,
    kind,
    fingerprint: fingerprint(error),
    stack: scrub(crash.stack).slice(0, 8 * 1024),
    device: Object.entries(deviceKind()).map(([dimension, value]) => `${dimension}:${value}`),
  };
}
