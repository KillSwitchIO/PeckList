import CheckRounded from '@mui/icons-material/CheckRounded';
import ChecklistRounded from '@mui/icons-material/ChecklistRounded';
import { Box, ButtonBase, IconButton, Typography, useTheme } from '@mui/material';
import { getEntity } from '../../core/collections.ts';
import { startState, subtaskProgress } from '../../core/queries.ts';
import { toggleTaskDone } from '../../core/tasks.ts';
import type { Priority, Task } from '../../core/types.ts';
import { formatWhen } from '../format.ts';
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

/** Fixed date column, right-aligned: dates sit flush right and list names line up in every view. */
const DATE_COLUMN = '10rem';

export function TaskRow({ task, showList = false }: { task: Task; showList?: boolean }) {
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
  const dateText = start ? formatWhen(start, today) : null;
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
          {/* The Mess Drawer is "no list", so its tasks show none. */}
          {showList && list && !list.isInbox && (
            <Box component="span" sx={{ color: 'text.secondary' }}>
              {listName(list)}
            </Box>
          )}
          <Box
            component="span"
            data-testid="task-date"
            sx={{
              width: DATE_COLUMN,
              flexShrink: 0,
              textAlign: 'right',
              color: dateColor,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {dateText}
          </Box>
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
