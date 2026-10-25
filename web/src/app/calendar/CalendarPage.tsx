import ViewAgendaOutlined from '@mui/icons-material/ViewAgendaOutlined';
import {
  Box,
  Button,
  IconButton,
  ListItemText,
  Menu,
  MenuItem,
  Slider,
  TextField,
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
import type { Schedule } from '../../core/types.ts';
import { useToday } from '../hooks/useToday.ts';
import { ChevronLeftIcon, ChevronRightIcon } from '../icons/icons.tsx';
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
import { useCalendarDrag, type DragPayload, type DropTarget } from './useCalendarDrag.ts';

/** How many unscheduled tasks show at first (and more on asking). */
const UNSCHEDULED_PAGE = 100;
/** Days of items worked out beyond what is drawn, so scrolling a little needs no new pass. */
const WINDOW_PAD = 28;

/** Open tasks with no date, to drag onto the calendar. */
function Unscheduled({
  onOpen,
  onGrab,
}: {
  onOpen: (id: string) => void;
  onGrab: (event: React.PointerEvent<HTMLElement>, payload: DragPayload, hold: boolean) => void;
}) {
  const workspace = useWorkspace();
  const tasks = unscheduledTasks(workspace);
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

// 3 gets a tick but no label: on a phone "1" and "3" would run together.
const DAY_MARKS = [1, 3, 7, 14].map((value) => ({
  value,
  ...(value === 3 ? {} : { label: String(value) }),
}));

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
        ? calendarItems(workspace, win.from, win.to, settings?.pointEventMinutes ?? 30, (task) =>
            canEditTask(workspace, me, task),
          )
        : [],
    [workspace, win, settings?.pointEventMinutes, me],
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
      onOpen={open}
      onGrab={(event, payload, hold) => drag.begin(event, payload, hold)}
    />
  );

  return (
    <Page
      title={t('nav.calendar')}
      actions={
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
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
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 1 }}>
          <Button
            size="small"
            variant="outlined"
            onClick={goToday}
            aria-label={t('calendar.goToday')}
          >
            {t('calendar.today')}
          </Button>
          <IconButton size="small" aria-label={t('calendar.previous')} onClick={() => step(-1)}>
            <ChevronLeftIcon fontSize="small" />
          </IconButton>
          <IconButton size="small" aria-label={t('calendar.next')} onClick={() => step(1)}>
            <ChevronRightIcon fontSize="small" />
          </IconButton>
          <Typography component="h2" sx={{ fontWeight: 600, flexGrow: 1 }} aria-live="polite">
            {title}
          </Typography>
          {mode === 'days' ? (
            <Box sx={{ width: { xs: 120, sm: 160 }, px: 1 }}>
              <Slider
                size="small"
                min={MIN_DAYS}
                max={MAX_DAYS}
                step={1}
                marks={DAY_MARKS}
                value={prefs.days}
                valueLabelDisplay="auto"
                onChange={(_, value) => setPrefs({ days: value })}
                slotProps={{ input: { 'aria-label': t('calendar.daysShown') } }}
                sx={{ '& .MuiSlider-markLabel': { fontSize: 10, top: 18 }, mb: 1 }}
              />
            </Box>
          ) : (
            <TextField
              select
              size="small"
              value={prefs.weeks}
              onChange={(event) => setPrefs({ weeks: Number(event.target.value) as 4 | 5 | 6 })}
              slotProps={{ htmlInput: { 'aria-label': t('calendar.weeksShown') } }}
              sx={{ '& .MuiSelect-select': { py: 0.5, fontSize: 13 } }}
            >
              {[4, 5, 6].map((weeks) => (
                <MenuItem key={weeks} value={weeks}>
                  {t('calendar.weeks', { count: weeks })}
                </MenuItem>
              ))}
            </TextField>
          )}
          <ToggleButtonGroup
            exclusive
            size="small"
            value={mode}
            onChange={(_, next: CalendarMode | null) => next && switchMode(next)}
            aria-label={t('calendar.mode')}
          >
            <ToggleButton value="month" sx={{ px: 1.5 }}>
              {t('calendar.month')}
            </ToggleButton>
            <ToggleButton value="days" sx={{ px: 1.5 }}>
              {t('calendar.days')}
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
                key={prefs.days}
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
      {drag.ghost && (
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
