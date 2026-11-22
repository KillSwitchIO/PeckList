import { browserUses24h } from '../../core/intl.ts';
import type { PushApi } from '../../ports/sync.ts';

type Subscription = Parameters<PushApi['subscribe']>[0];

/**
 * A browser's subscription as the server keeps it (schema 22): with the clock this browser reads by
 * its own default. On an automatic language the app here shows that clock, and the browser's own
 * default can read 24-hour while the languages it asks for read 12-hour (an en-GB browser asking for
 * en-US), so the server words this device's pushes on it. A picked language reads its own.
 */
export function withClock(subscription: Subscription): Subscription {
  return { ...subscription, clock24: browserUses24h() };
}
