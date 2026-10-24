import ExpandLessRounded from '@mui/icons-material/ExpandLessRounded';
import { Box, ButtonBase, Drawer, Typography } from '@mui/material';
import { useState } from 'react';
import { commentsOf } from '../../core/comments.ts';
import { localDateTimeOf, localTimeZone } from '../../core/dates.ts';
import { lastChangedAt } from '../../core/tasks.ts';
import type { Task } from '../../core/types.ts';
import { formatWhen } from '../format.ts';
import { useToday } from '../hooks/useToday.ts';
import { t } from '../i18n/i18n.ts';
import { useWorkspace } from '../store/hooks.ts';
import { Comments } from './Comments.tsx';

/** "Created Thu, Oct 22 9:00 AM · Updated Today 2:15 PM" (spec: PL-088). */
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
      sx={{ m: 0 }}
    >
      {t('task.createdWhen', { when: created })}
      {updated !== created && ` · ${t('task.updatedWhen', { when: updated })}`}
    </Typography>
  );
}

/**
 * On phones the details keep to the title, dates and notes: when it was made and changed, and the
 * comments, wait behind a bar at the bottom that slides a panel up, like TickTick (spec: PL-088).
 */
export function PhoneTaskMore({ task }: { task: Task }) {
  const workspace = useWorkspace();
  const [open, setOpen] = useState(false);
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
        }}
      >
        <ExpandLessRounded fontSize="small" />
        <Box component="span" sx={{ flexGrow: 1, textAlign: 'left' }}>
          {label}
        </Box>
      </ButtonBase>
      <Drawer
        anchor="bottom"
        open={open}
        onClose={() => setOpen(false)}
        slotProps={{
          paper: {
            role: 'dialog',
            'aria-label': t('task.moreTitle'),
            sx: { maxHeight: '75dvh', borderTopLeftRadius: 16, borderTopRightRadius: 16, p: 2 },
          },
        }}
      >
        <Box
          aria-hidden
          sx={{ width: 36, height: 4, borderRadius: 2, bgcolor: 'divider', mx: 'auto', mb: 1.5 }}
        />
        <TaskDates task={task} />
        <Box sx={{ mt: 2 }}>
          <Comments task={task} />
        </Box>
      </Drawer>
    </>
  );
}
