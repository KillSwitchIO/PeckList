import { useEffect, useRef } from 'react';
import { remindersBetween, type DueReminder } from '../../core/reminders.ts';
import { localTimeZone } from '../../core/dates.ts';
import { formatTime } from '../format.ts';
import { t } from '../i18n/i18n.ts';
import { useStoreState, useWorkspace } from '../store/hooks.ts';
import { notifier } from './notifier.ts';
import { logReminder } from './reminderLog.ts';

/** How late a reminder may still fire (the app was closed or asleep at the time). */
const GRACE_MS = 15 * 60_000;
/** How often to look again, in case a timer slept through (laptops, phones). */
const CHECK_EVERY_MS = 60_000;
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
 * up), up to 15 minutes late after a sleep. With the app closed, Web Push takes over (later).
 */
export function ReminderScheduler({ now = Date.now }: { now?: () => number }) {
  const workspace = useWorkspace();
  const me = useStoreState((state) => state.context().userId);
  const latest = useRef({ workspace, me });
  useEffect(() => {
    latest.current = { workspace, me };
  });

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const fire = (due: DueReminder) => {
      markFired(due.key, now());
      logReminder({ id: due.key, taskId: due.taskId, at: due.at });
      void notifier().show({
        title: due.title || t('task.untitled'),
        body: t('reminder.body', { time: formatTime(clock(due.at)) }),
        tag: due.key,
        url: `/today?task=${due.taskId}`,
      });
    };
    const check = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      if (notifier().permission() !== 'granted') return;
      const at = now();
      const { workspace: ws, me: user } = latest.current;
      const fired = firedKeys();
      const due = remindersBetween(ws, user, at - GRACE_MS, at + 86_400_000, localTimeZone());
      for (const each of due) if (each.at <= at && !(each.key in fired)) fire(each);
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
  return null;
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
