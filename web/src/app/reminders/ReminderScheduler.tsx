import { Snackbar } from '@mui/material';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CONSTANT_TIMES,
  remindersBetween,
  SNOOZE_MINUTES,
  snoozeReminder,
  type DueReminder,
  type Snooze,
} from '../../core/reminders.ts';
import { localTimeZone } from '../../core/dates.ts';
import { formatTime } from '../format.ts';
import { t } from '../i18n/i18n.ts';
import { useApply, useStoreState, useWorkspace } from '../store/hooks.ts';
import { useSyncEngine, useSyncState } from '../sync/syncContext.ts';
import { notificationAllowed } from '../../core/notificationSwitches.ts';
import { localClock } from './clock.ts';
import { notifier } from './notifier.ts';
import { logReminder } from './reminderLog.ts';
import { dateTimeFormat } from '../../core/intl.ts';
import type { ReminderPress, RemindersApi } from '../../ports/sync.ts';

/** How late a reminder may still fire (the app was closed or asleep at the time). */
const GRACE_MS = 15 * 60_000;
/** How often to look again, in case a timer slept through (laptops, phones). */
const CHECK_EVERY_MS = 60_000;
/** How far ahead the Android app hands reminders to the system, and at most how many. */
const AHEAD_MS = 14 * 86_400_000;
const AHEAD_MAX = 100;
/** How long the workspace must stay still before the reminders ahead are handed over again. */
const AHEAD_SETTLE_MS = 1_000;
const FIRED_KEY = 'pecklist.firedReminders';
const HELD_KEY = 'pecklist.heldReminderPresses';
/** A week on, a press the server never heard goes: the task has long been dealt with. */
const HELD_KEEP_MS = 7 * 86_400_000;

/**
 * A Dismiss or Snooze the server could not be told of (offline, restarting): told again after the
 * next sync that gets through, as the Android app keeps its own. A snooze also stays here, so this
 * device brings it back meanwhile.
 */
interface Held {
  user: string;
  press: ReminderPress;
  /** When it was pressed */
  at: number;
  /** A snooze: when it comes back */
  snooze?: number;
}

function heldPresses(now: number): Held[] {
  try {
    const all = JSON.parse(localStorage.getItem(HELD_KEY) ?? '[]') as Held[];
    return all.filter((each) => each.at > now - HELD_KEEP_MS);
  } catch {
    return [];
  }
}

