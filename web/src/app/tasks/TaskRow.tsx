import CheckRounded from '@mui/icons-material/CheckRounded';
import FlagRounded from '@mui/icons-material/FlagRounded';
import { Box, ButtonBase, IconButton, Typography, useTheme } from '@mui/material';
import { getEntity } from '../../core/collections.ts';
import { datePart } from '../../core/dates.ts';
import { dateState, subtaskProgress, type DateState } from '../../core/queries.ts';
import { toggleTaskDone } from '../../core/tasks.ts';
import type { Priority, Task } from '../../core/types.ts';
import { formatDay, formatWhen } from '../format.ts';
import { useToday } from '../hooks/useToday.ts';
import { t } from '../i18n/i18n.ts';
import { listName } from '../lists/listName.ts';
import { useApply, useWorkspace } from '../store/hooks.ts';
import { useTaskSelection } from './selection.ts';

const PRIORITY_KEY = { 0: 'none', 1: 'low', 2: 'medium', 3: 'high' } as const satisfies Record<
  Priority,
  string
>;

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
          width: 20,
          height: 20,
          borderRadius: '50%',
          border: `2px solid ${ring}`,
          bgcolor: done ? ring : 'transparent',
          display: 'grid',
          placeItems: 'center',
          color: theme.palette.background.paper,
          transition: 'background-color 150ms',
          '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
        }}
      >
        {done && <CheckRounded sx={{ fontSize: 14 }} />}
      </Box>
    </IconButton>
  );
}

function useDateColor(state: DateState): string {
  const p = useTheme().punchlist;
  if (state === 'late') return p.dateState.late;
  if (state === 'slipped') return p.dateState.slipped;
  if (state === 'dueSoon') return p.dateState.dueSoon;
  return p.textMuted;
}

export function TaskRow({ task, showList = false }: { task: Task; showList?: boolean }) {
  const workspace = useWorkspace();
  const today = useToday();
  const { selectedId, open } = useTaskSelection();
  const dueSoonDays = workspace.entities.settings[0]?.dueSoonDays ?? 2;
  const state = dateState(task, today, dueSoonDays);
  const dateColor = useDateColor(state);
  const list = showList ? getEntity(workspace, 'lists', task.listId) : undefined;
  const progress = subtaskProgress(workspace, task.id);
  const done = task.status !== 'open';
  const title = task.title || t('task.untitled');

  const meta: React.ReactNode[] = [];
  if (task.schedule) {
    meta.push(
      <Box key="when" component="span" sx={{ color: task.due ? undefined : dateColor }}>
        {formatWhen(task.schedule.start, today)}
      </Box>,
    );
  }
  if (task.due) {
    meta.push(
      <Box
        key="due"
        component="span"
        sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25, color: dateColor }}
      >
        <FlagRounded sx={{ fontSize: 14 }} />
        {t('date.dueOn', { date: formatDay(datePart(task.due.at), today) })}
      </Box>,
    );
  }
  // Dates come first so they sit in the same place whether or not the list is shown.
  if (list) {
    meta.push(
      <Box
        key="list"
        component="span"
        sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}
      >
        <Box
          component="span"
          sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: list.color }}
        />
        {listName(list)}
      </Box>,
    );
  }
  if (progress.total > 0) {
    meta.push(
      <span key="subtasks">
        {t('task.subtasks', { done: progress.done, total: progress.total })}
      </span>,
    );
  }

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 0.5,
        borderRadius: 2,
        bgcolor: selectedId === task.id ? 'action.selected' : 'transparent',
        '&:hover': { bgcolor: selectedId === task.id ? 'action.selected' : 'action.hover' },
      }}
    >
      <PriorityCheckbox task={task} />
      <ButtonBase
        onClick={() => open(task.id)}
        aria-label={t('task.open', { title })}
        sx={{
          flexGrow: 1,
          justifyContent: 'flex-start',
          textAlign: 'left',
          py: 0.75,
          pr: 1,
          borderRadius: 2,
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography
            sx={{
              textDecoration: done ? 'line-through' : 'none',
              color: done ? 'text.secondary' : 'text.primary',
              overflowWrap: 'anywhere',
            }}
          >
            {title}
          </Typography>
          {meta.length > 0 && (
            <Typography
              component="div"
              variant="caption"
              sx={{ display: 'flex', flexWrap: 'wrap', columnGap: 1.5, color: 'text.secondary' }}
            >
              {meta}
            </Typography>
          )}
        </Box>
      </ButtonBase>
    </Box>
  );
}

export function TaskRows({ tasks, showList }: { tasks: Task[]; showList?: boolean }) {
  return (
    <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
      {tasks.map((task) => (
        <li key={task.id}>
          <TaskRow task={task} {...(showList === undefined ? {} : { showList })} />
        </li>
      ))}
    </Box>
  );
}
