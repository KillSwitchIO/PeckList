// The date on the right of a task row. Clicking it edits that date in place (the start date, the
// due date when that is what shows, or the completion date of a closed task) without opening the
// task. An undated row shows a faint calendar on hover for adding a start date.

import { Box, ButtonBase } from '@mui/material';
import { useState, type MouseEvent } from 'react';
import { localDateTimeOf, localTimeZone } from '../../core/dates.ts';
import { setCompletedAt, updateTask } from '../../core/tasks.ts';
import type { Task } from '../../core/types.ts';
import { DatePickerPanel } from '../dates/DatePickerPanel.tsx';
import { fromDateValue, toDateValue, type DateValue } from '../dates/dateValue.ts';
import { useToday } from '../hooks/useToday.ts';
import { t } from '../i18n/i18n.ts';
import { CalendarIcon, DueIcon } from '../icons/icons.tsx';
import { useApply } from '../store/hooks.ts';
import { completionInstant } from './completion.ts';
import { ProgressRing } from './ProgressRing.tsx';
import { PropertySheet } from './PropertyRow.tsx';
import { useRowDate } from './rowDate.ts';

type Which = 'start' | 'due' | 'completed';

export function DateButton({
  task,
  width,
  testId = 'task-date',
}: {
  task: Task;
  width: string;
  testId?: string;
}) {
  const apply = useApply();
  const today = useToday();
  const { text, color, completedDay, showsDue, due } = useRowDate(task);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const zone = localTimeZone();
  const which: Which = completedDay ? 'completed' : showsDue ? 'due' : 'start';
  const label =
    which === 'completed'
      ? t('task.completedDate')
      : which === 'due'
        ? t('task.due')
        : t('task.date');
  const value =
    which === 'completed'
      ? task.completedAt
        ? toDateValue(localDateTimeOf(task.completedAt, zone))
        : null
      : which === 'due'
        ? toDateValue(task.due?.at)
        : toDateValue(task.schedule?.start, task.schedule?.end);

  const save = (next: DateValue | null) => {
    setAnchor(null);
    if (which === 'completed') {
      apply(
        (ctx, ws) =>
          setCompletedAt(ctx, ws, task.id, next ? completionInstant(task, next, zone) : null),
        next ? undefined : t('undo.reopened'),
      );
    } else if (which === 'due') {
      apply((ctx, ws) =>
        updateTask(ctx, ws, task.id, {
          due: next
            ? { at: fromDateValue(next), allDay: next.time === null, timeZone: zone }
            : null,
        }),
      );
    } else {
      apply((ctx, ws) =>
        updateTask(ctx, ws, task.id, {
          schedule: next
            ? {
                start: fromDateValue(next),
                end: next.end ? fromDateValue(next.end) : null,
                allDay: next.time === null,
                timeZone: zone,
              }
            : null,
        }),
      );
    }
  };

  return (
    <>
      <ButtonBase
        data-testid={testId}
        aria-label={text ? t('task.editDate', { what: label, date: text }) : t('date.addDate')}
        aria-haspopup="dialog"
        {...(completedDay ? { title: t('task.completedOn', { date: text ?? '' }) } : {})}
        // Only the date: the row behind it stays as it is.
        onClick={(event: MouseEvent<HTMLElement>) => {
          event.stopPropagation();
          setAnchor(event.currentTarget);
        }}
        onContextMenu={(event) => event.stopPropagation()}
        sx={{
          width,
          flexShrink: 0,
          alignSelf: 'stretch',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: 0.75,
          pr: 1.5,
          typography: 'body2',
          color,
          borderRadius: 1,
          '&:hover .add-date': { opacity: 1 },
          '&:focus-visible .add-date': { opacity: 1 },
        }}
      >
        {task.progress > 0 && task.status === 'open' && <ProgressRing value={task.progress} />}
        {due && !completedDay && (
          <Box
            component="span"
            role="img"
            aria-label={t('task.dueOn', { date: due })}
            title={t('task.dueOn', { date: due })}
            sx={{ display: 'inline-flex', flexShrink: 0, opacity: showsDue ? 1 : 0.7 }}
          >
            <DueIcon sx={{ fontSize: 15 }} />
          </Box>
        )}
        {text ? (
          <Box
            component="span"
            sx={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
          >
            {text}
          </Box>
        ) : (
          <CalendarIcon
            className="add-date"
            sx={{ fontSize: 16, color: 'text.disabled', opacity: 0, transition: 'opacity 120ms' }}
          />
        )}
      </ButtonBase>
      <PropertySheet label={label} anchor={anchor} onClose={() => setAnchor(null)}>
        {anchor && (
          <DatePickerPanel
            value={value}
            today={today}
            allowRange={which === 'start'}
            onApply={save}
            onCancel={() => setAnchor(null)}
          />
        )}
      </PropertySheet>
    </>
  );
}
