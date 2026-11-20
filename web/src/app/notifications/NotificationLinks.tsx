import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { getEntity, isLive } from '../../core/collections.ts';
import { addComment, canComment } from '../../core/comments.ts';
import { canClaim, canEditTask, claimTask } from '../../core/sharing.ts';
import { localTimeZone } from '../../core/dates.ts';
import { occurrenceGone } from '../../core/reminders.ts';
import { setTaskStatus } from '../../core/tasks.ts';
import { t } from '../i18n/i18n.ts';
import { useApply, useStoreState, useWorkspace } from '../store/hooks.ts';
import { useSyncState } from '../sync/syncContext.ts';
import {
  onNotificationAction,
  queueNotificationAction,
  takeNotificationAction,
  takeQueuedNotificationActions,
  type PendingNotificationAction,
} from './notificationActions.ts';

/** The thumbs up a notification's button leaves on a comment (R-FB-106). */
export const THUMBS_UP = '👍';

/**
 * What a notification's button asks of a task (R-FB-106, R-FB-107): a thumbs up on its comment,
 * dibs on a group's task, or a reminder's Complete (Ben, 2026-11-20). Done once, as soon as the task is here, and only for a real press
 * (notificationActions.ts): the service worker's one-time `?act=` name, or the Android app's
 * press. The task acted on is the press's own, never the address's `task`, which only decides what
 * opens. `like=1` and `dibs=1` in an address do nothing any more (a link from another site could
 * carry them: security review 2026-11-19); they, and `act`, leave the address at once, so Back or
 * a reload does nothing again.
 */
export function NotificationLinks() {
  const [params, setParams] = useSearchParams();
  const workspace = useWorkspace();
  const apply = useApply();
  const me = useStoreState((state) => state.context().userId);
  const syncNow = useSyncState((state) => state.syncNow);
  const like = params.get('like');
  const dibs = params.get('dibs');
  const act = params.get('act');
  // Presses whose task has not arrived yet (a phone opening before the first sync brings it).
  const waiting = useRef<PendingNotificationAction[]>([]);
  const [queued, setQueued] = useState(0);

  // The address: an act name is taken (once, whoever deletes it first), the rest only dropped.
  // BrowserRouter hands the new address over as a transition, so this can run again with the old
  // one; taking the same name twice finds nothing the second time.
  useEffect(() => {
    if (like === null && dibs === null && act === null) return;
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete('like');
        next.delete('dibs');
        next.delete('act');
        return next;
      },
      { replace: true },
    );
    if (act) {
      void takeNotificationAction(act).then((press) => {
        if (press) queueNotificationAction(press);
      });
    }
  }, [like, dibs, act, setParams]);

  useEffect(() => onNotificationAction(() => setQueued((count) => count + 1)), []);

  useEffect(() => {
    waiting.current.push(...takeQueuedNotificationActions());
    const ready = waiting.current.filter((each) => getEntity(workspace, 'tasks', each.taskId));
    if (ready.length === 0) return;
    // Off the list before acting, so a render the act causes never does it again.
    waiting.current = waiting.current.filter((each) => !ready.includes(each));
    for (const { kind, taskId, first } of ready) {
      const task = getEntity(workspace, 'tasks', taskId)!;
      if (kind === 'like' && canComment(workspace, me, task)) {
        apply(
          (ctx, ws) => addComment(ctx, ws, task.id, THUMBS_UP).workspace,
          t('notifications.liked'),
        );
      }
      if (kind === 'dibs' && canClaim(workspace, me, task)) {
        apply((ctx, ws) => claimTask(ctx, ws, task.id), t('notifications.calledDibs'));
      }
      // A reminder's Complete: as the task's own checkbox, so a repeating task moves to its next
      // date. Only an open task, and only one I may change; never toggled back open. A reminder of
      // an occurrence already gone (ticked on the phone, then pressed on a notice left up here)
      // does nothing, or it would close the next date without a word (Dev 2's review), as the
      // server does for the Android app's Complete.
      if (
        kind === 'complete' &&
        isLive(task) &&
        task.status === 'open' &&
        canEditTask(workspace, me, task) &&
        !occurrenceGone(task, first ?? 0, localTimeZone())
      ) {
        apply((ctx, ws) => setTaskStatus(ctx, ws, task.id, 'done'), t('undo.completed'));
      }
    }
    void syncNow();
  }, [queued, workspace, me, apply, syncNow]);
  return null;
}
