import ChecklistRounded from '@mui/icons-material/ChecklistRounded';
import NotificationsNoneRounded from '@mui/icons-material/NotificationsNoneRounded';
import RepeatRounded from '@mui/icons-material/RepeatRounded';
import ChevronRightRounded from '@mui/icons-material/ChevronRightRounded';
import SubdirectoryArrowRightRounded from '@mui/icons-material/SubdirectoryArrowRightRounded';
import { Box, ButtonBase, Checkbox, IconButton, Typography, useTheme } from '@mui/material';
import { useState } from 'react';
import { getEntity } from '../../core/collections.ts';
import { subtaskProgress } from '../../core/queries.ts';
import { assigneesOf, describePrincipal } from '../../core/sharing.ts';
import { tagsOfTask } from '../../core/tags.ts';
import {
  deleteTask,
  isPinned,
  setPinned,
  setTaskStatus,
  toggleTaskDone,
} from '../../core/tasks.ts';
import type { Priority, Task } from '../../core/types.ts';
import { useLongPress } from '../hooks/useLongPress.ts';
import { t } from '../i18n/i18n.ts';
import { AvatarStack } from '../friends/AvatarStack.tsx';
import { listName } from '../lists/listName.ts';
import { useApply, useWorkspace } from '../store/hooks.ts';
import { TaskReadOnly, useCanEditTask, useReadOnly } from './readOnly.ts';
import { useTaskDrag } from './drag/dragContext.ts';
import { useTwoLineRows } from '../layout/rowLayout.ts';
import { keyboardMove } from '../../core/taskDrag.ts';
import { TagChips } from '../tags/TagChip.tsx';
import { useTaskSelection } from './selection.ts';
import { CHECK_PATH, CROSS_PATH } from './closedMarks.ts';
import { DateButton, TaskDateSheet } from './DateButton.tsx';
import { SwipeRow } from './SwipeRow.tsx';
import { useRowDate } from './rowDate.ts';
import { MoveToListDialog, TaskMenu, type TaskMenuAnchor } from './TaskMenu.tsx';

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

/** Picking rows for a bulk change: the row toggles instead of opening. */
export interface RowSelection {
  selected: boolean;
  onToggle: () => void;
}

