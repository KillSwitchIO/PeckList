import ChecklistRounded from '@mui/icons-material/ChecklistRounded';
import ChevronRightRounded from '@mui/icons-material/ChevronRightRounded';
import SubdirectoryArrowRightRounded from '@mui/icons-material/SubdirectoryArrowRightRounded';
import { Box, ButtonBase, IconButton, Typography, useMediaQuery, useTheme } from '@mui/material';
import { useState } from 'react';
import { getEntity } from '../../core/collections.ts';
import { subtaskProgress } from '../../core/queries.ts';
import { assigneesOf, describePrincipal } from '../../core/sharing.ts';
import { tagsOfTask } from '../../core/tags.ts';
import { toggleTaskDone } from '../../core/tasks.ts';
import type { Priority, Task } from '../../core/types.ts';
import { useLongPress } from '../hooks/useLongPress.ts';
import { t } from '../i18n/i18n.ts';
import { AvatarStack } from '../friends/AvatarStack.tsx';
import { listName } from '../lists/listName.ts';
import { useApply, useWorkspace } from '../store/hooks.ts';
import { TaskReadOnly, useCanEditTask, useReadOnly } from './readOnly.ts';
import { useTaskDrag } from './drag/dragContext.ts';
import { keyboardMove } from '../../core/taskDrag.ts';
import { TagChips } from '../tags/TagChip.tsx';
import { useTaskSelection } from './selection.ts';
import { CHECK_PATH, CROSS_PATH } from './closedMarks.ts';
import { DateButton } from './DateButton.tsx';
import { TaskMenu, type TaskMenuAnchor } from './TaskMenu.tsx';

const PRIORITY_KEY = { 0: 'none', 1: 'low', 2: 'medium', 3: 'high' } as const satisfies Record<
  Priority,
  string
>;

/** Rounded-square checkbox; its border carries the priority color. */
export function PriorityCheckbox({ task }: { task: Task }) {
  const theme = useTheme();
  const apply = useApply();
  const readOnly = useReadOnly();
  const ring = theme.punchlist.priority[PRIORITY_KEY[task.priority]].fill;
  const done = task.status !== 'open';
  const title = task.title || t('task.untitled');
  return (
    <IconButton
      size="small"
      role="checkbox"
      aria-checked={done}
      aria-label={done ? t('task.reopen', { title }) : t('task.complete', { title })}
      {...(task.status === 'wontdo' ? { title: t('task.markedWontDo') } : {})}
      disabled={readOnly}
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
        {done && (
          <Box component="svg" viewBox="0 0 24 24" aria-hidden sx={{ width: 14, height: 14 }}>
            <path
              d={task.status === 'done' ? CHECK_PATH : CROSS_PATH}
              fill="none"
              stroke="currentColor"
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Box>
        )}
      </Box>
    </IconButton>
  );
}

/** Fixed date column, right-aligned: dates sit flush right and list names line up in every view. */
const DATE_COLUMN = '10rem';

/** Indent per subtask level in list trees. */
const INDENT = 24;

export interface RowExpander {
  open: boolean;
  onToggle: () => void;
}

