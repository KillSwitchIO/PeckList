import CalendarMonthOutlined from '@mui/icons-material/CalendarMonthOutlined';
import CloseRounded from '@mui/icons-material/CloseRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import FlagOutlined from '@mui/icons-material/FlagOutlined';
import FlagRounded from '@mui/icons-material/FlagRounded';
import MoreHorizRounded from '@mui/icons-material/MoreHorizRounded';
import TaskAltRounded from '@mui/icons-material/TaskAltRounded';
import {
  Box,
  Button,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Toolbar,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import { useState } from 'react';
import { getEntity, isLive } from '../../core/collections.ts';
import { instantOf, localDateTimeOf, localTimeZone } from '../../core/dates.ts';
import { dateState } from '../../core/queries.ts';
import { sectionsOf, visibleLists } from '../../core/lists.ts';
import {
  deleteTask,
  moveTask,
  setCompletedAt,
  setTaskStatus,
  updateTask,
} from '../../core/tasks.ts';
import type { Priority, Task } from '../../core/types.ts';
import { DateProperty } from '../dates/DateProperty.tsx';
import { NotesEditor } from '../editor/NotesEditor.tsx';
import { listName } from '../lists/listName.ts';
import { TagsProperty } from '../tags/TagsProperty.tsx';
import { ParentTrail, SubtaskEditor } from './Subtasks.tsx';
import { TaskMenu, type TaskMenuAnchor } from './TaskMenu.tsx';
import { fromDateValue, toDateValue } from '../dates/dateValue.ts';
import { useToday } from '../hooks/useToday.ts';
import { t } from '../i18n/i18n.ts';
import { useApply, useWorkspace } from '../store/hooks.ts';

const PRIORITIES: Priority[] = [0, 1, 2, 3];
const PRIORITY_KEY = { 0: 'none', 1: 'low', 2: 'medium', 3: 'high' } as const;

/** A text field that edits locally and commits on blur or Enter. */
function CommitField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: string;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [synced, setSynced] = useState(value);
  // Take outside changes (undo, another tab) without an effect.
  if (value !== synced) {
    setSynced(value);
    setDraft(value);
  }
  const commit = () => {
    if (draft !== value) onCommit(draft);
  };
  return (
    <TextField
      label={label}
      value={draft}
      fullWidth
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commit();
        }
      }}
    />
  );
}

