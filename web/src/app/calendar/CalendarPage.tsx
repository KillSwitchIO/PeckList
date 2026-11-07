import RadioButtonUncheckedRounded from '@mui/icons-material/RadioButtonUncheckedRounded';
import EventBusyOutlined from '@mui/icons-material/EventBusyOutlined';
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
import { useSearchParams } from 'react-router';
import {
  calendarItems,
  droppedSchedule,
  placedSchedule,
  unscheduledTasks,
  type CalendarItem,
} from '../../core/calendar.ts';
import {
  atMinutes,
  itemsByDay,
  MAX_DAYS,
  MIN_DAYS,
  heatScale,
  openCountsByDay,
} from '../../core/calendarLayout.ts';
import {
  addDays,
  datePart,
  daysBetween,
  localTimeZone,
  shiftMonths,
  timePart,
} from '../../core/dates.ts';
import { inboxList } from '../../core/lists.ts';
import { canEditTask } from '../../core/sharing.ts';
import { createTask, updateTask } from '../../core/tasks.ts';
import type { Schedule, WorkspaceFile } from '../../core/types.ts';
import { useToday } from '../hooks/useToday.ts';
import { MonthPickerPopover } from '../dates/MonthPickerPopover.tsx';
import { weekStart as preferredWeekStart } from '../format.ts';
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DaysViewIcon,
  MonthViewIcon,
  YearViewIcon,
} from '../icons/icons.tsx';
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
  MAX_WEEKS,
  MIN_WEEKS,
  type CalendarMode,
  type CalendarPrefs,
} from './calendarPrefs.ts';
import { DayPopup } from './DayPopup.tsx';
import { DaysView } from './DaysView.tsx';
import { MonthView, type MonthViewInfo } from './MonthView.tsx';
import { NumberDial } from './NumberDial.tsx';
import { useCalendarDrag, type DragPayload, type DropTarget } from './useCalendarDrag.ts';
import { dateHeading } from './calendarLook.ts';
import type { YearStay } from './yearLayout.ts';
import { YearView, type YearHeat } from './YearView.tsx';
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
  onGrab: (event: React.PointerEvent<HTMLElement>, payload: DragPayload) => void;
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
            onPointerDown={(event) => onGrab(event, { taskId: task.id, title: task.title })}
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
const WEEK_CHOICES = Array.from({ length: MAX_WEEKS - MIN_WEEKS + 1 }, (_, i) => MIN_WEEKS + i);

/**
 * Calendar (spec: PL-093, like Business Calendar 2): Month, a continuous run of weeks; Days, 1 to
 * 14 days on a time grid; and Year, twelve small months shaded by how busy each day is. Tasks move
 * by dragging; days picked by dragging across them show on their own or become a task's span;
 * Unscheduled tasks drag in from the side (a sheet on phones). Year is for reading, so nothing
 * drags there and Unscheduled steps aside. Upcoming, the agenda, is in the menu.
 */
