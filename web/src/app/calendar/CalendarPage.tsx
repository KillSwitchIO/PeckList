import CalendarViewMonthOutlined from '@mui/icons-material/CalendarViewMonthOutlined';
import ViewAgendaOutlined from '@mui/icons-material/ViewAgendaOutlined';
import ViewWeekOutlined from '@mui/icons-material/ViewWeekOutlined';
import {
  Box,
  Button,
  IconButton,
  ListItemText,
  Menu,
  MenuItem,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import {
  calendarItems,
  droppedSchedule,
  placedSchedule,
  unscheduledTasks,
  type CalendarItem,
} from '../../core/calendar.ts';
import { atMinutes, itemsByDay, MAX_DAYS, MIN_DAYS } from '../../core/calendarLayout.ts';
import { addDays, daysBetween, localTimeZone, shiftMonths, timePart } from '../../core/dates.ts';
import { inboxList } from '../../core/lists.ts';
import { canEditTask } from '../../core/sharing.ts';
import { createTask, updateTask } from '../../core/tasks.ts';
import type { Schedule, WorkspaceFile } from '../../core/types.ts';
import { useToday } from '../hooks/useToday.ts';
import { CalendarIcon, ChevronLeftIcon, ChevronRightIcon } from '../icons/icons.tsx';
import { t } from '../i18n/i18n.ts';
import { BottomSheet } from '../layout/BottomSheet.tsx';
import { Page } from '../layout/Page.tsx';
import { useApply, useStoreState, useWorkspace } from '../store/hooks.ts';
import { markDraft } from '../tasks/drafts.ts';
import { useTaskSelection } from '../tasks/selection.ts';
import { calendarTitle } from './calendarTitle.ts';
import {
  askedFor,
  loadPrefs,
  savePrefs,
  type CalendarMode,
  type CalendarPrefs,
} from './calendarPrefs.ts';
import { DayPopup } from './DayPopup.tsx';
import { DaysView } from './DaysView.tsx';
import { MonthView, type MonthViewInfo } from './MonthView.tsx';
import { NumberDial } from './NumberDial.tsx';
import { useCalendarDrag, type DragPayload, type DropTarget } from './useCalendarDrag.ts';
import { useNarrowed } from '../views/useNarrowed.tsx';

/** How many unscheduled tasks show at first (and more on asking). */
const UNSCHEDULED_PAGE = 100;
/** Days of items worked out beyond what is drawn, so scrolling a little needs no new pass. */
const WINDOW_PAD = 28;

/** Open tasks with no date, to drag onto the calendar. */
function Unscheduled({
  source,
  onOpen,
  onGrab,
}: {
  /** The tasks to draw from (narrowed by the calendar's filter) */
  source: WorkspaceFile;
  onOpen: (id: string) => void;
  onGrab: (event: React.PointerEvent<HTMLElement>, payload: DragPayload, hold: boolean) => void;
}) {
  const tasks = unscheduledTasks(source);
  const [limit, setLimit] = useState(UNSCHEDULED_PAGE);
  return (
    <Box sx={{ width: { xs: '100%', md: 260 }, p: 1.5, overflowY: 'auto', height: '100%' }}>
      <Typography variant="subtitle2" color="text.secondary">
        {t('calendar.unscheduled')}
      </Typography>
      <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 1 }}>
        {t('calendar.unscheduledHint')}
      </Typography>
      <Box role="list" aria-label={t('calendar.unscheduled')}>
        {tasks.slice(0, limit).map((task) => (
          <Box
            key={task.id}
            role="listitem"
            data-task-id={task.id}
            onClick={() => onOpen(task.id)}
            onPointerDown={(event) => onGrab(event, { taskId: task.id, title: task.title }, true)}
            sx={{
              px: 1,
              py: 0.75,
              mb: 0.5,
              borderRadius: 1.5,
              border: 1,
              borderColor: 'divider',
              cursor: 'grab',
              fontSize: 14,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              touchAction: 'pan-y',
              userSelect: 'none',
              '&:hover': { bgcolor: 'action.hover' },
            }}
          >
            {task.title || t('task.untitled')}
          </Box>
        ))}
        {tasks.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            {t('calendar.allScheduled')}
          </Typography>
        )}
        {tasks.length > limit && (
          <Button size="small" onClick={() => setLimit((current) => current + UNSCHEDULED_PAGE)}>
            {t('tasks.showMore', { count: Math.min(tasks.length - limit, UNSCHEDULED_PAGE) })}
          </Button>
        )}
      </Box>
    </Box>
  );
}

