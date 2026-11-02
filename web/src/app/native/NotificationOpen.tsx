import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';
import { snoozeReminder } from '../../core/reminders.ts';
import { setCompletedAt, setTaskStatus } from '../../core/tasks.ts';
import type { HeldPress } from '../../ports/nativeShell.ts';
import type { NotificationAction } from '../../ports/notifier.ts';
import { t } from '../i18n/i18n.ts';
import { localClock } from '../reminders/clock.ts';
import { notifier } from '../reminders/notifier.ts';
import { useApply, useStoreState } from '../store/hooks.ts';
import { HELD_API, nativeShell } from './shell.ts';

/**
 * A tap on one of the Android app's notifications opens what it is about (ADR-0017). A reminder's
 * Complete or Snooze never opens the app: on a server it acts there, and otherwise the shell holds
 * it (api 7) for the app to finish here the next time it runs or comes back to the screen. Buttons
 * on notifications an older shell showed still open the app, and finish here too.
 */
export function NotificationOpen() {
  const navigate = useNavigate();
  const apply = useApply();
  const act = useRef(apply);
  useEffect(() => {
    act.current = apply;
  });
  useEffect(
    () =>
      notifier().onOpen?.((url, action) => {
        void navigate(url);
        if (action) finish(act.current, action);
      }),
    [navigate],
  );
  useHeldPresses(act);
  return null;
}

/** Takes the presses the shell held, once the tasks are loaded, and whenever more arrive. */
function useHeldPresses(act: { current: ReturnType<typeof useApply> }) {
  const ready = useStoreState((state) => state.workspace !== null);
  useEffect(() => {
    const shell = nativeShell();
    if (!ready || !shell) return;
    let live = true;
    const stops: (() => void)[] = [];
    // Taken presses are done even if this unmounts meanwhile: the shell has let go of them.
    const take = () =>
      void shell.held().then(
        (presses) => presses.forEach((press) => finishHeld(act.current, press)),
        () => undefined,
      );
    void shell.info().then(
      ({ api }) => {
        if (!live || api < HELD_API) return;
        take();
        stops.push(shell.onHeld(take));
        const visible = () => {
          if (document.visibilityState === 'visible') take();
        };
        document.addEventListener('visibilitychange', visible);
        stops.push(() => document.removeEventListener('visibilitychange', visible));
      },
      () => undefined,
    );
    return () => {
      live = false;
      stops.forEach((stop) => stop());
    };
  }, [ready, act]);
}

function finish(
  apply: ReturnType<typeof useApply>,
  { action, taskId, minutes }: NotificationAction,
) {
  if (action === 'complete') {
    apply(
      (ctx, ws) =>
        ws.entities.tasks.some((task) => task.id === taskId && task.status === 'open')
          ? setTaskStatus(ctx, ws, taskId, 'done')
          : ws,
      t('reminder.completed'),
    );
    return;
  }
  const now = Date.now();
  apply(
    (ctx, ws) =>
      snoozeReminder(ctx, ws, taskId, localClock(now + minutes * 60_000), localClock(now)),
    t('reminder.snoozed', { minutes }),
  );
}

/**
 * A held press, as of when it was pressed: completed on that day (a repeating task counts its
 * next date from it). A snooze whose time has passed is left: the phone already rang for it.
 */
function finishHeld(
  apply: ReturnType<typeof useApply>,
  { action, taskId, minutes, at }: HeldPress,
) {
  if (action === 'complete') {
    apply(
      (ctx, ws) =>
        ws.entities.tasks.some((task) => task.id === taskId && task.status === 'open')
          ? setCompletedAt(ctx, ws, taskId, new Date(at).toISOString())
          : ws,
      t('reminder.completed'),
    );
    return;
  }
  const until = at + minutes * 60_000;
  const now = Date.now();
  if (until <= now) return;
  apply(
    (ctx, ws) => snoozeReminder(ctx, ws, taskId, localClock(until), localClock(now)),
    t('reminder.snoozed', { minutes }),
  );
}
