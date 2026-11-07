import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router';
import { getEntity } from '../../core/collections.ts';
import { addComment, canComment } from '../../core/comments.ts';
import { canClaim, claimTask } from '../../core/sharing.ts';
import { t } from '../i18n/i18n.ts';
import { useApply, useStoreState, useWorkspace } from '../store/hooks.ts';
import { useSyncState } from '../sync/syncContext.ts';

/** The thumbs up a notification's button leaves on a comment (R-FB-106). */
export const THUMBS_UP = '👍';

/**
 * What a notification's button asks of the task it opens (R-FB-106, R-FB-107): `like=1` answers
 * the comment with a thumbs up, `dibs=1` calls dibs on a group's task. Done once, as soon as the
 * task is here, and the address forgets it, so Back or a reload does not do it again.
 *
 * The address forgets at once, but BrowserRouter hands the news to React as a transition, later
 * than the store's own update. Until it lands this still reads the button from the old address, so
 * `handled` is what makes it once: without it, every comment changes the workspace, which runs this
 * again, until React gives up with "Maximum update depth exceeded".
 */
export function NotificationLinks() {
  const [params, setParams] = useSearchParams();
  const workspace = useWorkspace();
  const apply = useApply();
  const me = useStoreState((state) => state.context().userId);
  const syncNow = useSyncState((state) => state.syncNow);
  const taskId = params.get('task');
  const like = params.get('like') === '1';
  const dibs = params.get('dibs') === '1';
  const task = taskId ? getEntity(workspace, 'tasks', taskId) : undefined;
  const handled = useRef(false);

  useEffect(() => {
    if (!like && !dibs) {
      handled.current = false;
      return;
    }
    if (!task || handled.current) return;
    handled.current = true;
    if (like && canComment(workspace, me, task)) {
      apply(
        (ctx, ws) => addComment(ctx, ws, task.id, THUMBS_UP).workspace,
        t('notifications.liked'),
      );
    }
    if (dibs && canClaim(workspace, me, task)) {
      apply((ctx, ws) => claimTask(ctx, ws, task.id), t('notifications.calledDibs'));
    }
    void syncNow();
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete('like');
        next.delete('dibs');
        return next;
      },
      { replace: true },
    );
  }, [task, like, dibs, workspace, me, apply, syncNow, setParams]);
  return null;
}