export function CalendarPage() {
  const theme = useTheme();
  const phone = useMediaQuery(theme.breakpoints.down('md'));
  const narrow = useMediaQuery(theme.breakpoints.down('sm'));
  const workspace = useWorkspace();
  const { workspace: shown, button: narrowButton } = useNarrowed('calendar');
  const apply = useApply();
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
  // What is done is off the calendar from today on (R-FB-141), but days gone by show what was
  // done on them, drawn as done (Ben, 2026-11-02).
  // Year counts for itself a year at a time, so Month's window stays unworked while it shows.
  const inYear = mode === 'year';
  const items = useMemo(
    () =>
      win && !inYear
        ? calendarItems(shown, win.from, win.to, settings?.pointEventMinutes ?? 60, (task) =>
            canEditTask(workspace, me, task),
          ).filter((item) => !item.done || datePart(item.end ?? item.start) < today)
        : [],
    [shown, workspace, win, inYear, settings?.pointEventMinutes, me, today],
  );
  const byDay = useMemo(
    () => (win ? itemsByDay(items, win.from, win.to) : new Map<string, CalendarItem[]>()),
    [items, win],
  );
  // Only the years drawn are worked out, each once until the tasks change: many years must not
  // slow it down, and shading each against itself keeps a day's shade from moving as it scrolls.
  const heatOf = useMemo(() => {
    const years = new Map<string, YearHeat>();
    return (year: string) => {
      let heat = years.get(year);
      if (!heat) {
        const [from, to] = [`${year}-01-01`, `${year}-12-31`];
        const counts = openCountsByDay(
          calendarItems(shown, from, to, settings?.pointEventMinutes ?? 60),
          from,
          to,
        );
        heat = { counts, scale: heatScale(counts.values()) };
        years.set(year, heat);
      }
      return heat;
    };
  }, [shown, settings?.pointEventMinutes]);

  const [drawer, setDrawer] = useState(false);
  const [popup, setPopup] = useState<{
    day: string;
    time: string | null;
    anchor: HTMLElement;
  } | null>(null);
  const [range, setRange] = useState<{ first: string; last: string; x: number; y: number } | null>(
    null,
  );

  // Undoable like a move in a list (R-FB-100).
  const schedule = (taskId: string, next: Schedule, label = t('undo.moved')) =>
    apply((ctx, ws) => updateTask(ctx, ws, taskId, { schedule: next }), label);
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

  // A task dragged onto a whole day (any day on the month, the all-day row in Days): that day is
  // outlined, so it is plain where it lands (R-FB-78).
  const dropDay =
    drag.ghost?.target && (mode === 'month' || drag.ghost.target.minutes === null)
      ? drag.ghost.target.day
      : null;

  // A task dragged over a time in Days: where it would land, at its own length.
  const preview = (() => {
    const target = drag.ghost?.target;
    if (mode !== 'days' || !drag.ghost || !target || target.minutes === null) return null;
    const task = workspace.entities.tasks.find((each) => each.id === drag.ghost!.taskId);
    if (!task) return null;
    const point = settings?.pointEventMinutes ?? 60;
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

  // Where Year was left, to come back to from a day or a month it opened. Not kept past this visit
  // to the calendar, and Today or a picked date, asked for anywhere here, go ahead of it.
  const [yearLeft, setYearLeft] = useState<YearStay | null>(null);
  const goToday = () => {
    setYearLeft(null);
    setDate(today);
    setTarget({ date: today, seq: target.seq + 1 });
  };
  // The title picks a date to go to, as Upcoming's does (R-FB-71).
  const [picker, setPicker] = useState<HTMLElement | null>(null);
  const goTo = (day: string) => {
    setPicker(null);
    setDate(day);
    setTarget({ date: day, seq: target.seq + 1 });
  };
  const pickDate = (day: string) => {
    setYearLeft(null);
    goTo(day);
  };
  const step = (direction: 1 | -1) => {
    if (mode === 'month') {
      const month = view?.month ?? today.slice(0, 7);
      setTarget({ date: shiftMonths(`${month}-01`, direction), seq: target.seq + 1 });
    } else if (mode === 'year') {
      const next = shiftMonths(date, direction * 12);
      setDate(next);
      setTarget({ date: `${next.slice(0, 4)}-01-01`, seq: target.seq + 1 });
    } else {
      setDate(addDays(date, direction * prefs.days));
    }
  };
  const showDays = (first: string, count: number) => {
    setDate(first);
    setPrefs({ mode: 'days', days: Math.min(MAX_DAYS, Math.max(MIN_DAYS, count)) });
  };
  const switchMode = (next: CalendarMode) => {
    // Days and Year start where the month is looking; the month comes back to the day they left.
    if (mode === 'month' && view) {
      setDate(view.month === today.slice(0, 7) ? today : `${view.month}-01`);
    }
    if (next === 'month') setTarget({ date, seq: target.seq + 1 });
    setPrefs({ mode: next });
  };
  // Keeps the Days count picked last: the day comes first, with the days after it beside it.
  const openDay = (day: string) => {
    setDate(day);
    setPrefs({ mode: 'days' });
  };
  // The title follows the year scrolled to, and Month and the arrows carry on from it.
  const followYear = (shownYear: string) =>
    setDate((day) => shiftMonths(day, (Number(shownYear) - Number(day.slice(0, 4))) * 12));
  const openMonth = (month: string) => {
    goTo(`${month}-01`);
    setPrefs({ mode: 'month' });
  };

  const titleDate = mode === 'month' ? `${view?.month ?? today.slice(0, 7)}-01` : date;
  const title = calendarTitle(mode, titleDate, prefs.days, today, undefined, narrow);
  // A phone's short title can leave the year off days; their label keeps it.
  const labelTitle = mode === 'days' ? calendarTitle(mode, titleDate, prefs.days, today) : title;
  const panel = (
    <Unscheduled
      source={shown}
      onOpen={open}
      onGrab={(event, payload) => drag.begin(event, payload)}
    />
  );

  return (
    <Page
      title={t('nav.calendar')}
      actions={
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          {narrowButton}
          {/* Upcoming is in the menu; no shortcut to it here (R-FB-101). Unscheduled is an icon
              (R-FB-104): here a sheet on a phone; elsewhere a toggle in the calendar's row. */}
          {phone && (
            <Tooltip title={t('calendar.unscheduled')}>
              {/* Hidden rather than gone in Year, so the buttons beside it stay where they are. */}
              <IconButton
                aria-label={t('calendar.unscheduled')}
                onClick={() => setDrawer(true)}
                sx={inYear ? { visibility: 'hidden' } : {}}
              >
                <EventBusyOutlined />
              </IconButton>
            </Tooltip>
          )}
        </Box>
      }
    >
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          // What the bars and the page's padding take: more on a phone, with its tabs below.
          height: narrow ? 'calc(100dvh - 153px)' : 'calc(100dvh - 140px)',
          // Year scrolls for itself and has no end, so the page around it never needs to.
          minHeight: inYear ? 0 : 420,
        }}
      >
        {/* One row that never wraps, so nothing moves as the title changes length. Laid out as
            Upcoming's (R-FB-72): the title (a date picker) left, the arrows round the today icon
            at the right, the dial and Year/Month/Days between (Year has no dial, and the title
            just takes its room). */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: { xs: 0.25, sm: 0.5 }, mb: 1 }}>
          <Typography
            component="h2"
            aria-live="polite"
            noWrap
            sx={{ flexGrow: 1, minWidth: 0, display: 'flex' }}
          >
            <Button
              size="small"
              color="inherit"
              aria-haspopup="dialog"
              aria-label={t('calendar.pickDate', { title: labelTitle })}
              onClick={(event) => setPicker(event.currentTarget)}
              endIcon={<ChevronDownIcon fontSize="small" />}
              sx={{
                ...dateHeading,
                px: 0.5,
                minWidth: 0,
                maxWidth: '100%',
                justifyContent: 'flex-start',
                '& > span:first-of-type': { overflow: 'hidden', textOverflow: 'ellipsis' },
                '& .MuiButton-endIcon': { ml: { xs: 0.25, sm: 1 } },
              }}
            >
              <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {title}
              </Box>
            </Button>
          </Typography>
          {mode === 'days' && (
            <NumberDial
              values={DAY_CHOICES}
              value={prefs.days}
              onChange={(days) => setPrefs({ days })}
              label={t('calendar.daysShown')}
              caption={(count) =>
                count === 1 ? t('calendar.oneDay') : t('calendar.dayCount', { count })
              }
            />
          )}
          {mode === 'month' && (
            <NumberDial
              values={WEEK_CHOICES}
              value={prefs.weeks}
              onChange={(weeks) => setPrefs({ weeks })}
              label={t('calendar.weeksShown')}
              caption={(count) => t('calendar.weeks', { count })}
            />
          )}
          {!phone && !inYear && (
            // The side panel, shown or hidden (hidden at first), beside the view's own buttons.
            <Tooltip
              title={
                prefs.unscheduled ? t('calendar.hideUnscheduled') : t('calendar.showUnscheduled')
              }
            >
              <ToggleButton
                value="unscheduled"
                size="small"
                selected={prefs.unscheduled}
                aria-label={t('calendar.unscheduled')}
                onChange={() => setPrefs({ unscheduled: !prefs.unscheduled })}
                sx={{ flexShrink: 0, px: 0.75 }}
              >
                <EventBusyOutlined fontSize="small" />
              </ToggleButton>
            </Tooltip>
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
              value="year"
              aria-label={t('calendar.year')}
              sx={{ px: narrow ? 0.5 : phone ? 0.75 : 1.5 }}
            >
              {phone ? <YearViewIcon fontSize="small" /> : t('calendar.year')}
            </ToggleButton>
            <ToggleButton
              value="month"
              aria-label={t('calendar.month')}
              sx={{ px: narrow ? 0.5 : phone ? 0.75 : 1.5 }}
            >
              {phone ? <MonthViewIcon fontSize="small" /> : t('calendar.month')}
            </ToggleButton>
            <ToggleButton
              value="days"
              aria-label={t('calendar.days')}
              sx={{ px: narrow ? 0.5 : phone ? 0.75 : 1.5 }}
            >
              {phone ? <DaysViewIcon fontSize="small" /> : t('calendar.days')}
            </ToggleButton>
          </ToggleButtonGroup>
          <IconButton size="small" aria-label={t('calendar.previous')} onClick={() => step(-1)}>
            <ChevronLeftIcon fontSize="small" />
          </IconButton>
          <Tooltip title={t('calendar.goToday')}>
            <IconButton size="small" onClick={goToday} aria-label={t('calendar.goToday')}>
              {/* The plain circle the date pickers use (R-FB-87). */}
              <RadioButtonUncheckedRounded sx={{ fontSize: 12 }} />
            </IconButton>
          </Tooltip>
          <IconButton size="small" aria-label={t('calendar.next')} onClick={() => step(1)}>
            <ChevronRightIcon fontSize="small" />
          </IconButton>
        </Box>
        <MonthPickerPopover
          anchor={picker}
          onClose={() => setPicker(null)}
          selected={mode === 'month' && view ? `${view.month}-01` : date}
          today={today}
          weekStartsOn={preferredWeekStart()}
          onSelect={pickDate}
        />
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
            {mode === 'year' ? (
              <YearView
                date={date}
                left={yearLeft}
                target={target}
                today={today}
                weekStart={weekStart}
                heatOf={heatOf}
                onOpenDay={openDay}
                onOpenMonth={openMonth}
                onYear={followYear}
                onLeave={setYearLeft}
              />
            ) : mode === 'month' ? (
              <MonthView
                today={today}
                weekStart={weekStart}
                weeks={prefs.weeks}
                target={target}
                byDay={byDay}
                onView={setView}
                onOpenTask={(id, on) => open(id, on ? { on } : undefined)}
                onOpenDay={(day, anchor) => setPopup({ day, time: null, anchor })}
                onRange={(first, last, point) => setRange({ first, last, ...point })}
                rangeOpen={range !== null}
                onGrab={(event, item) => grabItem(event, item)}
                dropDay={dropDay}
              />
            ) : (
              <DaysView
                start={date}
                count={prefs.days}
                today={today}
                byDay={byDay}
                hourHeight={prefs.hourHeight}
                onHourHeight={(hourHeight) => setPrefs({ hourHeight })}
                onOpenTask={(id, on) => open(id, on ? { on } : undefined)}
                onOpenDay={(day, anchor) => setPopup({ day, time: null, anchor })}
                onSlot={(day, minutes, anchor) =>
                  setPopup({ day, time: atMinutes(day, minutes).slice(11), anchor })
                }
                onPage={step}
                onGrab={grabItem}
                preview={preview}
                dropDay={dropDay}
                onResize={(item, start, end) => {
                  const task = workspace.entities.tasks.find((each) => each.id === item.taskId);
                  if (!task?.schedule) return;
                  schedule(
                    task.id,
                    placedSchedule(task.schedule, { start, end, allDay: false }, zone),
                    t('undo.timeChanged'),
                  );
                }}
              />
            )}
          </Box>
          {!phone && !inYear && prefs.unscheduled && (
            <Box sx={{ borderLeft: 1, borderColor: 'divider' }}>{panel}</Box>
          )}
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
          onOpenTask={(id, on) => open(id, on ? { on } : undefined)}
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
            // Under and right of a mouse; well above a finger, centred on it (R-FB-140).
            ...(drag.ghost.touch
              ? {
                  left: Math.min(Math.max(drag.ghost.x, 128), window.innerWidth - 128),
                  top: drag.ghost.y - 48,
                  transform: 'translate(-50%, -100%)',
                }
              : { left: drag.ghost.x + 12, top: drag.ghost.y + 12 }),
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
