import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';
import { snoozeReminder } from '../../core/reminders.ts';
import { setTaskStatus } from '../../core/tasks.ts';
import type { NotificationAction } from '../../ports/notifier.ts';
import { t } from '../i18n/i18n.ts';
import { localClock } from '../reminders/clock.ts';
import { notifier } from '../reminders/notifier.ts';
import { useApply } from '../store/hooks.ts';

/**
 * A tap on one of the Android app's notifications opens what it is about (ADR-0017). A reminder's
 * Complete or Snooze that could not act on the server (offline, standalone, a repeating task)
 * arrives here too, and is done in the app.
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
  return null;
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
