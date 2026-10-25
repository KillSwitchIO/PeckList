// The date on the right of a task row. Clicking it edits that date in place (the start date, the
// due date when that is what shows, or the completion date of a closed task) without opening the
// task. An undated row shows a faint calendar on hover for adding a start date. Phones put a
// compact one first on the line under the title, and show none for an undated task.

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
import { useReadOnly } from './readOnly.ts';
import { completionInstant } from './completion.ts';
import { ProgressRing } from './ProgressRing.tsx';
import { PropertySheet } from './PropertyRow.tsx';
import { useRowDate } from './rowDate.ts';

type Which = 'start' | 'due' | 'completed';

/** What a row's date edits (start, due, or completion of a closed task), and how to save it. */
function useRowDateEditor(task: Task, dueFirst: boolean) {
  const apply = useApply();
  const zone = localTimeZone();
  const { completedDay, showsDue } = useRowDate(task, dueFirst);
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
  return { which, label, value, save };
}

/** The date picker for a row's date, opened from its date or from a swipe's Date button. */
export function TaskDateSheet({
  task,
  anchor,
  onClose,
  dueFirst = false,
}: {
  task: Task;
  anchor: HTMLElement | null;
  onClose: () => void;
  dueFirst?: boolean;
}) {
  const today = useToday();
  const { which, label, value, save } = useRowDateEditor(task, dueFirst);
  return (
    <PropertySheet label={label} anchor={anchor} onClose={onClose}>
      {anchor && (
        <DatePickerPanel
          value={value}
          today={today}
          allowRange={which === 'start'}
          onApply={(next) => {
            onClose();
            save(next);
          }}
          onCancel={onClose}
        />
      )}
    </PropertySheet>
  );
}

export function DateButton({
  task,
  width,
  testId = 'task-date',
  compact = false,
  dueFirst = false,
}: {
  task: Task;
  width: string;
  testId?: string;
  /** Inline with other details, left-aligned, smaller (phone rows). */
  compact?: boolean;
  /** The due date even when the task has a start (Due dates view). */
  dueFirst?: boolean;
}) {
  const readOnly = useReadOnly();
  const { text, color, completedDay, showsDue, due } = useRowDate(task, dueFirst);
  const { label } = useRowDateEditor(task, dueFirst);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);

  if (compact && !text && !(task.progress > 0 && task.status === 'open')) return null;

  return (
    <>
      <ButtonBase
        data-testid={testId}
        aria-label={text ? t('task.editDate', { what: label, date: text }) : t('date.addDate')}
        aria-haspopup="dialog"
        disabled={readOnly}
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
          justifyContent: compact ? 'flex-start' : 'flex-end',
          gap: compact ? 0.5 : 0.75,
          pr: compact ? 0 : 1.5,
          typography: 'body2',
          ...(compact ? { fontSize: 'inherit', minWidth: 0 } : {}),
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
      <TaskDateSheet
        task={task}
        anchor={anchor}
        onClose={() => setAnchor(null)}
        dueFirst={dueFirst}
      />
    </>
  );
}
