import { createBrowserNotifier } from '../../adapters/browser-notifier.ts';
import type { Notifier } from '../../ports/notifier.ts';

let current: Notifier = createBrowserNotifier();

/** The notifier reminders go through (tests swap in a fake). */
export const notifier = (): Notifier => current;

export function setNotifier(next: Notifier): void {
  current = next;
}
