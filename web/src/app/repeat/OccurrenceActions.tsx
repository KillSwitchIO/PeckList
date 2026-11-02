// One date of a repeating task, on its own (spec: PL-060): in the task's details, under Repeat,
// "Skip" leaves that date out and "Change just this one" makes it a task of its own, while
// everything else in the details changes the whole series. Opened from a date to come (the
// calendar, Upcoming), it is about that date; otherwise about the task's current one.

import { Box, Button, Typography } from '@mui/material';
import { useSearchParams } from 'react-router';
import { datePart } from '../../core/dates.ts';
import { detachOccurrence, skipOccurrence } from '../../core/occurrences.ts';
import { parseRule } from '../../core/recurrence.ts';
import type { Task } from '../../core/types.ts';
import { formatDay } from '../format.ts';
import { t } from '../i18n/i18n.ts';
import { useToday } from '../hooks/useToday.ts';
import { useApply } from '../store/hooks.ts';
import { useReadOnly } from '../tasks/readOnly.ts';
import { useTaskSelection } from '../tasks/selection.ts';

export function OccurrenceActions({ task }: { task: Task }) {
  const apply = useApply();
  const today = useToday();
  const readOnly = useReadOnly();
  const [params] = useSearchParams();
  const { open } = useTaskSelection();
  const anchor = task.schedule?.start ?? task.due?.at ?? null;
  if (readOnly || task.status !== 'open' || !anchor || !parseRule(task.recurrence)) return null;
  const current = datePart(anchor);
  const picked = params.get('on');
  const date = picked && picked > current ? picked : current;
  const day = formatDay(date, today);
  return (
    <Box sx={{ px: 1, py: 0.5, display: 'grid', gap: 0.5 }}>
      <Typography variant="caption" color="text.secondary">
        {date === current ? t('occurrence.thisOne', { day }) : t('occurrence.toCome', { day })}
      </Typography>
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        <Button
          size="small"
          variant="outlined"
          onClick={() => {
            apply(
              (ctx, ws) => skipOccurrence(ctx, ws, task.id, date),
              t('undo.occurrenceSkipped', { day }),
            );
            // Back to the task itself: the date picked is gone from the series.
            if (date !== current) open(task.id);
          }}
        >
          {t('occurrence.skip', { day })}
        </Button>
        <Button
          size="small"
          variant="outlined"
          onClick={() => {
            let made: string | null = null;
            apply(
              (ctx, ws) => {
                const detached = detachOccurrence(ctx, ws, task.id, date);
                made = detached?.task.id ?? null;
                return detached?.workspace ?? ws;
              },
              t('undo.occurrenceDetached', { day }),
            );
            if (made) open(made);
          }}
        >
          {t('occurrence.changeOne')}
        </Button>
      </Box>
    </Box>
  );
}
