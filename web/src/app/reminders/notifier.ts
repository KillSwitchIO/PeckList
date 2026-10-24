import { createBrowserNotifier } from '../../adapters/browser-notifier.ts';
import { createBrowserPush } from '../../adapters/browser-push.ts';
import type { BrowserPush, Notifier } from '../../ports/notifier.ts';

let current: Notifier = createBrowserNotifier();

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
