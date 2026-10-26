import { createBrowserNotifier } from '../../adapters/browser-notifier.ts';
import { createBrowserPush } from '../../adapters/browser-push.ts';
import { createCapacitorNotifier } from '../../adapters/capacitor-notifier.ts';
import { createShellNotifier } from '../../adapters/shell-notifier.ts';
import type { BrowserPush, Notifier } from '../../ports/notifier.ts';
import { t } from '../i18n/i18n.ts';

// The Android app's own reminders when it has them (ADR-0017; an older app's go through Local
// Notifications), else the browser's.
let current: Notifier =
  createShellNotifier(() => createCapacitorNotifier(t('reminder.channel'))) ??
  createCapacitorNotifier(t('reminder.channel')) ??
  createBrowserNotifier();

/** The notifier reminders go through (tests swap in a fake). */
export const notifier = (): Notifier => current;

export function setNotifier(next: Notifier): void {
  current = next;
}

let currentPush: BrowserPush = createBrowserPush();

/** This browser's Web Push (tests swap in a fake). */
export const browserPush = (): BrowserPush => currentPush;

export function setBrowserPush(next: BrowserPush): void {
  currentPush = next;
}