const DAY_CHOICES = Array.from({ length: MAX_DAYS - MIN_DAYS + 1 }, (_, i) => MIN_DAYS + i);
const WEEK_CHOICES = [4, 5, 6];

/**
 * Calendar (spec: PL-093, like Business Calendar 2): Month, a continuous run of weeks, and Days,
 * 1 to 14 days on a time grid. Tasks move by dragging; days picked by dragging across them show
 * on their own or become a task's span; Unscheduled tasks drag in from the side (a sheet on
 * phones). Upcoming is the agenda, a click away.
 */
export function CalendarPage() {
  const theme = useTheme();
  const phone = useMediaQuery(theme.breakpoints.down('md'));
  const workspace = useWorkspace();
  const { workspace: shown, button: narrowButton } = useNarrowed('calendar');
  const apply = useApply();
  const navigate = useNavigate();
  const me = useStoreState((state) => state.context().userId);
  const { open } = useTaskSelection();
  const zone = localTimeZone();
  const today = useToday(zone);
  const settings = workspace.entities.settings[0];
  const weekStart = settings?.weekStart ?? 0;

  const [prefs, setPrefsState] = useState<CalendarPrefs>(() => loadPrefs(phone));
  const setPrefs = (patch: Partial<CalendarPrefs>) => {
    const next = { ...prefs, ...patch };
    setPrefsState(next);
    savePrefs(next);
  };
  const [params] = useSearchParams();
  const [seen, setSeen] = useState<string | null>(null);
  const [date, setDate] = useState(today);
  const [target, setTarget] = useState({ date: today, seq: 0 });
  // A day the address asks for (the mini calendar, a link): go there, once per asking.
  if (params.toString() !== seen) {
    setSeen(params.toString());
    const asked = askedFor(params);
    if (asked.mode || asked.days) {
      setPrefsState({
        ...prefs,
        ...(asked.mode ? { mode: asked.mode } : {}),
        ...(asked.days ? { days: asked.days } : {}),
      });
    }
    if (asked.date) {
      setDate(asked.date);
      setTarget({ date: asked.date, seq: target.seq + 1 });
    }
  }
  const mode: CalendarMode = prefs.mode;

  // What the month view shows, and the wider window items are worked out for.
  const [view, setView] = useState<MonthViewInfo | null>(null);
  const [win, setWin] = useState<{ from: string; to: string } | null>(null);
  const shownFrom = mode === 'month' ? view?.from : date;
  const shownTo = mode === 'month' ? view?.to : addDays(date, prefs.days - 1);
  if (shownFrom && shownTo && (!win || shownFrom < win.from || shownTo > win.to)) {
    setWin({ from: addDays(shownFrom, -WINDOW_PAD), to: addDays(shownTo, WINDOW_PAD) });
  }
  const items = useMemo(
    () =>
      win
        ? calendarItems(shown, win.from, win.to, settings?.pointEventMinutes ?? 30, (task) =>
            canEditTask(workspace, me, task),
          )
        : [],
    [shown, workspace, win, settings?.pointEventMinutes, me],
  );
  const byDay = useMemo(
    () => (win ? itemsByDay(items, win.from, win.to) : new Map<string, CalendarItem[]>()),
    [items, win],
  );

  const [drawer, setDrawer] = useState(false);
  const [popup, setPopup] = useState<{
    day: string;
    time: string | null;
    anchor: HTMLElement;
  } | null>(null);
  const [range, setRange] = useState<{ first: string; last: string; x: number; y: number } | null>(
    null,
  );

  const schedule = (taskId: string, next: Schedule) =>
    apply((ctx, ws) => updateTask(ctx, ws, taskId, { schedule: next }));
  const drag = useCalendarDrag(
    (payload: DragPayload, place: DropTarget) => {
      const task = workspace.entities.tasks.find((each) => each.id === payload.taskId);
      if (!task) return;
      if (!task.schedule) {
        const time = place.minutes === null ? null : atMinutes(place.day, place.minutes).slice(11);
        schedule(task.id, droppedSchedule(place.day, time, zone));
        return;
      }
      // On the month a timed task keeps its time; the Days view's all-day row makes it all day.
      const time = timePart(task.schedule.start);
      const placement =
        place.minutes !== null
          ? { start: atMinutes(place.day, place.minutes), end: null, allDay: false }
          : mode === 'month' && time && !task.schedule.allDay
            ? { start: `${place.day}T${time}`, end: null, allDay: false }
            : { start: place.day, end: null, allDay: true };
      schedule(task.id, placedSchedule(task.schedule, placement, zone));
    },
    () => setDrawer(false),
  );
  const grabItem = (event: React.PointerEvent<HTMLElement>, item: CalendarItem, grabMinutes = 0) =>
    drag.begin(event, { taskId: item.taskId, title: item.title, grabMinutes });

  // A task dragged over a time in Days: where it would land, at its own length.
  const preview = (() => {
    const target = drag.ghost?.target;
    if (mode !== 'days' || !drag.ghost || !target || target.minutes === null) return null;
    const task = workspace.entities.tasks.find((each) => each.id === drag.ghost!.taskId);
    if (!task) return null;
    const point = settings?.pointEventMinutes ?? 30;
    const schedule = task.schedule;
    const length =
      schedule && !schedule.allDay && schedule.end && timePart(schedule.start)
        ? (Date.parse(`${schedule.end}:00Z`) - Date.parse(`${schedule.start}:00Z`)) / 60_000
        : point;
    const color =
      workspace.entities.lists.find((list) => list.id === task.listId)?.color ?? '#B8BCC4';
    return {
      taskId: task.id,
      day: target.day,
      top: target.minutes,
      bottom: Math.min(1440, target.minutes + Math.max(15, length)),
      color,
    };
  })();

  const goToday = () => {
    setDate(today);
    setTarget({ date: today, seq: target.seq + 1 });
  };
  const step = (direction: 1 | -1) => {
    if (mode === 'month') {
      const month = view?.month ?? today.slice(0, 7);
      setTarget({ date: shiftMonths(`${month}-01`, direction), seq: target.seq + 1 });
    } else {
      setDate(addDays(date, direction * prefs.days));
    }
  };
  const showDays = (first: string, count: number) => {
    setDate(first);
    setPrefs({ mode: 'days', days: Math.min(MAX_DAYS, Math.max(MIN_DAYS, count)) });
  };
  const switchMode = (next: CalendarMode) => {
    // Days start where the month is looking; the month comes back to the days shown.
    if (next === 'days' && view) {
      setDate(view.month === today.slice(0, 7) ? today : `${view.month}-01`);
    }
    if (next === 'month') setTarget({ date, seq: target.seq + 1 });
    setPrefs({ mode: next });
  };

  const title =
    mode === 'month'
      ? calendarTitle('month', `${view?.month ?? today.slice(0, 7)}-01`, prefs.days, today)
      : calendarTitle('days', date, prefs.days, today);
  const panel = (
    <Unscheduled
      source={shown}
      onOpen={open}
      onGrab={(event, payload, hold) => drag.begin(event, payload, hold)}
    />
  );

  return (
    <Page
      title={t('nav.calendar')}
      actions={
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          {narrowButton}
          <Tooltip title={t('calendar.agenda')}>
            <IconButton
              aria-label={t('calendar.agenda')}
              onClick={() => void navigate('/upcoming')}
            >
              <ViewAgendaOutlined />
            </IconButton>
          </Tooltip>
          {phone && (
            <Button size="small" onClick={() => setDrawer(true)}>
              {t('calendar.unscheduled')}
            </Button>
          )}
        </Box>
      }
    >
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          height: 'calc(100dvh - 140px)',
          minHeight: 420,
        }}
      >
        {/* One row that never wraps, so nothing moves as the title changes length. */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: { xs: 0.5, sm: 1 }, mb: 1 }}>
          {phone ? (
            <Tooltip title={t('calendar.goToday')}>
              <IconButton size="small" onClick={goToday} aria-label={t('calendar.goToday')}>
                <CalendarIcon badge={String(Number(today.slice(8, 10)))} />
              </IconButton>
            </Tooltip>
          ) : (
            <Button
              size="small"
              variant="outlined"
              onClick={goToday}
              aria-label={t('calendar.goToday')}
              sx={{ flexShrink: 0 }}
            >
              {t('calendar.today')}
            </Button>
          )}
          <IconButton size="small" aria-label={t('calendar.previous')} onClick={() => step(-1)}>
            <ChevronLeftIcon fontSize="small" />
          </IconButton>
          <IconButton size="small" aria-label={t('calendar.next')} onClick={() => step(1)}>
            <ChevronRightIcon fontSize="small" />
          </IconButton>
          <Typography
            component="h2"
            aria-live="polite"
            noWrap
            sx={{ fontWeight: 600, flexGrow: 1, minWidth: 0, fontSize: { xs: 15, sm: 16 } }}
          >
            {title}
          </Typography>
          {mode === 'days' ? (
            <NumberDial
              values={DAY_CHOICES}
              value={prefs.days}
              onChange={(days) => setPrefs({ days })}
              label={t('calendar.daysShown')}
              caption={(count) =>
                count === 1 ? t('calendar.oneDay') : t('calendar.dayCount', { count })
              }
            />
          ) : (
            <NumberDial
              values={WEEK_CHOICES}
              value={prefs.weeks}
              onChange={(weeks) => setPrefs({ weeks: weeks as 4 | 5 | 6 })}
              label={t('calendar.weeksShown')}
              caption={(count) => t('calendar.weeks', { count })}
            />
          )}
          <ToggleButtonGroup
            exclusive
            size="small"
            value={mode}
            onChange={(_, next: CalendarMode | null) => next && switchMode(next)}
            aria-label={t('calendar.mode')}
            sx={{ flexShrink: 0 }}
          >
            <ToggleButton
              value="month"
              aria-label={t('calendar.month')}
              sx={{ px: phone ? 0.75 : 1.5 }}
            >
              {phone ? <CalendarViewMonthOutlined fontSize="small" /> : t('calendar.month')}
            </ToggleButton>
            <ToggleButton
              value="days"
              aria-label={t('calendar.days')}
              sx={{ px: phone ? 0.75 : 1.5 }}
            >
              {phone ? <ViewWeekOutlined fontSize="small" /> : t('calendar.days')}
            </ToggleButton>
          </ToggleButtonGroup>
        </Box>
        <Box sx={{ display: 'flex', flexGrow: 1, minHeight: 0, gap: 1 }}>
          <Box
            sx={{
              flexGrow: 1,
              minWidth: 0,
              border: 1,
              borderColor: 'divider',
              borderRadius: 1,
              overflow: 'hidden',
            }}
          >
            {mode === 'month' ? (
              <MonthView
                today={today}
                weekStart={weekStart}
                weeks={prefs.weeks}
                target={target}
                byDay={byDay}
                onView={setView}
                onOpenTask={open}
                onOpenDay={(day, anchor) => setPopup({ day, time: null, anchor })}
                onRange={(first, last, point) => setRange({ first, last, ...point })}
                rangeOpen={range !== null}
                onGrab={(event, item) => grabItem(event, item)}
              />
            ) : (
              <DaysView
                start={date}
                count={prefs.days}
                today={today}
                byDay={byDay}
                hourHeight={prefs.hourHeight}
                onHourHeight={(hourHeight) => setPrefs({ hourHeight })}
                onOpenTask={open}
                onOpenDay={(day, anchor) => setPopup({ day, time: null, anchor })}
                onSlot={(day, minutes, anchor) =>
                  setPopup({ day, time: atMinutes(day, minutes).slice(11), anchor })
                }
                onPage={step}
                onGrab={grabItem}
                onCancelGrab={drag.cancel}
                preview={preview}
                onResize={(item, start, end) => {
                  const task = workspace.entities.tasks.find((each) => each.id === item.taskId);
                  if (!task?.schedule) return;
                  schedule(
                    task.id,
                    placedSchedule(task.schedule, { start, end, allDay: false }, zone),
                  );
                }}
              />
            )}
          </Box>
          {!phone && <Box sx={{ borderLeft: 1, borderColor: 'divider' }}>{panel}</Box>}
        </Box>
      </Box>
      {phone && (
        <BottomSheet open={drawer} onClose={() => setDrawer(false)} keepMounted>
          <Box sx={{ maxHeight: '50dvh' }}>{panel}</Box>
        </BottomSheet>
      )}
      {popup && (
        <DayPopup
          day={popup.day}
          time={popup.time}
          items={byDay.get(popup.day) ?? []}
          anchor={popup.anchor}
          onClose={() => setPopup(null)}
          onOpenTask={open}
          onShowDays={() => {
            setPopup(null);
            showDays(popup.day, 1);
          }}
        />
      )}
      <Menu
        open={range !== null}
        onClose={() => setRange(null)}
        anchorReference="anchorPosition"
        anchorPosition={range ? { top: range.y, left: range.x } : { top: 0, left: 0 }}
      >
        {range && [
          <MenuItem
            key="show"
            onClick={() => {
              showDays(range.first, daysBetween(range.first, range.last) + 1);
              setRange(null);
            }}
          >
            <ListItemText
              primary={t('calendar.showTheseDays', {
                count: Math.min(MAX_DAYS, daysBetween(range.first, range.last) + 1),
              })}
            />
          </MenuItem>,
          <MenuItem
            key="span"
            onClick={() => {
              let id = '';
              apply((ctx, ws) => {
                const made = createTask(ctx, ws, {
                  title: '',
                  listId: inboxList(ws).id,
                  schedule: { start: range.first, end: range.last, allDay: true, timeZone: zone },
                });
                id = made.task.id;
                return made.workspace;
              });
              setRange(null);
              if (id) {
                markDraft(id);
                open(id, { full: true });
              }
            }}
          >
            <ListItemText primary={t('calendar.taskOverDays')} />
          </MenuItem>,
        ]}
      </Menu>
      {drag.ghost && !preview && (
        <Box
          aria-hidden
          sx={{
            position: 'fixed',
            left: drag.ghost.x + 12,
            top: drag.ghost.y + 12,
            zIndex: (z) => z.zIndex.tooltip,
            pointerEvents: 'none',
            px: 1,
            py: 0.5,
            borderRadius: 1,
            bgcolor: 'background.paper',
            boxShadow: 6,
            fontSize: 13,
            maxWidth: 240,
          }}
        >
          <Box
            sx={{
              fontWeight: 600,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {drag.ghost.title || t('task.untitled')}
          </Box>
          {drag.ghost.target && (
            <Box sx={{ color: 'text.secondary', fontSize: 12 }}>
              {calendarTitle('days', drag.ghost.target.day, 1, today)}
              {drag.ghost.target.minutes !== null &&
                `, ${atMinutes(drag.ghost.target.day, drag.ghost.target.minutes).slice(11)}`}
            </Box>
          )}
        </Box>
      )}
    </Page>
  );
}
