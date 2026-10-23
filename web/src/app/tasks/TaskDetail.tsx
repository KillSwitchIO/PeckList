import CalendarMonthOutlined from '@mui/icons-material/CalendarMonthOutlined';
import CloseRounded from '@mui/icons-material/CloseRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import MoreHorizRounded from '@mui/icons-material/MoreHorizRounded';
import AttachFileRounded from '@mui/icons-material/AttachFileRounded';
import { AttachmentList, useAttachFiles } from '../attachments/Attachments.tsx';
import TaskAltRounded from '@mui/icons-material/TaskAltRounded';
import {
  Box,
  IconButton,
  Stack,
  TextField,
  Toolbar,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { useState } from 'react';
import { getEntity, isLive } from '../../core/collections.ts';
import { localDateTimeOf, localTimeZone } from '../../core/dates.ts';
import { dateState } from '../../core/queries.ts';
import { deleteTask, isPinned, setCompletedAt, setPinned, updateTask } from '../../core/tasks.ts';
import { DateProperty } from '../dates/DateProperty.tsx';
import { NotesEditor } from '../editor/NotesEditor.tsx';
import { CollapseIcon, DueIcon, ExpandIcon, PinIcon } from '../icons/icons.tsx';
import { useLongPress } from '../hooks/useLongPress.ts';
import { CompleteCheckbox } from './CompleteCheckbox.tsx';
import { completionInstant } from './completion.ts';
import { DetailFooter } from './DetailFooter.tsx';
import { ParentTrail, SubtaskEditor } from './Subtasks.tsx';
import { Comments } from './Comments.tsx';
import { PhoneTaskMore, TaskDates } from './TaskInfo.tsx';
import { TaskMenu, type TaskMenuAnchor } from './TaskMenu.tsx';
import { fromDateValue, toDateValue } from '../dates/dateValue.ts';
import { useToday } from '../hooks/useToday.ts';
import { t } from '../i18n/i18n.ts';
import { useApply, useStoreState, useWorkspace } from '../store/hooks.ts';
import { canEditTask } from '../../core/sharing.ts';
import { TaskReadOnly } from './readOnly.ts';
import { useSyncState } from '../sync/syncContext.ts';
import { AssigneeProperty } from './AssigneeProperty.tsx';

/** A text field that edits locally and commits on blur or Enter. */
function CommitField({
  label,
  value,
  onCommit,
  readOnly = false,
}: {
  label: string;
  value: string;
  onCommit: (value: string) => void;
  readOnly?: boolean;
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
      slotProps={{ htmlInput: { readOnly } }}
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

export function TaskDetail({
  taskId,
  onClose,
  expanded = false,
  onToggleExpanded,
}: {
  taskId: string;
  onClose: () => void;
  /** Shown in the large full-screen view. */
  expanded?: boolean;
  /** Switch between the side panel and full screen; no button when absent. */
  onToggleExpanded?: () => void;
}) {
  const workspace = useWorkspace();
  const apply = useApply();
  const today = useToday();
  const theme = useTheme();
  const phone = useMediaQuery(theme.breakpoints.down('sm'), { noSsr: true });
  const task = getEntity(workspace, 'tasks', taskId);
  const [menu, setMenu] = useState<TaskMenuAnchor | null>(null);
  const titleLongPress = useLongPress((position) => setMenu({ position }));
  const phase = useSyncState((state) => state.phase);
  const authMode = useSyncState((state) => state.account?.authMode);
  // Assigning needs other people: a server with accounts.
  const canAssign = phase === 'ready' && authMode === 'local';
  const me = useStoreState((state) => state.context().userId);
  const attach = useAttachFiles(task && isLive(task) ? task : undefined);
  const [dropping, setDropping] = useState(false);

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
  // A task on a list I can only view: everything shows, nothing changes.
  const readOnly = !canEditTask(workspace, me, task);

  return (
    <TaskReadOnly value={readOnly}>
      <Box
        component="section"
        aria-label={t('task.details')}
        // Files dropped anywhere on the details attach to the task.
        onDragOver={(event) => {
          if (!attach.allowed || readOnly || !event.dataTransfer.types.includes('Files')) return;
          event.preventDefault();
          setDropping(true);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropping(false);
        }}
        onDrop={(event) => {
          if (!attach.allowed || readOnly || event.dataTransfer.files.length === 0) return;
          event.preventDefault();
          setDropping(false);
          void attach.add(Array.from(event.dataTransfer.files));
        }}
        sx={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          outline: dropping ? 2 : 0,
          outlineColor: 'primary.main',
          outlineStyle: 'dashed',
          outlineOffset: -4,
        }}
      >
        {attach.input}
        <Toolbar disableGutters sx={{ gap: 1, px: 2, flexShrink: 0 }}>
          <CompleteCheckbox task={task} onMenu={(position) => setMenu({ position })} />
          <DateProperty
            label={t('task.date')}
            inline
            icon={<CalendarMonthOutlined fontSize="small" />}
            value={toDateValue(task.schedule?.start, task.schedule?.end)}
            today={today}
            placeholder={t('task.date')}
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
          <Box sx={{ flexGrow: 1 }} />
          {!readOnly && task.parentId === null && task.status === 'open' && (
            <Tooltip title={isPinned(task) ? t('task.unpin') : t('task.pin')}>
              <IconButton
                aria-label={isPinned(task) ? t('task.unpin') : t('task.pin')}
                aria-pressed={isPinned(task)}
                onClick={() => apply((ctx, ws) => setPinned(ctx, ws, task.id, !isPinned(task)))}
                sx={{ color: isPinned(task) ? 'primary.main' : undefined }}
              >
                <PinIcon fontSize="small" filled={isPinned(task)} />
              </IconButton>
            </Tooltip>
          )}
          {!readOnly && attach.allowed && (
            <Tooltip title={t('files.attach')}>
              <IconButton aria-label={t('files.attach')} onClick={attach.pick}>
                <AttachFileRounded fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
          {!readOnly && (
            <Tooltip title={t('task.actions')}>
              <IconButton
                aria-label={t('task.actions')}
                onClick={(event) => setMenu({ element: event.currentTarget })}
              >
                <MoreHorizRounded />
              </IconButton>
            </Tooltip>
          )}
          <TaskMenu task={task} anchor={menu} onClose={() => setMenu(null)} />
          {onToggleExpanded && (
            <Tooltip title={expanded ? t('task.exitFullScreen') : t('task.fullScreen')}>
              <IconButton
                aria-label={expanded ? t('task.exitFullScreen') : t('task.fullScreen')}
                onClick={onToggleExpanded}
              >
                {expanded ? <CollapseIcon fontSize="small" /> : <ExpandIcon fontSize="small" />}
              </IconButton>
            </Tooltip>
          )}
          {!readOnly && (
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
          )}
          <IconButton aria-label={t('common.close')} onClick={onClose}>
            <CloseRounded />
          </IconButton>
        </Toolbar>

        <Stack
          spacing={2}
          sx={{ flexGrow: 1, minHeight: 0, overflowY: 'auto', px: 2, pb: 2, pt: 0.5 }}
        >
          <ParentTrail task={task} />
          {/* Right-click or long-press the title for Won't do, Progress and the other actions. */}
          <Box
            onContextMenu={(event) => {
              event.preventDefault();
              setMenu({ position: { top: event.clientY, left: event.clientX } });
            }}
            {...titleLongPress}
          >
            <CommitField
              label={t('task.title')}
              value={task.title}
              readOnly={readOnly}
              onCommit={(title) =>
                apply((ctx, ws) => updateTask(ctx, ws, task.id, { title: title.trim() }))
              }
            />
          </Box>
          <Box>
            {/* Looking only: empty fields have nothing to show. */}
            {(!readOnly || task.due) && (
              <DateProperty
                label={t('task.due')}
                icon={<DueIcon fontSize="small" />}
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
            )}
            {/* Only a done or won't-do task has a completion date (open ones: the task menu). */}
            {task.status !== 'open' && (
              <DateProperty
                label={t('task.completedDate')}
                icon={<TaskAltRounded fontSize="small" />}
                value={
                  task.completedAt ? toDateValue(localDateTimeOf(task.completedAt, zone)) : null
                }
                today={today}
                placeholder={t('date.addCompleted')}
                onChange={(value) =>
                  apply(
                    (ctx, ws) =>
                      setCompletedAt(
                        ctx,
                        ws,
                        task.id,
                        value ? completionInstant(task, value, zone) : null,
                      ),
                    // Clearing the date reopens the task.
                    value ? undefined : t('undo.reopened'),
                  )
                }
              />
            )}
            {canAssign && <AssigneeProperty task={task} />}
          </Box>
          {(!readOnly || task.notes) && (
            <NotesEditor
              key={task.id}
              title={task.title}
              label={t('task.notes')}
              placeholder={t('task.notesPlaceholder')}
              value={task.notes}
              readOnly={readOnly}
              onCommit={(notes) => apply((ctx, ws) => updateTask(ctx, ws, task.id, { notes }))}
            />
          )}
          <AttachmentList
            task={task}
            problem={attach.problem}
            onDismissProblem={attach.clearProblem}
          />
          <SubtaskEditor task={task} />
          {!phone && <Comments task={task} />}
          {!phone && <TaskDates task={task} />}
        </Stack>
        {phone && <PhoneTaskMore task={task} />}
        <DetailFooter task={task} />
      </Box>
    </TaskReadOnly>
  );
}
