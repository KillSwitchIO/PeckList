// A repeating task's date to come in a list of days (Upcoming, Next 7 days, a picked day): shown
// lighter, with the repeat mark where the checkbox would be. It is not a task yet, so it cannot
// be ticked or dragged; opening it opens the series on that date (OccurrenceActions).

import RepeatRounded from '@mui/icons-material/RepeatRounded';
import { ButtonBase, Typography } from '@mui/material';
import { timePart } from '../../core/dates.ts';
import type { Occurrence } from '../../core/occurrences.ts';
import type { Task } from '../../core/types.ts';
import { formatDay, formatTime } from '../format.ts';
import { useToday } from '../hooks/useToday.ts';
import { t } from '../i18n/i18n.ts';
import { useTaskSelection } from '../tasks/selection.ts';

export function OccurrenceRow({ task, occurrence }: { task: Task; occurrence: Occurrence }) {
  const { open } = useTaskSelection();
  const today = useToday();
  const title = task.title || t('task.untitled');
  const time = task.schedule && !task.schedule.allDay ? timePart(task.schedule.start) : null;
  return (
    <ButtonBase
      data-occurrence-row={occurrence.taskId}
      onClick={() => open(occurrence.taskId, { on: occurrence.date })}
      aria-label={t('occurrence.row', { title, day: formatDay(occurrence.date, today) })}
      sx={{
        width: '100%',
        justifyContent: 'flex-start',
        gap: 1,
        px: 1,
        minHeight: 40,
        borderRadius: 1,
        color: 'text.secondary',
        opacity: 0.75,
        '&:hover': { bgcolor: 'action.hover' },
      }}
    >
      <RepeatRounded fontSize="small" sx={{ mx: 0.25 }} />
      <Typography noWrap sx={{ flexGrow: 1, minWidth: 0, textAlign: 'left' }}>
        {title}
      </Typography>
      {time && <Typography variant="caption">{formatTime(time)}</Typography>}
    </ButtonBase>
  );
}