export function TaskRow({
  task,
  showList = false,
  showParent = true,
  depth = 0,
  expander,
  draggable = false,
  dueFirst = false,
  select,
  onHold,
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
  /** Show (and edit) the due date on the right even when the task has a start (Due dates view) */
  dueFirst?: boolean;
  /** Selecting rows: a checkbox replaces the priority one, and the row toggles */
  select?: RowSelection;
  /** A touch hold does this instead of opening the menu (starting a selection) */
  onHold?: () => void;
}) {
  const workspace = useWorkspace();
  const { selectedId, open } = useTaskSelection();
  const list = getEntity(workspace, 'lists', task.listId);
  const parent = task.parentId ? getEntity(workspace, 'tasks', task.parentId) : undefined;
  const progress = subtaskProgress(workspace, task.id);
  const tags = tagsOfTask(workspace, task);
  const assigned = assigneesOf(task).map((principal) => describePrincipal(workspace, principal));
  // Two lines on phones and in narrow list columns (beside the details panel).
  const twoLine = useTwoLineRows();
  const { text: dateText } = useRowDate(task, dueFirst);
  const done = task.status !== 'open';
  const title = task.title || t('task.untitled');
  const selected = selectedId === task.id;
  const [menu, setMenu] = useState<TaskMenuAnchor | null>(null);
  // A left swipe's Date and Move.
  const [swipeDate, setSwipeDate] = useState<HTMLElement | null>(null);
  const [moving, setMoving] = useState(false);
  const longPress = useLongPress((position) => (onHold ? onHold() : setMenu({ position })));
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

  // Who, how far along, whose subtask, which list: beside the title, or under it on phones.
  const details = (
    <>
      {task.status === 'open' && task.recurrence && (
        <Box
          component="span"
          role="img"
          aria-label={t('repeat.has')}
          title={t('repeat.has')}
          sx={{ display: 'inline-flex', color: 'text.secondary' }}
        >
          <RepeatRounded sx={{ fontSize: 15 }} />
        </Box>
      )}
      {task.status === 'open' && (task.reminders?.length ?? 0) > 0 && (
        <Box
          component="span"
          role="img"
          aria-label={t('reminder.has')}
          title={t('reminder.has')}
          sx={{ display: 'inline-flex', color: 'text.secondary' }}
        >
          <NotificationsNoneRounded sx={{ fontSize: 15 }} />
        </Box>
      )}
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
    </>
  );
  const showsList = showList && list && !list.isInbox;
  const hasDetails =
    dateText !== null ||
    task.progress > 0 ||
    tags.length > 0 ||
    assigned.length > 0 ||
    progress.total > 0 ||
    (showParent && parent !== undefined) ||
    showsList;
  const openButton = {
    onClick: () => (select ? select.onToggle() : open(task.id)),
    ...(gesture ?? {}),
    ...(dragging
      ? {
          onKeyDown: (event: React.KeyboardEvent) => {
            if (!event.altKey || event.ctrlKey || event.metaKey) return;
            if (keyMove(event.key)) event.preventDefault();
          },
        }
      : {}),
    'aria-label': t('task.open', { title }),
    // J / K (keyboard shortcuts) step through the rows that carry this.
    'data-task-row': task.id,
    // No ripple: it spread over the row after the details had opened and read as lag.
    disableRipple: true,
  };
  const checkbox = select ? (
    <Checkbox
      size="small"
      checked={select.selected}
      onChange={select.onToggle}
      onClick={(event) => event.stopPropagation()}
      slotProps={{ input: { 'aria-label': t('task.select', { title }) } }}
      sx={{ p: 0.75 }}
    />
  ) : (
    <PriorityCheckbox task={task} />
  );
  const titleText = (
    <Typography
      noWrap={!twoLine}
      sx={{
        color: done ? 'text.disabled' : 'text.primary',
        // Won't do reads as dropped, not finished.
        textDecoration: task.status === 'wontdo' ? 'line-through' : 'none',
        // Phones give the title the whole width and up to two lines.
        ...(twoLine
          ? {
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              overflowWrap: 'anywhere',
            }
          : {}),
      }}
    >
      {title}
    </Typography>
  );

  return (
    <TaskReadOnly value={!canEdit}>
      <SwipeRow
        enabled={canEdit && !select}
        done={done}
        pinned={isPinned(task)}
        run={(action, anchor) => {
          if (action === 'complete') {
            apply(
              (ctx, ws) => setTaskStatus(ctx, ws, task.id, done ? 'open' : 'done'),
              done ? t('undo.reopened') : t('undo.completed'),
            );
          } else if (action === 'date') {
            setSwipeDate(anchor);
          } else if (action === 'move') {
            setMoving(true);
          } else if (action === 'pin') {
            apply(
              (ctx, ws) => setPinned(ctx, ws, task.id, !isPinned(task)),
              isPinned(task) ? t('undo.unpinned') : t('undo.pinned'),
            );
          } else if (action === 'wontDo') {
            apply((ctx, ws) => setTaskStatus(ctx, ws, task.id, 'wontdo'), t('undo.wontDo'));
          } else {
            apply((ctx, ws) => deleteTask(ctx, ws, task.id), t('undo.deleted'));
          }
        }}
      >
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
            alignItems: twoLine ? 'flex-start' : 'center',
            minHeight: 40,
            pl: `${4 + depth * INDENT}px`,
            opacity: dimmed ? 0.4 : 1,
            borderBottom: 1,
            borderColor: 'divider',
            bgcolor: selected || select?.selected ? 'action.selected' : 'transparent',
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
                expander.open
                  ? t('task.hideSubtasks', { title })
                  : t('task.showSubtasks', { title })
              }
              onClick={expander.onToggle}
              sx={{
                position: 'absolute',
                left: depth * INDENT - 20,
                ...(twoLine ? { top: 8 } : { top: '50%', transform: 'translateY(-50%)' }),
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
          {twoLine ? (
            <>
              <Box sx={{ pt: 0.5 }}>{checkbox}</Box>
              <Box sx={{ flexGrow: 1, minWidth: 0, py: 1, pr: 1.5 }}>
                <ButtonBase
                  {...openButton}
                  sx={{ display: 'block', width: '100%', textAlign: 'left' }}
                >
                  {titleText}
                </ButtonBase>
                {/* Phones have no room beside the title: the rest goes on a line under it. */}
                {hasDetails && (
                  <Box
                    data-testid="task-meta"
                    // Tapping the details opens the task too (the title button is the one to focus).
                    onClick={() => (select ? select.onToggle() : open(task.id))}
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      columnGap: 1.25,
                      rowGap: 0.25,
                      mt: 0.25,
                      typography: 'body2',
                      fontSize: '0.8125rem',
                      color: 'text.secondary',
                    }}
                  >
                    {showsList && <Box component="span">{listName(list, workspace)}</Box>}
                    <TagChips tags={tags} max={3} wrap={false} />
                    {details}
                    {/* The date keeps to the right, as on the wide row. */}
                    <Box sx={{ ml: 'auto', display: 'flex' }}>
                      <DateButton task={task} width="auto" compact dueFirst={dueFirst} />
                    </Box>
                  </Box>
                )}
              </Box>
            </>
          ) : (
            <>
              {checkbox}
              <ButtonBase
                {...openButton}
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
                <Box sx={{ flexGrow: 1, minWidth: 0 }}>{titleText}</Box>
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
                  <TagChips tags={tags} max={2} wrap={false} />
                  {details}
                  {/* The Mess Drawer is "no list", so its tasks show none. */}
                  {showsList && (
                    <Box component="span" sx={{ color: 'text.secondary' }}>
                      {listName(list, workspace)}
                    </Box>
                  )}
                </Box>
              </ButtonBase>
              <DateButton task={task} width={DATE_COLUMN} dueFirst={dueFirst} />
            </>
          )}
          <TaskMenu task={task} anchor={menu} onClose={() => setMenu(null)} showOpen />
        </Box>
      </SwipeRow>
      <TaskDateSheet
        task={task}
        anchor={swipeDate}
        onClose={() => setSwipeDate(null)}
        dueFirst={dueFirst}
      />
      {moving && <MoveToListDialog task={task} onClose={() => setMoving(false)} />}
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
