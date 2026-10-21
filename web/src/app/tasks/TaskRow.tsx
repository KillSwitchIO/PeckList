import CheckRounded from '@mui/icons-material/CheckRounded';
import ChecklistRounded from '@mui/icons-material/ChecklistRounded';
import { Box, ButtonBase, IconButton, Typography, useTheme } from '@mui/material';
import { getEntity } from '../../core/collections.ts';
import { timePart } from '../../core/dates.ts';
import { startState, subtaskProgress } from '../../core/queries.ts';
import { toggleTaskDone } from '../../core/tasks.ts';
import type { Priority, Task } from '../../core/types.ts';
import { formatTime, formatWhen } from '../format.ts';
import { useToday } from '../hooks/useToday.ts';
import { t } from '../i18n/i18n.ts';
import { listName } from '../lists/listName.ts';
import { useApply, useWorkspace } from '../store/hooks.ts';
import { useTaskSelection } from './selection.ts';

const PRIORITY_KEY = { 0: 'none', 1: 'low', 2: 'medium', 3: 'high' } as const satisfies Record<
  Priority,
  string
>;

/** Rounded-square checkbox; its border carries the priority color. */
export function PriorityCheckbox({ task }: { task: Task }) {
  const theme = useTheme();
  const apply = useApply();
  const ring = theme.punchlist.priority[PRIORITY_KEY[task.priority]].fill;
  const done = task.status !== 'open';
  const title = task.title || t('task.untitled');
  return (
    <IconButton
      size="small"
      role="checkbox"
      aria-checked={done}
      aria-label={done ? t('task.reopen', { title }) : t('task.complete', { title })}
      onClick={(event) => {
        event.stopPropagation();
        apply(
          (ctx, ws) => toggleTaskDone(ctx, ws, task.id),
          done ? t('undo.reopened') : t('undo.completed'),
        );
      }}
      sx={{ p: 0.75 }}
    >
      <Box
        sx={{
          width: 16,
          height: 16,
          borderRadius: '4px',
          border: `1.5px solid ${done ? theme.palette.text.disabled : ring}`,
          bgcolor: done ? theme.palette.text.disabled : 'transparent',
          display: 'grid',
          placeItems: 'center',
          color: theme.palette.background.paper,
        }}
      >
        {done && <CheckRounded sx={{ fontSize: 12 }} />}
      </Box>
    </IconButton>
  );
}

/**
 * How the start date reads on the right of a row. In views already grouped by day only the
 * time is shown (nothing for all-day tasks).
 */
export type RowDateFormat = 'full' | 'time';

export function TaskRow({
  task,
  showList = false,
  dateFormat = 'full',
}: {
  task: Task;
  showList?: boolean;
  dateFormat?: RowDateFormat;
}) {
  const workspace = useWorkspace();
  const today = useToday();
  const theme = useTheme();
  const { selectedId, open } = useTaskSelection();
  const list = getEntity(workspace, 'lists', task.listId);
  const progress = subtaskProgress(workspace, task.id);
  const done = task.status !== 'open';
  const title = task.title || t('task.untitled');
  const selected = selectedId === task.id;

  const start = task.schedule?.start;
  const time = start ? timePart(start) : null;
  const dateText = !start
    ? null
    : dateFormat === 'time'
      ? time && formatTime(time)
      : formatWhen(start, today);
  const state = startState(task, today);
  const dateColor = done
    ? 'text.disabled'
    : state === 'overdue'
      ? theme.punchlist.dateState.late
      : theme.punchlist.dateState.dueSoon;

  return (
    <Box
      sx={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        minHeight: 40,
        pl: 0.5,
        borderBottom: 1,
        borderColor: 'divider',
        bgcolor: selected ? 'action.selected' : 'transparent',
        '&:hover': { bgcolor: selected ? 'action.selected' : 'action.hover' },
        // List color as a thin stripe on the left edge.
        '&::before': {
          content: '""',
          position: 'absolute',
          left: 0,
          top: 4,
          bottom: 4,
          width: 3,
          borderRadius: 2,
          bgcolor: list?.color ?? 'transparent',
        },
      }}
    >
      <PriorityCheckbox task={task} />
      <ButtonBase
        onClick={() => open(task.id)}
        aria-label={t('task.open', { title })}
        sx={{
          flexGrow: 1,
          minWidth: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          py: 1,
          pr: 1.5,
          textAlign: 'left',
        }}
      >
        <Typography
          noWrap
          sx={{ flexGrow: 1, minWidth: 0, color: done ? 'text.disabled' : 'text.primary' }}
        >
          {title}
        </Typography>
        <Box
          data-testid="task-meta"
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1.25,
            flexShrink: 0,
            typography: 'body2',
          }}
        >
          {progress.total > 0 && (
            <Box
              component="span"
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 0.25,
                color: 'text.secondary',
              }}
            >
              <ChecklistRounded sx={{ fontSize: 16 }} />
              {t('task.subtasks', { done: progress.done, total: progress.total })}
            </Box>
          )}
          {showList && list && (
            <Box component="span" sx={{ color: 'text.secondary' }}>
              {listName(list)}
            </Box>
          )}
          {dateText && (
            <Box
              component="span"
              data-testid="task-date"
              sx={{ color: dateColor, whiteSpace: 'nowrap' }}
            >
              {dateText}
            </Box>
          )}
        </Box>
      </ButtonBase>
    </Box>
  );
}

export function TaskRows({
  tasks,
  showList,
  dateFormat,
}: {
  tasks: Task[];
  showList?: boolean;
  dateFormat?: RowDateFormat;
}) {
  return (
    <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
      {tasks.map((task) => (
        <li key={task.id}>
          <TaskRow
            task={task}
            {...(showList === undefined ? {} : { showList })}
            {...(dateFormat === undefined ? {} : { dateFormat })}
          />
        </li>
      ))}
    </Box>
  );
}
