import { useEffect, useRef } from 'react';
import {
  CONSTANT_TIMES,
  remindersBetween,
  SNOOZE_MINUTES,
  snoozeReminder,
  type DueReminder,
} from '../../core/reminders.ts';
import { localTimeZone } from '../../core/dates.ts';
import { formatTime } from '../format.ts';
import { t } from '../i18n/i18n.ts';
import { useApply, useStoreState, useWorkspace } from '../store/hooks.ts';
import { notifier } from './notifier.ts';
import { logReminder } from './reminderLog.ts';

/** How late a reminder may still fire (the app was closed or asleep at the time). */
const GRACE_MS = 15 * 60_000;
/** How often to look again, in case a timer slept through (laptops, phones). */
const CHECK_EVERY_MS = 60_000;
/** How far ahead the Android app hands reminders to the system, and at most how many. */
const AHEAD_MS = 14 * 86_400_000;
const AHEAD_MAX = 100;
/** How long the workspace must stay still before the reminders ahead are handed over again. */
const AHEAD_SETTLE_MS = 1_000;
const FIRED_KEY = 'punchlist.firedReminders';

function firedKeys(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(FIRED_KEY) ?? '{}') as Record<string, number>;
  } catch {
    return {};
  }
}

function markFired(key: string, now: number): void {
  try {
    // Keep two days: enough to never fire one twice, small enough to never grow.
    const kept = Object.fromEntries(
      Object.entries(firedKeys()).filter(([, at]) => at > now - 2 * 86_400_000),
    );
    localStorage.setItem(FIRED_KEY, JSON.stringify({ ...kept, [key]: now }));
  } catch {
    // Private windows: the notification's tag still keeps one per reminder.
  }
}

/**
 * Fires my reminders while the app is open or in the background (spec: PL-061): each once (the
 * fired ones are remembered on this device, and the notification tag keeps tabs from doubling
 * up), up to 15 minutes late after a sleep. With the app closed, Web Push takes over.
 *
 * In the Android app (ADR-0017) the system shows them instead: the next two weeks of reminders
 * are handed over whenever they change, and fire with the app closed. The page then only notes
 * them as fired, for the notifications page.
 */
export function ReminderScheduler({ now = Date.now }: { now?: () => number }) {
  const workspace = useWorkspace();
  const me = useStoreState((state) => state.context().userId);
  const latest = useRef({ workspace, me });
  useEffect(() => {
    latest.current = { workspace, me };
  });

  // Dismiss or Snooze on a constant reminder (from the service worker, spec: R-FB-70): its
  // repeats stop here and on the server; Snooze also adds a reminder that syncs. The task's other
  // reminders come as before.
  const apply = useApply();
  const act = useRef(apply);
  useEffect(() => {
    act.current = apply;
  });
  useEffect(() => {
    const worker = navigator.serviceWorker;
    if (!worker) return;
    const onMessage = (event: MessageEvent) => {
      const data = event.data as
        { type?: string; action?: string; taskId?: string; first?: number } | undefined;
      if (data?.type !== 'punchlist-reminder' || !data.taskId || !data.first) return;
      const tag = `${data.taskId}@${data.first}`;
      const at = now();
      for (let again = 1; again < CONSTANT_TIMES; again += 1) markFired(`${tag}#${again}`, at);
      void fetch('/api/reminders/act', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: data.taskId, first: data.first, action: 'dismiss' }),
      }).catch(() => undefined);
      if (data.action === 'snooze') {
        const later = localClock(at + SNOOZE_MINUTES * 60_000);
        const nowText = localClock(at);
        const taskId = data.taskId;
        act.current(
          (ctx, ws) => snoozeReminder(ctx, ws, taskId, later, nowText),
          t('reminder.snoozed', { minutes: SNOOZE_MINUTES }),
        );
      }
    };
    worker.addEventListener('message', onMessage);
    return () => worker.removeEventListener('message', onMessage);
  }, [now]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const fire = (due: DueReminder) => {
      markFired(due.key, now());
      logReminder({ id: due.key, taskId: due.taskId, at: due.at });
      if (!notifier().scheduleAhead) void notifier().show(notificationOf(due));
    };
    const check = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      if (notifier().permission() !== 'granted') return;
      const at = now();
      const { workspace: ws, me: user } = latest.current;
      const fired = firedKeys();
      const due = remindersBetween(ws, user, at - GRACE_MS, at + 86_400_000, localTimeZone());
      // Woken late with a constant reminder's repeats piled up: the latest one only.
      const waiting = due.filter((each) => each.at <= at && !(each.key in fired));
      for (const each of waiting) {
        const later = waiting.some((other) => other.tag === each.tag && other.at > each.at);
        if (later) markFired(each.key, at);
        else fire(each);
      }
      const next = due.find((each) => each.at > at);
      // Timers far off drift or sleep: aim at the next one, but look again at least each minute.
      if (next) timer = setTimeout(check, Math.min(next.at - at, CHECK_EVERY_MS));
      else timer = setTimeout(check, CHECK_EVERY_MS);
    };
    check();
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [workspace, me, now]);

  useEffect(() => {
    if (!notifier().scheduleAhead) return;
    const handle = setTimeout(() => {
      const at = now();
      const ahead = remindersBetween(workspace, me, at, at + AHEAD_MS, localTimeZone())
        .filter((each) => each.at > at)
        .slice(0, AHEAD_MAX);
      void notifier().scheduleAhead?.(
        // Each repeat of a constant reminder is its own alarm here, so its own key.
        ahead.map((each) => ({ ...notificationOf(each), tag: each.key, at: each.at })),
      );
    }, AHEAD_SETTLE_MS);
    return () => clearTimeout(handle);
  }, [workspace, me, now]);
  return null;
}

function notificationOf(due: DueReminder) {
  return {
    title: due.title || t('task.untitled'),
    body: t('reminder.body', { time: formatTime(clock(due.at)) }),
    tag: due.tag,
    url: `/today?task=${due.taskId}`,
    ...(due.constant
      ? {
          sticky: true,
          actions: [
            { action: 'dismiss', title: t('reminder.dismiss') },
            { action: 'snooze', title: t('reminder.snooze', { minutes: SNOOZE_MINUTES }) },
          ],
        }
      : {}),
  };
}

/** "HH:mm" in the app's time zone for an instant. */
function clock(at: number): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: localTimeZone(),
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(at);
}

/** "YYYY-MM-DDTHH:mm" in the app's time zone for an instant. */
function localClock(at: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: localTimeZone(),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const part = (type: string) => parts.find((each) => each.type === type)?.value ?? '00';
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
}
