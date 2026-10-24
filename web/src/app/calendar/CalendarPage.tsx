import {
  Box,
  Button,
  Drawer,
  IconButton,
  ToggleButton,
  ToggleButtonGroup,
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
} from '../../core/calendar.ts';
import { addDays, localTimeZone, shiftMonths } from '../../core/dates.ts';
import { canEditTask } from '../../core/sharing.ts';
import { updateTask } from '../../core/tasks.ts';
import type { Schedule } from '../../core/types.ts';
import type { CalendarMode } from '../../ports/calendarView.ts';
import { useToday } from '../hooks/useToday.ts';
import { ChevronLeftIcon, ChevronRightIcon } from '../icons/icons.tsx';
import { t } from '../i18n/i18n.ts';
import { Page } from '../layout/Page.tsx';
import { useApply, useStoreState, useWorkspace } from '../store/hooks.ts';
import { useTaskSelection } from '../tasks/selection.ts';
import { calendarTitle } from './calendarTitle.ts';
import { FullCalendarView } from './FullCalendarView.tsx';

const MODE_KEY = 'punchlist.calendar.mode';
const MODES: CalendarMode[] = ['month', 'week', 'day'];

function savedMode(): CalendarMode {
  try {
    const value = localStorage.getItem(MODE_KEY);
    return MODES.find((mode) => mode === value) ?? 'month';
  } catch {
    return 'month';
  }
}

/** A day and view the address asks for (`?view=day&date=2026-10-23`, from the mini calendar). */
function askedFor(params: URLSearchParams): { date: string | null; mode: CalendarMode | null } {
  const date = params.get('date');
  const view = params.get('view');
  return {
    date: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
    mode: MODES.find((mode) => mode === view) ?? null,
  };
}

/** How many unscheduled tasks show at first (and more on asking). */
const UNSCHEDULED_PAGE = 100;

/** Open tasks with no date, to drag onto the calendar. */
function Unscheduled({
  onRef,
  onOpen,
}: {
  onRef: (element: HTMLElement | null) => void;
  onOpen: (id: string) => void;
}) {
  const workspace = useWorkspace();
  const tasks = unscheduledTasks(workspace);
  const [limit, setLimit] = useState(UNSCHEDULED_PAGE);
  return (
    <Box sx={{ width: 260, p: 1.5, overflowY: 'auto', height: '100%' }}>
      <Typography variant="subtitle2" color="text.secondary">
        {t('calendar.unscheduled')}
      </Typography>
      <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 1 }}>
        {t('calendar.unscheduledHint')}
      </Typography>
      <Box ref={onRef} role="list" aria-label={t('calendar.unscheduled')}>
        {tasks.slice(0, limit).map((task) => (
          <Box
            key={task.id}
            role="listitem"
            data-task-id={task.id}
            data-title={task.title}
            onClick={() => onOpen(task.id)}
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
          <Button
            size="small"
            onClick={() => setLimit((current) => current + UNSCHEDULED_PAGE)}
            sx={{ textTransform: 'none' }}
          >
            {t('tasks.showMore', { count: Math.min(tasks.length - limit, UNSCHEDULED_PAGE) })}
          </Button>
        )}
      </Box>
    </Box>
  );
}

/**
 * Calendar (spec: Calendar rendering): month, week and day, moving and resizing what is on it,
 * and dragging unscheduled tasks in from the side (a drawer on phones).
 */
export function CalendarPage() {
  const theme = useTheme();
  const phone = useMediaQuery(theme.breakpoints.down('md'));
  const workspace = useWorkspace();
  const apply = useApply();
  const me = useStoreState((state) => state.context().userId);
  const { open } = useTaskSelection();
  const zone = localTimeZone();
  const today = useToday(zone);
  const settings = workspace.entities.settings[0];
  const weekStart = settings?.weekStart ?? 0;
  const [params] = useSearchParams();
  const asked = askedFor(params);
  const [mode, setMode] = useState<CalendarMode>(() => asked.mode ?? savedMode());
  const [date, setDate] = useState(() => asked.date ?? today);
  // Asked again while already here (another day picked in the mini calendar): go there.
  const [seen, setSeen] = useState(params.toString());
  if (params.toString() !== seen) {
    setSeen(params.toString());
    if (asked.date) setDate(asked.date);
    if (asked.mode) setMode(asked.mode);
  }
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [source, setSource] = useState<HTMLElement | null>(null);
  const [drawer, setDrawer] = useState(false);

  const items = useMemo(
    () =>
      range
        ? calendarItems(
            workspace,
            range.from,
            range.to,
            settings?.pointEventMinutes ?? 30,
            (task) => canEditTask(workspace, me, task),
          )
        : [],
    [workspace, range, settings?.pointEventMinutes, me],
  );

  const changeMode = (next: CalendarMode) => {
    setMode(next);
    try {
      localStorage.setItem(MODE_KEY, next);
    } catch {
      // Remembering the mode is a nicety.
    }
  };
  const step = (direction: 1 | -1) =>
    setDate(
      mode === 'month'
        ? shiftMonths(date, direction)
        : addDays(date, direction * (mode === 'week' ? 7 : 1)),
    );

  const schedule = (taskId: string, next: Schedule) =>
    apply((ctx, ws) => updateTask(ctx, ws, taskId, { schedule: next }));

  const panel = <Unscheduled onRef={setSource} onOpen={open} />;

  return (
    <Page
      title={t('nav.calendar')}
      actions={
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
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
            onClick={() => setDate(today)}
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
            {calendarTitle(mode, date, weekStart, today)}
          </Typography>
          <ToggleButtonGroup
            exclusive
            size="small"
            value={mode}
            onChange={(_, next: CalendarMode | null) => next && changeMode(next)}
            aria-label={t('calendar.mode')}
          >
            {MODES.map((each) => (
              <ToggleButton key={each} value={each} sx={{ textTransform: 'none', px: 1.5 }}>
                {t(`calendar.${each}`)}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        </Box>
        <Box sx={{ display: 'flex', flexGrow: 1, minHeight: 0, gap: 1 }}>
          <Box sx={{ flexGrow: 1, minWidth: 0 }}>
            <FullCalendarView
              mode={mode}
              date={date}
              items={items}
              weekStart={weekStart}
              clock={settings?.clockFormat ?? '12h'}
              onRange={(from, to) =>
                setRange((current) =>
                  current?.from === from && current.to === to ? current : { from, to },
                )
              }
              onOpen={open}
              onPlace={(taskId, placement) => {
                const task = workspace.entities.tasks.find((each) => each.id === taskId);
                schedule(taskId, placedSchedule(task?.schedule ?? null, placement, zone));
              }}
              onDrop={(taskId, day, time) => {
                schedule(taskId, droppedSchedule(day, time, zone));
                setDrawer(false);
              }}
              dragSource={source}
            />
          </Box>
          {!phone && <Box sx={{ borderLeft: 1, borderColor: 'divider' }}>{panel}</Box>}
        </Box>
      </Box>
      {phone && (
        <Drawer anchor="bottom" open={drawer} onClose={() => setDrawer(false)} keepMounted>
          <Box sx={{ maxHeight: '50dvh' }}>{panel}</Box>
        </Drawer>
      )}
    </Page>
  );
}