function PriorityPicker({ task }: { task: Task }) {
  const apply = useApply();
  const theme = useTheme();
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 0.5 }}>
        {t('task.priority')}
      </Typography>
      <ToggleButtonGroup
        exclusive
        size="small"
        value={task.priority}
        aria-label={t('task.priority')}
        onChange={(_, value: Priority | null) => {
          if (value !== null) apply((ctx, ws) => updateTask(ctx, ws, task.id, { priority: value }));
        }}
      >
        {PRIORITIES.map((priority) => (
          <ToggleButton
            key={priority}
            value={priority}
            aria-label={t(`priority.${priority}`)}
            sx={{ gap: 0.5, px: 1.25 }}
          >
            <FlagRounded
              sx={{ fontSize: 16, color: theme.punchlist.priority[PRIORITY_KEY[priority]].fill }}
            />
            {t(`priority.${priority}`)}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
    </Box>
  );
}

export function TaskDetail({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const workspace = useWorkspace();
  const apply = useApply();
  const today = useToday();
  const theme = useTheme();
  const task = getEntity(workspace, 'tasks', taskId);
  const [menu, setMenu] = useState<TaskMenuAnchor | null>(null);

  if (!task || !isLive(task)) {
    return (
      <Box sx={{ p: 2 }}>
        <Toolbar disableGutters sx={{ justifyContent: 'flex-end' }}>
          <IconButton aria-label={t('common.close')} onClick={onClose}>
            <CloseRounded />
          </IconButton>
        </Toolbar>
        <Typography color="text.secondary">{t('task.notFound')}</Typography>
      </Box>
    );
  }

  const lists = visibleLists(workspace);
  const sections = sectionsOf(workspace, task.listId);
  const zone = localTimeZone();
  const state = dateState(task, today, workspace.entities.settings[0]?.dueSoonDays ?? 2);
  const colors = theme.punchlist.dateState;
  // Color the row that causes the state: the due date when there is one, else the schedule.
  const dueColor = task.due
    ? state === 'late'
      ? colors.late
      : state === 'dueSoon'
        ? colors.dueSoon
        : undefined
    : undefined;
  const scheduleColor =
    state === 'slipped' ? colors.slipped : state === 'late' && !task.due ? colors.late : undefined;

  return (
    <Box component="section" aria-label={t('task.details')} sx={{ p: 2, pt: 0 }}>
      <Toolbar disableGutters sx={{ gap: 1 }}>
        {task.status === 'open' ? (
          <>
            <Button
              variant="contained"
              size="small"
              onClick={() =>
                apply((ctx, ws) => setTaskStatus(ctx, ws, task.id, 'done'), t('undo.completed'))
              }
            >
              {t('task.markDone')}
            </Button>
            <Button
              size="small"
              onClick={() =>
                apply((ctx, ws) => setTaskStatus(ctx, ws, task.id, 'wontdo'), t('undo.wontDo'))
              }
            >
              {t('task.markWontDo')}
            </Button>
          </>
        ) : (
          <Button
            variant="outlined"
            size="small"
            onClick={() =>
              apply((ctx, ws) => setTaskStatus(ctx, ws, task.id, 'open'), t('undo.reopened'))
            }
          >
            {t('task.reopenAction')}
          </Button>
        )}
        <Box sx={{ flexGrow: 1 }} />
        <Tooltip title={t('task.actions')}>
          <IconButton
            aria-label={t('task.actions')}
            onClick={(event) => setMenu({ element: event.currentTarget })}
          >
            <MoreHorizRounded />
          </IconButton>
        </Tooltip>
        <TaskMenu task={task} anchor={menu} onClose={() => setMenu(null)} />
        <Tooltip title={t('task.delete')}>
          <IconButton
            aria-label={t('task.delete')}
            onClick={() => {
              apply((ctx, ws) => deleteTask(ctx, ws, task.id), t('undo.deleted'));
              onClose();
            }}
          >
            <DeleteOutlineRounded />
          </IconButton>
        </Tooltip>
        <IconButton aria-label={t('common.close')} onClick={onClose}>
          <CloseRounded />
        </IconButton>
      </Toolbar>

      <Stack spacing={2}>
        <ParentTrail task={task} />
        <CommitField
          label={t('task.title')}
          value={task.title}
          onCommit={(title) =>
            apply((ctx, ws) => updateTask(ctx, ws, task.id, { title: title.trim() }))
          }
        />
        <PriorityPicker task={task} />
        <Box>
          <DateProperty
            label={t('task.date')}
            icon={<CalendarMonthOutlined fontSize="small" />}
            value={toDateValue(task.schedule?.start, task.schedule?.end)}
            today={today}
            placeholder={t('date.addDate')}
            allowRange
            {...(scheduleColor ? { valueColor: scheduleColor } : {})}
            onChange={(value) =>
              apply((ctx, ws) =>
                updateTask(ctx, ws, task.id, {
                  schedule: value
                    ? {
                        start: fromDateValue(value),
                        end: value.end ? fromDateValue(value.end) : null,
                        allDay: value.time === null,
                        timeZone: zone,
                      }
                    : null,
                }),
              )
            }
          />
          <DateProperty
            label={t('task.due')}
            icon={<FlagOutlined fontSize="small" />}
            value={toDateValue(task.due?.at)}
            today={today}
            placeholder={t('date.addDue')}
            {...(dueColor ? { valueColor: dueColor } : {})}
            onChange={(value) =>
              apply((ctx, ws) =>
                updateTask(ctx, ws, task.id, {
                  due: value
                    ? { at: fromDateValue(value), allDay: value.time === null, timeZone: zone }
                    : null,
                }),
              )
            }
          />
          <DateProperty
            label={t('task.completedDate')}
            icon={<TaskAltRounded fontSize="small" />}
            value={task.completedAt ? toDateValue(localDateTimeOf(task.completedAt, zone)) : null}
            today={today}
            placeholder={t('date.addCompleted')}
            onChange={(value) => {
              // A date without a time keeps the time it had (or now's time).
              const keep = (
                task.completedAt
                  ? localDateTimeOf(task.completedAt, zone)
                  : localDateTimeOf(new Date().toISOString(), zone)
              ).slice(11, 16);
              apply(
                (ctx, ws) =>
                  setCompletedAt(
                    ctx,
                    ws,
                    task.id,
                    value ? instantOf(value.date, value.time ?? keep, zone) : null,
                  ),
                // Clearing the date of a closed task reopens it; setting one on an open
                // task completes it.
                !value && task.status !== 'open'
                  ? t('undo.reopened')
                  : value && task.status === 'open'
                    ? t('undo.completed')
                    : undefined,
              );
            }}
          />
          <TagsProperty task={task} />
        </Box>
        <Stack direction="row" spacing={2}>
          <TextField
            select
            label={t('task.list')}
            value={task.listId}
            fullWidth
            onChange={(event) =>
              apply((ctx, ws) =>
                moveTask(ctx, ws, task.id, { listId: event.target.value, sectionId: null }),
              )
            }
          >
            {lists.map((list) => (
              <MenuItem key={list.id} value={list.id}>
                {listName(list)}
              </MenuItem>
            ))}
          </TextField>
          {task.parentId === null && (
            <TextField
              select
              label={t('task.section')}
              value={task.sectionId ?? ''}
              fullWidth
              onChange={(event) =>
                apply((ctx, ws) =>
                  moveTask(ctx, ws, task.id, {
                    listId: task.listId,
                    sectionId: event.target.value || null,
                  }),
                )
              }
            >
              <MenuItem value="">{t('task.noSection')}</MenuItem>
              {sections.map((section) => (
                <MenuItem key={section.id} value={section.id}>
                  {section.name}
                </MenuItem>
              ))}
            </TextField>
          )}
        </Stack>
        <SubtaskEditor task={task} />
        <NotesEditor
          key={task.id}
          label={t('task.notes')}
          placeholder={t('task.notesPlaceholder')}
          value={task.notes}
          onCommit={(notes) => apply((ctx, ws) => updateTask(ctx, ws, task.id, { notes }))}
        />
      </Stack>
    </Box>
  );
}