export function TaskRow({
  task,
  showList = false,
  showParent = true,
  depth = 0,
  expander,
  draggable = false,
}: {
  task: Task;
  /** Show the task's list (views that mix lists) */
  showList?: boolean;
  /** Name the parent of a subtask (off for rows nested under that parent) */
  showParent?: boolean;
  /** Subtask level in a list tree (indents the row) */
  depth?: number;
  /** Chevron to show or hide this task's subtasks */
  expander?: RowExpander;
  /** In a list that can be reordered: drag it, or Alt+arrows from the keyboard */
  draggable?: boolean;
}) {
  const workspace = useWorkspace();
  const theme = useTheme();
  const { selectedId, open } = useTaskSelection();
  const list = getEntity(workspace, 'lists', task.listId);
  const parent = task.parentId ? getEntity(workspace, 'tasks', task.parentId) : undefined;
  const progress = subtaskProgress(workspace, task.id);
  const tags = tagsOfTask(workspace, task);
  const assigned = assigneesOf(task).map((principal) => describePrincipal(workspace, principal));
  const isPhone = useMediaQuery(theme.breakpoints.down('sm'), { noSsr: true });
  const done = task.status !== 'open';
  const title = task.title || t('task.untitled');
  const selected = selectedId === task.id;
  const [menu, setMenu] = useState<TaskMenuAnchor | null>(null);
  const longPress = useLongPress((position) => setMenu({ position }));
  const canEdit = useCanEditTask(task);
  const apply = useApply();
  const drag = useTaskDrag();
  const dragging = draggable && canEdit && drag !== null;
  const gesture = dragging ? drag.gesture(task, depth, (position) => setMenu({ position })) : null;
  const dimmed = drag?.dimmed.has(task.id) ?? false;
  // Keyboard moves: Alt+Up/Down among its siblings, Alt+Right/Left to nest and outdent.
  const keyMove = (key: string): boolean => {
    const move = keyboardMove(key);
    if (!move) return false;
    apply((ctx, ws) => move(ctx, ws, task.id), t('undo.moved'));
    return true;
  };

  // Closed tasks show when they were completed instead of when they start.

  return (
    <TaskReadOnly value={!canEdit}>
      <Box
        onContextMenu={(event) => {
          event.preventDefault();
          setMenu({ position: { top: event.clientY, left: event.clientX } });
        }}
        // A draggable row's own gesture covers the touch long-press (menu, or drag on moving).
        {...(gesture ? {} : longPress)}
        sx={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          minHeight: 40,
          pl: `${4 + depth * INDENT}px`,
          opacity: dimmed ? 0.4 : 1,
          borderBottom: 1,
          borderColor: 'divider',
          bgcolor: selected ? 'action.selected' : 'transparent',
          '&:hover': { bgcolor: selected ? 'action.selected' : 'action.hover' },
          // List color as a thin stripe on the left edge (the Mess Drawer has no color).
          '&::before': {
            content: '""',
            position: 'absolute',
            left: 0,
            top: 4,
            bottom: 4,
            width: 3,
            borderRadius: 2,
            bgcolor: list && !list.isInbox ? list.color : 'transparent',
          },
        }}
      >
        {expander && (
          // Sits just left of the checkbox: in the page gutter for top-level tasks.
          <IconButton
            size="small"
            aria-expanded={expander.open}
            aria-label={
              expander.open ? t('task.hideSubtasks', { title }) : t('task.showSubtasks', { title })
            }
            onClick={expander.onToggle}
            sx={{
              position: 'absolute',
              left: depth * INDENT - 20,
              top: '50%',
              transform: 'translateY(-50%)',
              p: 0.25,
              color: 'text.secondary',
            }}
          >
            <ChevronRightRounded
              sx={{
                fontSize: 18,
                transform: expander.open ? 'rotate(90deg)' : 'none',
                transition: 'transform 120ms',
              }}
            />
          </IconButton>
        )}
        <PriorityCheckbox task={task} />
        <ButtonBase
          onClick={() => open(task.id)}
          {...(gesture ?? {})}
          {...(dragging
            ? {
                onKeyDown: (event: React.KeyboardEvent) => {
                  if (!event.altKey || event.ctrlKey || event.metaKey) return;
                  if (keyMove(event.key)) event.preventDefault();
                },
              }
            : {})}
          aria-label={t('task.open', { title })}
          // J / K (keyboard shortcuts) step through the rows that carry this.
          data-task-row={task.id}
          // No ripple: it spread over the row after the details had opened and read as lag.
          disableRipple
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
          <Box sx={{ flexGrow: 1, minWidth: 0 }}>
            <Typography
              noWrap
              sx={{
                color: done ? 'text.disabled' : 'text.primary',
                // Won't do reads as dropped, not finished.
                textDecoration: task.status === 'wontdo' ? 'line-through' : 'none',
              }}
            >
              {title}
            </Typography>
            {/* Phones have no room beside the title: tags go on a second line. */}
            {isPhone && <TagChips tags={tags} max={3} wrap={false} />}
          </Box>
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
            {!isPhone && <TagChips tags={tags} max={2} wrap={false} />}
            {assigned.length > 0 && (
              <Box
                component="span"
                role="img"
                aria-label={t('assignee.row', {
                  names: assigned.map((each) => each.name).join(', '),
                })}
                title={t('assignee.row', { names: assigned.map((each) => each.name).join(', ') })}
                sx={{ display: 'inline-flex' }}
              >
                <AvatarStack people={assigned} size={18} max={2} />
              </Box>
            )}
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
            {/* A subtask shown away from its parent names it. */}
            {showParent && parent && (
              <Box
                component="span"
                title={t('task.subtaskOf', { title: parent.title || t('task.untitled') })}
                sx={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 0.25,
                  maxWidth: '12rem',
                  color: 'text.secondary',
                }}
              >
                <SubdirectoryArrowRightRounded sx={{ fontSize: 16 }} />
                <Box
                  component="span"
                  sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                >
                  {parent.title || t('task.untitled')}
                </Box>
              </Box>
            )}
            {/* The Mess Drawer is "no list", so its tasks show none. */}
            {showList && list && !list.isInbox && (
              <Box component="span" sx={{ color: 'text.secondary' }}>
                {listName(list)}
              </Box>
            )}
          </Box>
        </ButtonBase>
        <DateButton task={task} width={DATE_COLUMN} />
        <TaskMenu task={task} anchor={menu} onClose={() => setMenu(null)} showOpen />
      </Box>
    </TaskReadOnly>
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