function saveHeld(all: readonly Held[]): void {
  try {
    if (all.length === 0) localStorage.removeItem(HELD_KEY);
    else localStorage.setItem(HELD_KEY, JSON.stringify(all));
  } catch {
    // Private windows: kept while the page is open.
  }
}

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
  // What the server has had (audit E2): a reminder for a task it never acknowledged is marked
  // local, so the Android app's background check-in, which knows only the server's, keeps it.
  // Every sync makes new acks, at least each 30 s: only one reaching a task handed over as local
  // calls for handing them over again, not every sync.
  const engine = useSyncEngine();
  const [handedLocal, setHandedLocal] = useState<readonly string[]>([]);
  const reached = useSyncState((state) => handedLocal.filter((id) => id in state.acks).length);
  const signedIn = useSyncState((state) => state.account !== null);
  // My snoozes on the server (audit B3): they fire here as reminders do, and go to the Android
  // app with the reminders ahead, whose list replaces the phone's (a snooze left out would go).
  // Fetched again after each sync, and right before each hand-over.
  const reminders = useSyncState((state) =>
    state.account ? state.transport.reminders : undefined,
  );
  const lastSynced = useSyncState((state) => state.lastSynced);
  const [fetchedSnoozes, setSnoozes] = useState<readonly Snooze[]>(NO_SNOOZES);
  // Whether the server's list was ever had: until then, handing over none would drop the phone's.
  const [had, setHad] = useState(false);
  const keep = useRef((found: readonly Snooze[]) => {
    setHad(true);
    setSnoozes((before) => (sameSnoozes(before, found) ? before : found));
  });
  // Signed out, or into another server: what was had is no one's now.
  const [hadFrom, setHadFrom] = useState(reminders);
  if (hadFrom !== reminders) {
    setHadFrom(reminders);
    setHad(false);
    setSnoozes(NO_SNOOZES);
  }
  const [held, setHeld] = useState<readonly Held[]>(() => heldPresses(now()));
  const heldRef = useRef(held);
  const changeHeld = useRef((change: (before: readonly Held[]) => readonly Held[]) => {
    heldRef.current = change(heldRef.current);
    saveHeld(heldRef.current);
    setHeld(heldRef.current);
  });
  // The server's snoozes, and mine it has not heard of yet.
  const waiting = useMemo(
    () =>
      held.flatMap((each) =>
        each.user === me && each.snooze !== undefined
          ? [{ taskId: each.press.taskId, at: each.snooze }]
          : [],
      ),
    [held, me],
  );
  const snoozes = useMemo(
    () => (waiting.length === 0 ? fetchedSnoozes : [...fetchedSnoozes, ...waiting]),
    [fetchedSnoozes, waiting],
  );
  const latest = useRef({ workspace, me, snoozes, now });
  useEffect(() => {
    latest.current = { workspace, me, snoozes, now };
  });
  // After a sync gets through: presses the server missed first, then its list (with them in).
  useEffect(() => {
    if (!reminders) return;
    let live = true;
    void (async () => {
      const { me: user, now: clockNow } = latest.current;
      await tellAgain(reminders, user, clockNow(), heldRef.current, (done) =>
        changeHeld.current((before) => before.filter((each) => each !== done)),
      );
      const found = await reminders.snoozes();
      if (live) keep.current(found);
    })().catch(() => undefined);
    return () => {
      live = false;
    };
  }, [reminders, lastSynced]);
  const [snoozed, setSnoozed] = useState(false);

  // Dismiss or Snooze on a constant reminder (from the service worker, spec: R-FB-70): its
  // repeats stop here and on the server. On a server, Snooze is mine alone (audit B3): the server
  // keeps it and the task stays as it is. With none, Snooze adds a reminder to the task. The
  // task's other reminders come as before.
  const apply = useApply();
  const act = useRef(apply);
  const remindersRef = useRef(reminders);
  useEffect(() => {
    act.current = apply;
    remindersRef.current = reminders;
  });
  useEffect(() => {
    const worker = navigator.serviceWorker;
    if (!worker) return;
    const onMessage = (event: MessageEvent) => {
      const data = event.data as
        { type?: string; action?: string; taskId?: string; first?: number } | undefined;
      if (data?.type !== 'pecklist-reminder' || !data.taskId || !data.first) return;
      const tag = `${data.taskId}@${data.first}`;
      const at = now();
      for (let again = 1; again < CONSTANT_TIMES; again += 1) markFired(`${tag}#${again}`, at);
      const server = remindersRef.current;
      if (server) {
        const press = {
          taskId: data.taskId,
          first: data.first,
          action: data.action === 'snooze' ? ('snooze' as const) : ('dismiss' as const),
        };
        void server
          .act(press)
          .then(
            () => {
              if (press.action === 'snooze') setSnoozed(true);
              return server.snoozes().then((found) => keep.current(found));
            },
            () => {
              // Not heard (offline, the server restarting): it still comes back here, and the
              // server is told after the next sync that gets through.
              const user = latest.current.me;
              const snooze = Math.floor(at / 60_000) * 60_000 + SNOOZE_MINUTES * 60_000;
              changeHeld.current((before) => [
                ...before,
                { user, press, at, ...(press.action === 'snooze' ? { snooze } : {}) },
              ]);
              if (press.action === 'snooze') setSnoozed(true);
            },
          )
          .catch(() => undefined);
        return;
      }
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
      const { workspace: ws, me: user, snoozes: mine } = latest.current;
      const fired = firedKeys();
      const due = notificationAllowed(ws.entities.settings[0], 'reminder')
        ? remindersBetween(ws, user, at - GRACE_MS, at + 86_400_000, localTimeZone(), mine)
        : [];
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
  }, [workspace, me, now, snoozes]);

  useEffect(() => {
    if (!notifier().scheduleAhead) return;
    let live = true;
    const handOver = (mine: readonly Snooze[]) => {
      if (!live) return;
      const at = now();
      const { acks } = engine.getState();
      const isLocal = (taskId: string) => signedIn && !(taskId in acks);
      const ahead = (
        notificationAllowed(workspace.entities.settings[0], 'reminder')
          ? remindersBetween(workspace, me, at, at + AHEAD_MS, localTimeZone(), mine)
          : []
      )
        .filter((each) => each.at > at)
        .slice(0, AHEAD_MAX);
      const local = [...new Set(ahead.map((each) => each.taskId).filter(isLocal))];
      setHandedLocal((before) => (local.length === 0 && before.length === 0 ? before : local));
      void notifier().scheduleAhead?.(
        // Each repeat of a constant reminder is its own alarm here, so its own key. A repeating
        // task is completed in the app, which works out its next date.
        ahead.map((each) => ({
          ...notificationOf(each),
          tag: each.key,
          at: each.at,
          repeats: Boolean(
            workspace.entities.tasks.find((task) => task.id === each.taskId)?.recurrence,
          ),
          ...(isLocal(each.taskId) ? { local: true } : {}),
        })),
      );
    };
    const handle = setTimeout(() => {
      // A snooze pressed on the phone a moment ago is on the server, not yet here: ask first.
      if (!reminders) handOver(snoozes);
      else
        void reminders.snoozes().then(
          (found) => {
            handOver([...found, ...waiting]);
            keep.current(found);
          },
          // The list was never had (offline since the page opened): handing over without it
          // would take the phone's own snoozes off its alarms. The phone keeps what it has.
          () => {
            if (had) handOver(snoozes);
          },
        );
    }, AHEAD_SETTLE_MS);
    return () => {
      live = false;
      clearTimeout(handle);
    };
  }, [workspace, me, now, engine, reached, signedIn, reminders, snoozes, waiting, had]);
  return (
    <Snackbar
      open={snoozed}
      autoHideDuration={4000}
      onClose={(_, reason) => {
        if (reason !== 'clickaway') setSnoozed(false);
      }}
      message={t('reminder.snoozed', { minutes: SNOOZE_MINUTES })}
      // At the top, as the sync notices: clear of the undo button and the + button.
      anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
    />
  );
}

/**
 * Tell the server of my presses it missed, oldest first, stopping at the first it still misses.
 * A snooze asks for the minutes left to its time here, so it comes back when it would have; one
 * whose time has passed (this device brought it back) only stops the repeats, as Dismiss does.
 */
async function tellAgain(
  server: RemindersApi,
  user: string,
  now: number,
  all: readonly Held[],
  done: (each: Held) => void,
): Promise<void> {
  for (const each of all) {
    if (each.user !== user) continue;
    const left = each.snooze === undefined ? 0 : Math.ceil((each.snooze - now) / 60_000);
    await server.act(
      each.snooze === undefined
        ? each.press
        : left > 0
          ? { ...each.press, minutes: left }
          : { ...each.press, action: 'dismiss' },
    );
    done(each);
  }
}

const NO_SNOOZES: readonly Snooze[] = [];

function sameSnoozes(a: readonly Snooze[], b: readonly Snooze[]): boolean {
  return (
    a.length === b.length &&
    a.every((each, i) => each.taskId === b[i]?.taskId && each.at === b[i]?.at)
  );
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
  return dateTimeFormat('en-GB', {
    timeZone: localTimeZone(),
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(at);
}
