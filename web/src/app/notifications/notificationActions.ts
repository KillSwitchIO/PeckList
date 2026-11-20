/**
 * What a notification's acting button asks of a task (R-FB-106, R-FB-107): a thumbs up on its
 * comment, dibs on a group's task, or Complete on a reminder (Ben, 2026-11-20). It reaches the app only from a real press, never from the
 * address alone, which a link from another site could carry (security review 2026-11-19):
 *
 * - a browser push: the service worker keeps it in Cache Storage under a one-time random name and
 *   opens the task with `?act=<name>` (public/sw-notifications.js);
 * - the Android app: the press arrives as `notificationOpen` with its action and task
 *   (NotificationOpen), trusted once the shell's per-install token is in (the same release).
 *
 * Either way it waits in {@link queueNotificationAction}'s queue until NotificationLinks finds its
 * task and does it once.
 */

/** Where the service worker keeps acting presses for the page to take (sw-notifications.js). */
export const ACTIONS_CACHE = 'pecklist-actions';

/** How long a press waits for its page: long enough for a cold start, short enough to go stale. */
export const ACTION_TTL_MS = 2 * 60_000;

export type NotificationActionKind = 'like' | 'dibs' | 'complete';

export interface PendingNotificationAction {
  kind: NotificationActionKind;
  taskId: string;
  /**
   * A reminder's Complete: when that reminder first came (its tag's time), so a notice left up
   * never completes a later occurrence (NotificationLinks). Absent: about the task as it is.
   */
  first?: number;
}

/** A one-time name as the service worker makes them: 128 random bits, base64url. */
const NONCE = /^[A-Za-z0-9_-]{22}$/;

function entryOf(value: unknown): (PendingNotificationAction & { at: number }) | null {
  if (!value || typeof value !== 'object') return null;
  const { kind, taskId, at, first } = value as Record<string, unknown>;
  if (kind !== 'like' && kind !== 'dibs' && kind !== 'complete') return null;
  if (typeof taskId !== 'string' || !taskId) return null;
  if (typeof at !== 'number' || !Number.isFinite(at)) return null;
  const named = typeof first === 'number' && Number.isFinite(first) && first > 0;
  return { kind, taskId, at, ...(named ? { first } : {}) };
}

async function read(response: Response | undefined) {
  if (!response) return null;
  try {
    return entryOf(await response.json());
  } catch {
    return null;
  }
}

/**
 * The press kept under `name`, taken: deleted first, and handed back only if this call is the one
 * that deleted it (so two tabs or a reload never both act) and it is fresh. Stale entries go on
 * every read, so the cache never piles up. Null for anything else, including no Cache Storage.
 */
export async function takeNotificationAction(
  name: string,
  now: number = Date.now(),
): Promise<PendingNotificationAction | null> {
  if (!NONCE.test(name) || typeof caches === 'undefined') return null;
  try {
    const cache = await caches.open(ACTIONS_CACHE);
    const fresh = (at: number) => at <= now + 60_000 && now - at <= ACTION_TTL_MS;
    for (const request of await cache.keys()) {
      const entry = await read(await cache.match(request));
      if (!entry || !fresh(entry.at)) await cache.delete(request);
    }
    const key = `/act/${name}`;
    const entry = await read(await cache.match(key));
    if (!(await cache.delete(key))) return null;
    if (!entry || !fresh(entry.at)) return null;
    return {
      kind: entry.kind,
      taskId: entry.taskId,
      ...(entry.first !== undefined ? { first: entry.first } : {}),
    };
  } catch {
    return null;
  }
}

const queue: PendingNotificationAction[] = [];
const listeners = new Set<() => void>();

/** A press to do once its task is here (NotificationLinks takes it). */
export function queueNotificationAction(action: PendingNotificationAction): void {
  queue.push(action);
  for (const listener of listeners) listener();
}

/** The presses waiting, taken off the queue (the caller keeps any whose task has not arrived). */
export function takeQueuedNotificationActions(): PendingNotificationAction[] {
  return queue.splice(0, queue.length);
}

/** Called when a press is queued; returns the unsubscribe. */
export function onNotificationAction(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
