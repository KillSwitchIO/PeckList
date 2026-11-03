// A repeating task's date to come in a list of days (Upcoming, Next 7 days, a picked day): shown
// lighter, with the repeat mark by its title. Its box and its swipe act on that date (Ben,
// 2026-11-02): Complete and Won't do close just that date (a closed task of its own, and the
// series skips it), Delete and Date ask just this date or every date, Move and Pin are the
// series'. It cannot be dragged; opening it opens the series on that date.

import RepeatRounded from '@mui/icons-material/RepeatRounded';
import { Box, ButtonBase, IconButton, Typography, useTheme } from '@mui/material';
import { useState } from 'react';
import { useLocation } from 'react-router';
import { getEntity } from '../../core/collections.ts';
import { timePart } from '../../core/dates.ts';
import { closeOccurrence, type Occurrence } from '../../core/occurrences.ts';
import { isPinned, setPinned } from '../../core/tasks.ts';
import type { Task } from '../../core/types.ts';
import { formatDay, formatTime } from '../format.ts';
import { useToday } from '../hooks/useToday.ts';
import { t } from '../i18n/i18n.ts';
import { useApply, useWorkspace } from '../store/hooks.ts';
import { birdColors } from '../tasks/birdColors.ts';
import { bumpClosedCount, playCheckOff } from '../tasks/checkOff.ts';
import { TaskDateSheet } from '../tasks/DateButton.tsx';
import { useCanEditTask } from '../tasks/readOnly.ts';
import { useTaskSelection } from '../tasks/selection.ts';
import { SwipeRow } from '../tasks/SwipeRow.tsx';
import { MoveToListDialog } from '../tasks/TaskMenu.tsx';
import { deleteAsking } from './repeatActions.ts';

const PRIORITY_KEY = { 0: 'none', 1: 'low', 2: 'medium', 3: 'high' } as const;

export function OccurrenceRow({ task, occurrence }: { task: Task; occurrence: Occurrence }) {
  const { open } = useTaskSelection();
  const today = useToday();
  const theme = useTheme();
  const apply = useApply();
  const workspace = useWorkspace();
  const { pathname } = useLocation();
  const series = getEntity(workspace, 'tasks', occurrence.taskId);
  const canEdit = useCanEditTask(series ?? task);
  const [dateAnchor, setDateAnchor] = useState<HTMLElement | null>(null);
  const [moving, setMoving] = useState(false);
  if (!series) return null;
  const title = task.title || t('task.untitled');
  const day = formatDay(occurrence.date, today);
  const time = task.schedule && !task.schedule.allDay ? timePart(task.schedule.start) : null;
  const ring = theme.pecklist.priority[PRIORITY_KEY[task.priority]].fill;
  const close = (status: 'done' | 'wontdo') =>
    apply(
      (ctx, ws) => closeOccurrence(ctx, ws, series.id, occurrence.date, status),
      status === 'done' ? t('undo.occurrenceCompleted', { day }) : t('undo.wontDo'),
    );

  return (
    <>
      <SwipeRow
        enabled={canEdit}
        done={false}
        pinned={isPinned(series)}
        run={(action, anchor) => {
          if (action === 'complete') close('done');
          else if (action === 'wontDo') close('wontdo');
          else if (action === 'date') setDateAnchor(anchor);
          else if (action === 'move') setMoving(true);
          else if (action === 'pin') {
            apply(
              (ctx, ws) => setPinned(ctx, ws, series.id, !isPinned(series)),
              isPinned(series) ? t('undo.unpinned') : t('undo.pinned'),
            );
          } else void deleteAsking(apply, series, occurrence.date);
        }}
      >
        <Box
          data-occurrence-row={occurrence.taskId}
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 0.5,
            pl: 0.5,
            pr: 1,
            minHeight: 40,
            borderRadius: 1,
            color: 'text.secondary',
            '&:hover': { bgcolor: 'action.hover' },
          }}
        >
          <IconButton
            size="small"
            role="checkbox"
            aria-checked={false}
            aria-label={t('occurrence.complete', { title, day })}
            disabled={!canEdit}
            data-row-checkbox=""
            onClick={(event) => {
              // The bird as for any task: delivery on Today, a swoop elsewhere.
              const playing = playCheckOff(
                event.currentTarget,
                pathname === '/today' ? 'deliver' : 'swoop',
                birdColors(theme),
              );
              if (!playing) {
                close('done');
                return;
              }
              void playing.then(() => {
                close('done');
                requestAnimationFrame(bumpClosedCount);
              });
            }}
            sx={{ p: 0.75, opacity: 0.75 }}
          >
            <Box
              sx={{
                width: 16,
                height: 16,
                borderRadius: '4px',
                border: `1.5px dashed ${ring}`,
              }}
            />
          </IconButton>
          <ButtonBase
            onClick={() => open(occurrence.taskId, { on: occurrence.date })}
            aria-label={t('occurrence.row', { title, day })}
            sx={{
              flexGrow: 1,
              minWidth: 0,
              justifyContent: 'flex-start',
              gap: 0.75,
              minHeight: 40,
              borderRadius: 1,
              opacity: 0.75,
            }}
          >
            <Typography data-row-title="" noWrap sx={{ minWidth: 0, textAlign: 'left' }}>
              {title}
            </Typography>
            <RepeatRounded sx={{ fontSize: 16, flex: 'none' }} />
            <Box sx={{ flexGrow: 1 }} />
            {time && <Typography variant="caption">{formatTime(time)}</Typography>}
          </ButtonBase>
        </Box>
      </SwipeRow>
      <TaskDateSheet
        task={task}
        anchor={dateAnchor}
        onClose={() => setDateAnchor(null)}
        series={{ task: series, on: occurrence.date }}
      />
      {moving && <MoveToListDialog task={series} onClose={() => setMoving(false)} />}
    </>
  );
}
