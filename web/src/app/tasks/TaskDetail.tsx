import CalendarMonthOutlined from '@mui/icons-material/CalendarMonthOutlined';
import CloseRounded from '@mui/icons-material/CloseRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import MoreHorizRounded from '@mui/icons-material/MoreHorizRounded';
import AttachFileRounded from '@mui/icons-material/AttachFileRounded';
import { AttachmentList } from '../attachments/Attachments.tsx';
import { useAttachFiles } from '../attachments/useAttachFiles.tsx';
import TaskAltRounded from '@mui/icons-material/TaskAltRounded';
import {
  Box,
  IconButton,
  InputBase,
  Stack,
  Toolbar,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { getEntity, isLive } from '../../core/collections.ts';
import { datePart, daysBetween, localDateTimeOf, localTimeZone } from '../../core/dates.ts';
import { dateState } from '../../core/queries.ts';
import { setCompletedAt, updateTask } from '../../core/tasks.ts';
import { DateProperty } from '../dates/DateProperty.tsx';
import { NotesEditor } from '../editor/NotesEditor.tsx';
import { CollapseIcon, DueIcon, ExpandIcon } from '../icons/icons.tsx';
import { useLongPress } from '../hooks/useLongPress.ts';
import { CompleteCheckbox } from './CompleteCheckbox.tsx';
import { isBlankDraft } from './drafts.ts';
import { completionInstant } from './completion.ts';
import { DetailFooter } from './DetailFooter.tsx';
import { ParentTrail, SubtaskEditor } from './Subtasks.tsx';
import { Comments } from './Comments.tsx';
import { PhoneTaskMore, SWIPE_UP_PX, TaskDates } from './TaskInfo.tsx';
import { touchInside } from './touchInside.ts';
import { TaskHistory } from './TaskHistory.tsx';
import { TaskMenu, type TaskMenuAnchor } from './TaskMenu.tsx';
import { fromDateValue, toDateValue } from '../dates/dateValue.ts';
import { useToday } from '../hooks/useToday.ts';
import { t } from '../i18n/i18n.ts';
import { useApply, useStoreState, useWorkspace } from '../store/hooks.ts';
import { canEditTask } from '../../core/sharing.ts';
import { TaskReadOnly } from './readOnly.ts';
import { useSyncState } from '../sync/syncContext.ts';
import { AssigneeProperty } from './AssigneeProperty.tsx';
import { ReminderProperty } from '../reminders/ReminderProperty.tsx';
import { OccurrenceActions } from '../repeat/OccurrenceActions.tsx';
import { shifted } from '../../core/occurrences.ts';
import { deleteAsking, scheduleAsking } from '../repeat/repeatActions.ts';
import { asksThisOrAll, shownOccurrence } from '../repeat/thisOrAll.ts';
import { useTaskSelection } from './selection.ts';
import { RepeatProperty } from '../repeat/RepeatProperty.tsx';

/**
 * A text field that edits locally and commits on blur or Enter, and also when it goes away
 * without a blur (the panel closes, the app goes to the background), like the notes do.
 */
function CommitField({
  label,
  value,
  onCommit,
  readOnly = false,
  autoFocus = false,
}: {
  label: string;
  value: string;
  onCommit: (value: string) => void;
  readOnly?: boolean;
  /** A new task: ready to type its title */
  autoFocus?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  const [synced, setSynced] = useState(value);
  // A new task: the title takes the keyboard once the view has opened (a dialog takes focus for
  // itself as it opens, so a moment after).
  const field = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    if (!autoFocus) return;
    const timer = setTimeout(() => field.current?.focus(), 80);
    return () => clearTimeout(timer);
  }, [autoFocus]);
  // Take outside changes (undo, another tab) without an effect.
  if (value !== synced) {
    setSynced(value);
    setDraft(value);
  }
  // The latest draft for the listeners below, and what was last sent (so a blur and the close
  // right after it send one change, not two).
  const latest = useRef({ draft, value, onCommit });
  const sent = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (latest.current.value !== value) sent.current = null;
    latest.current = { draft, value, onCommit };
  });
  const commit = useCallback(() => {
    const { draft: text, value: saved, onCommit: save } = latest.current;
    if (text === saved || text === sent.current) return;
    sent.current = text;
    save(text);
  }, []);
  // Leaving without a blur still keeps the edit. On a phone the back gesture closes the panel and
  // takes the field away with no blur, so a typed title was lost (Courtney, 2026-11-02); the same
  // when the app goes to the background. Capture phase: before the store flushes on these events.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') commit();
    };
    window.addEventListener('visibilitychange', onHide, true);
    window.addEventListener('pagehide', commit, true);
    return () => {
      window.removeEventListener('visibilitychange', onHide, true);
      window.removeEventListener('pagehide', commit, true);
      commit();
    };
  }, [commit]);
  return (
    // The title as a heading, no box round it (R-FB-121): a light wash on hover and while
    // editing says it can be changed.
    <InputBase
      value={draft}
      fullWidth
      inputRef={field}
      placeholder={label}
      // Wraps and grows, so a long title reads whole (R-FB-90); it stays one line of text, a
      // pasted line break becoming a space.
      multiline
      // E (keyboard shortcuts) finds it by this.
      inputProps={{ readOnly, 'aria-label': label, 'data-task-title': '' }}
      sx={{
        px: 1,
        py: 0.5,
        borderRadius: 2,
        fontSize: 20,
        fontWeight: 600,
        lineHeight: 1.35,
        transition: 'background-color 120ms',
        '& textarea::placeholder': { color: 'text.disabled', opacity: 1 },
        ...(readOnly ? {} : { '&:hover, &.Mui-focused': { bgcolor: 'action.hover' } }),
      }}
      onChange={(event) => setDraft(event.target.value.replace(/\s*[\r\n]+\s*/g, ' '))}
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
  // The phone's comments and history panel: open at once from a notification about a comment
  // (R-FB-106), or by a swipe up past the end (R-FB-109).
  const [params] = useSearchParams();
  const { open } = useTaskSelection();
  const [moreOpen, setMoreOpen] = useState(() => params.get('comment') !== null);
  const pull = useRef<number | null>(null);
  const titleLongPress = useLongPress((position) => setMenu({ position }));
  const phase = useSyncState((state) => state.phase);
  const authMode = useSyncState((state) => state.account?.authMode);
  // Opened from a notification before the first sync of this run has fetched the task: it is
  // being looked for, not gone (the drill of 2026-10-30).
  const fetching = useSyncState((state) => state.phase === 'ready' && state.lastSynced === null);
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
        <Typography color="text.secondary">
          {fetching ? t('task.fetching') : t('task.notFound')}
        </Typography>
      </Box>
    );
  }

  const zone = localTimeZone();
  // Opened on a repeating task's date to come: that date is the one shown (and moved).
  const shownOn = asksThisOrAll(task) ? shownOccurrence(task, params.get('on')) : null;
  const shownSchedule =
    shownOn && task.schedule
      ? shifted(task, daysBetween(datePart(task.schedule.start), shownOn)).schedule
      : task.schedule;
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
        {/* Phones keep the date readable: delete is in the ... menu there. Pin is in that menu for
            every task, subtasks too (R-FB-95). */}
        <Toolbar
          disableGutters
          sx={{ gap: phone ? 0.25 : 0.5, px: phone ? 1.5 : 2, flexShrink: 0 }}
        >
          <CompleteCheckbox task={task} onMenu={(position) => setMenu({ position })} />
          <DateProperty
            label={t('task.date')}
            inline
            icon={<CalendarMonthOutlined fontSize="small" />}
            value={toDateValue(shownSchedule?.start, shownSchedule?.end)}
            today={today}
            placeholder={t('task.date')}
            allowRange
            {...(scheduleColor ? { valueColor: scheduleColor } : {})}
            onChange={(value) =>
              void scheduleAsking(
                apply,
                task,
                value
                  ? {
                      start: fromDateValue(value),
                      end: value.end ? fromDateValue(value.end) : null,
                      allDay: value.time === null,
                      timeZone: zone,
                    }
                  : null,
                params.get('on'),
              ).then((shown) => {
                // Just this date: it is a task of its own now, so that is the one to show.
                if (shown && shown !== task.id) open(shown);
              })
            }
          />
          <Box sx={{ flexGrow: 1 }} />
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
          {!readOnly && !phone && (
            <Tooltip title={t('task.delete')}>
              <IconButton
                aria-label={t('task.delete')}
                onClick={() =>
                  void deleteAsking(apply, task, params.get('on')).then((deleted) => {
                    if (deleted) onClose();
                  })
                }
              >
                <DeleteOutlineRounded />
              </IconButton>
            </Tooltip>
          )}
          <IconButton aria-label={t('common.close')} onClick={onClose}>
            <CloseRounded />
          </IconButton>
        </Toolbar>

        {/* Room above the first field: the outlined Title's label sits above its border, and this
            scroll area would cut it off (R-FB-81). */}
        <Stack
          spacing={2}
          // On a phone, a swipe up past the end opens the comments and history (R-FB-109).
          {...(phone
            ? {
                onTouchStart: (event: React.TouchEvent<HTMLDivElement>) => {
                  const box = event.currentTarget;
                  const atEnd = box.scrollTop + box.clientHeight >= box.scrollHeight - 2;
                  pull.current =
                    atEnd && touchInside(event) ? (event.touches[0]?.clientY ?? null) : null;
                },
                onTouchMove: (event: React.TouchEvent<HTMLDivElement>) => {
                  const y = event.touches[0]?.clientY;
                  if (pull.current !== null && y !== undefined && pull.current - y > SWIPE_UP_PX) {
                    pull.current = null;
                    setMoreOpen(true);
                  }
                },
              }
            : {})}
          sx={{ flexGrow: 1, minHeight: 0, overflowY: 'auto', px: 2, pb: 2, pt: 1.5 }}
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
              // A new task (the + button, the add bar's expand): type its title straight away.
              autoFocus={isBlankDraft(task)}
              onCommit={(title) =>
                apply((ctx, ws) => {
                  // Saved on the way out: the task may be gone by then (deleted, or out of sync).
                  const current = getEntity(ws, 'tasks', task.id);
                  return current && isLive(current)
                    ? updateTask(ctx, ws, task.id, { title: title.trim() })
                    : ws;
                })
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
            <RepeatProperty task={task} />
            <OccurrenceActions task={task} />
            <ReminderProperty task={task} />
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
          {!phone && (
            <>
              {/* Comments and history keep to the bottom of the panel, not under the subtasks
                  (R-FB-138). */}
              <Box aria-hidden sx={{ flexGrow: 1 }} />
              <Comments task={task} />
              <TaskHistory task={task} />
              <TaskDates task={task} />
            </>
          )}
        </Stack>
        {phone && <PhoneTaskMore task={task} open={moreOpen} setOpen={setMoreOpen} />}
        <DetailFooter task={task} />
      </Box>
    </TaskReadOnly>
  );
}
