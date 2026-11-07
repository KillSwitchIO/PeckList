import ExpandLessRounded from '@mui/icons-material/ExpandLessRounded';
import { Box, ButtonBase, Typography } from '@mui/material';
import { useEffect, useRef } from 'react';
import { commentsOf } from '../../core/comments.ts';
import { localDateTimeOf, localTimeZone } from '../../core/dates.ts';
import { lastChangedAt } from '../../core/tasks.ts';
import type { Task } from '../../core/types.ts';
import { formatWhen } from '../format.ts';
import { useToday } from '../hooks/useToday.ts';
import { t } from '../i18n/i18n.ts';
import { useWorkspace } from '../store/hooks.ts';
import { Comments } from './Comments.tsx';
import { BottomSheet } from '../layout/BottomSheet.tsx';
import { TaskHistory } from './TaskHistory.tsx';
import type { PullUp } from './usePullUp.ts';

/**
 * "Created Thu, Oct 22 9:00 AM" at the left and "Updated Today 2:15 PM" at the right (spec:
 * PL-088), with a little room at either end.
 */
export function TaskDates({ task }: { task: Task }) {
  const today = useToday();
  const zone = localTimeZone();
  const when = (iso: string) => formatWhen(localDateTimeOf(iso, zone), today);
  const created = when(task.createdAt);
  const updated = when(lastChangedAt(task));
  return (
    <Typography
      variant="caption"
      color="text.disabled"
      component="p"
      data-testid="task-dates"
      sx={{ m: 0, px: 1, display: 'flex', justifyContent: 'space-between', gap: 2 }}
    >
      <span>{t('task.createdWhen', { when: created })}</span>
      {updated !== created && <span>{t('task.updatedWhen', { when: updated })}</span>}
    </Typography>
  );
}

/**
 * On phones the details keep to the title, dates and notes: when it was made and changed, the
 * comments and the history (R-FB-105) wait behind a bar at the bottom that slides a panel up,
 * like TickTick (spec: PL-088). A tap opens it, and pulling up on the bar brings it up with the
 * finger (R-FB-109).
 */
export function PhoneTaskMore({
  task,
  open,
  setOpen,
  pull,
}: {
  task: Task;
  open: boolean;
  setOpen: (open: boolean) => void;
  pull: PullUp;
}) {
  const workspace = useWorkspace();
  const bar = useRef<HTMLButtonElement | null>(null);
  const { attach } = pull;
  useEffect(() => {
    if (bar.current) return attach(bar.current, () => true);
  }, [attach]);
  const comments = commentsOf(workspace, task.id).length;
  const label =
    comments === 0
      ? t('task.moreNoComments')
      : comments === 1
        ? t('task.moreOneComment')
        : t('task.moreComments', { count: comments });
  return (
    <>
      <ButtonBase
        ref={bar}
        onClick={() => setOpen(true)}
        aria-label={label}
        aria-haspopup="dialog"
        sx={{
          display: 'flex',
          gap: 1,
          px: 2,
          py: 1,
          borderTop: 1,
          borderColor: 'divider',
          justifyContent: 'flex-start',
          typography: 'body2',
          color: 'text.secondary',
          flexShrink: 0,
          // It never scrolls, so the browser must not start a scroll that would make a slow pull step.
          touchAction: 'none',
        }}
      >
        <ExpandLessRounded fontSize="small" />
        <Box component="span" sx={{ flexGrow: 1, textAlign: 'left' }}>
          {label}
        </Box>
      </ButtonBase>
      <BottomSheet
        open={open || pull.showing}
        onClose={() => setOpen(false)}
        label={t('task.moreTitle')}
        pull={pull}
        // As tall as the task sheet it opens over.
        paperSx={{ height: '92dvh', px: 2, pb: 'calc(16px + env(safe-area-inset-bottom))' }}
      >
        <Box sx={{ mt: 1 }}>
          <TaskDates task={task} />
        </Box>
        <Box sx={{ mt: 2 }}>
          <Comments task={task} />
        </Box>
        <Box sx={{ mt: 2 }}>
          <TaskHistory task={task} />
        </Box>
      </BottomSheet>
    </>
  );
}
