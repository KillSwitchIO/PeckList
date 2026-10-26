import AddRounded from '@mui/icons-material/AddRounded';
import { Box, Button, IconButton, Popover, Tooltip, Typography } from '@mui/material';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { agendaDays } from '../../core/agenda.ts';
import { addDays, daysBetween, localTimeZone, weekday } from '../../core/dates.ts';
import { inboxList } from '../../core/lists.ts';
import { orderTasks, type ListSort } from '../../core/listView.ts';
import { todayGroups } from '../../core/queries.ts';
import { pinnedFirst } from '../../core/tasks.ts';
import type { Task, WorkspaceFile } from '../../core/types.ts';
import { weekStart as preferredWeekStart } from '../format.ts';
import { useToday } from '../hooks/useToday.ts';
import { t } from '../i18n/i18n.ts';
import {
  CalendarIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from '../icons/icons.tsx';
import { MonthCalendar } from '../dates/MonthCalendar.tsx';
import { Page } from '../layout/Page.tsx';
import { monthTitle } from '../layout/miniCalendarText.ts';
import { useWorkspace } from '../store/hooks.ts';
import { AddTaskInput } from '../tasks/AddTaskInput.tsx';
import { TaskTree } from '../tasks/TaskTree.tsx';
import { dayTitle, hasOwnDate } from './dayLabels.ts';
import { GroupSection } from './GroupSection.tsx';
import { PinnedGroup, PostponeButton } from './groups.tsx';
import { WeekStrip } from './WeekStrip.tsx';
import { TaskDragProvider } from '../tasks/drag/TaskDrag.tsx';

/** Days loaded at first, and how many more each time the end comes near. */
const DAYS = 14;
const MORE_DAYS = 14;
/** The list stops growing here (two years of days). */
const MAX_DAYS = 730;
/** Start loading more while the end is still this far below the screen. */
const AHEAD_PX = 800;

/** The first day of the week holding `date`, starting on `weekStart` (0 Sunday). */
function startOfWeek(date: string, weekStart: number): string {
  return addDays(date, -((weekday(date) - weekStart + 7) % 7));
}

/** The nearest ancestor that scrolls up and down, or null for the window. */
function scrollParent(element: HTMLElement | null): HTMLElement | null {
  for (let at = element?.parentElement; at; at = at.parentElement) {
    const { overflowY } = getComputedStyle(at);
    if (overflowY === 'auto' || overflowY === 'scroll') return at;
  }
  return null;
}

/**
 * Upcoming, like Todoist's (spec: PL-091, R-FB-47, R-FB-48): a strip of the week's days on top,
 * then every day from today (or an earlier day picked) on, with what starts on it, empty days
 * included, each with its own add button. More days load as the end comes near; the strip
 * follows the day at the top, and swiping it or picking a day moves the list there. Overdue
 * tasks head today; pinned ones head everything. Opening it always starts on today.
 */
export function AgendaView({
  sort,
  reversed = false,
  actions,
  source,
}: {
  sort: ListSort;
  reversed?: boolean;
  actions: ReactNode;
  /** The tasks to draw from (narrowed by the view's filter) */
  source: WorkspaceFile;
}) {
  const sorted = (tasks: Task[], by: ListSort) => orderTasks(tasks, by, reversed);
  const workspace = useWorkspace();
  const today = useToday();
  const weekStart = preferredWeekStart();
  const thisWeek = startOfWeek(today, weekStart);
  // The list's first day (today, or an earlier day picked), how many days are loaded, the day
  // at the top of the screen, and the week the strip shows.
  const [start, setStart] = useState(today);
  const [count, setCount] = useState(DAYS);
  const [focus, setFocus] = useState(today);
  const [week, setWeek] = useState(thisWeek);
  // Whether the strip slides to a new week (asked for) or jumps (following the list).
  const [sliding, setSliding] = useState(true);
  const [jump, setJump] = useState<{ date: string | null; seq: number }>({ date: null, seq: 0 });
  const [adding, setAdding] = useState<string | null>(null);
  const [picker, setPicker] = useState<HTMLElement | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const header = useRef<HTMLDivElement>(null);
  const end = useRef<HTMLDivElement>(null);
  // Right after a jump the list sits where it was put: no tracking until it has.
  const jumping = useRef(false);
  const fromToday = start === today;
  const days = agendaDays(source, today, start, count);
  const overdue = fromToday ? todayGroups(source, today).overdue : [];
  const { pinned } = pinnedFirst([...overdue, ...days.flatMap((day) => day.tasks)]);
  const late = sorted(pinnedFirst(overdue).rest, sort);
  const inbox = inboxList(workspace).id;
  const zone = localTimeZone();
  const busyIn = (from: string) =>
    new Set(
      agendaDays(source, today, from, 7)
        .filter((day) => day.tasks.length > 0)
        .map((day) => day.date),
    );

  /** Put `date` at the top of the list, starting the list there when it is earlier. */
  const goTo = (date: string) => {
    const last = addDays(start, count);
    const first = date < start ? date : start;
    setStart(first);
    setCount(
      Math.min(MAX_DAYS, Math.max(daysBetween(first, last), daysBetween(first, date) + DAYS)),
    );
    setFocus(date);
    setSliding(true);
    setWeek(startOfWeek(date, weekStart));
    setJump({ date, seq: jump.seq + 1 });
  };
  const goToday = () => {
    setStart(today);
    setCount(DAYS);
    setFocus(today);
    setSliding(true);
    setWeek(thisWeek);
    // The top of the page: the overdue tasks above today too.
    setJump({ date: null, seq: jump.seq + 1 });
  };
  /** The strip moved to the week from `first`: the list goes to the same weekday there. */
  const toWeek = (first: string) => {
    setSliding(true);
    goTo(addDays(first, Math.max(0, Math.min(6, daysBetween(week, focus)))));
  };

  useLayoutEffect(() => {
    if (jump.seq === 0) return;
    jumping.current = true;
    const scroller = scrollParent(root.current);
    if (jump.date === null) {
      if (scroller) scroller.scrollTop = 0;
      else window.scrollTo(0, 0);
    } else {
      // Just under the strip, where it sticks once the page has scrolled.
      const section = document.getElementById(`agenda-${jump.date}`);
      const bar = header.current;
      if (section && bar) {
        const stuck = (parseFloat(getComputedStyle(bar).top) || 0) + bar.offsetHeight;
        const by = section.getBoundingClientRect().top - stuck;
        if (scroller) scroller.scrollBy(0, by);
        else window.scrollBy(0, by);
      }
    }
    const timer = setTimeout(() => {
      jumping.current = false;
    }, 250);
    return () => clearTimeout(timer);
  }, [jump]);

  // The day at the top of the list (under the strip) is the strip's day.
  useEffect(() => {
    const scroller = scrollParent(root.current);
    const target: HTMLElement | Window = scroller ?? window;
    let frame = 0;
    const track = () => {
      frame = 0;
      if (jumping.current || !root.current || !header.current) return;
      const line = header.current.getBoundingClientRect().bottom + 1;
      const sections = root.current.querySelectorAll<HTMLElement>('[data-agenda-day]');
      for (const section of sections) {
        if (section.getBoundingClientRect().bottom > line) {
          const date = section.dataset.agendaDay!;
          setFocus(date);
          // Following the list: the strip keeps up at once, no slide.
          setSliding(false);
          setWeek(startOfWeek(date, weekStart));
          return;
        }
      }
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(track);
    };
    target.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      target.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(frame);
    };
  }, [weekStart]);

  // More days as the end comes near.
  const more = count < MAX_DAYS;
  useEffect(() => {
    const element = end.current;
    if (!element || !more || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) setCount((now) => Math.min(MAX_DAYS, now + MORE_DAYS));
      },
      { root: scrollParent(root.current), rootMargin: `0px 0px ${AHEAD_PX}px 0px` },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [count, more]);

  return (
    <Page title={t('nav.upcoming')} actions={actions}>
      <Box ref={root}>
        <AddTaskInput
          defaults={{
            listId: inbox,
            schedule: { start: today, end: null, allDay: true, timeZone: zone },
          }}
        />
        <Box
          ref={header}
          sx={{
            position: 'sticky',
            top: { xs: 56, sm: 64 },
            zIndex: 2,
            bgcolor: 'background.default',
            pb: 1,
            borderBottom: 1,
            borderColor: 'divider',
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Box sx={{ flexGrow: 1, minWidth: 0 }}>
              <Button
                size="small"
                color="inherit"
                aria-haspopup="dialog"
                aria-label={t('agenda.pickDay', { month: monthTitle(week, today) })}
                onClick={(event) => setPicker(event.currentTarget)}
                endIcon={<ChevronDownIcon fontSize="small" />}
                sx={{ fontWeight: 600, typography: 'subtitle2', px: 0.5, minWidth: 0 }}
              >
                {monthTitle(week, today)}
              </Button>
            </Box>
            <IconButton
              size="small"
              aria-label={t('agenda.previousWeek')}
              onClick={() => toWeek(addDays(week, -7))}
            >
              <ChevronLeftIcon fontSize="small" />
            </IconButton>
            <Tooltip title={t('calendar.goToday')}>
              <span>
                <IconButton
                  size="small"
                  aria-label={t('calendar.goToday')}
                  disabled={fromToday && focus === today && week === thisWeek}
                  onClick={goToday}
                >
                  <CalendarIcon badge={String(Number(today.slice(8, 10)))} />
                </IconButton>
              </span>
            </Tooltip>
            <IconButton
              size="small"
              aria-label={t('agenda.nextWeek')}
              onClick={() => toWeek(addDays(week, 7))}
            >
              <ChevronRightIcon fontSize="small" />
            </IconButton>
          </Box>
          <WeekStrip
            week={week}
            slide={sliding}
            thisWeek={thisWeek}
            today={today}
            focus={focus}
            busyIn={busyIn}
            onSwipe={(first) => {
              if (first !== week) toWeek(first);
            }}
            onPick={goTo}
          />
        </Box>
        <Popover
          open={picker !== null}
          anchorEl={picker}
          onClose={() => setPicker(null)}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
          slotProps={{ paper: { sx: { p: 1, width: 300 } } }}
        >
          <MonthCalendar
            selected={focus}
            today={today}
            weekStartsOn={weekStart}
            onSelect={(date) => {
              setPicker(null);
              goTo(date);
            }}
          />
        </Popover>

        <TaskDragProvider>
          <PinnedGroup tasks={pinned} showList />
          {late.length > 0 && (
            <GroupSection
              groupKey="overdue"
              title={t('group.overdue')}
              count={late.length}
              actions={<PostponeButton tasks={late} today={today} />}
            >
              <TaskTree tasks={late} showList ownPlace={hasOwnDate} dragZone={{ group: null }} />
            </GroupSection>
          )}
          {days.map((day) => {
            const tasks = sorted(pinnedFirst(day.tasks).rest, sort);
            const title = dayTitle(day.date, today);
            return (
              <Box
                key={day.date}
                id={`agenda-${day.date}`}
                data-agenda-day={day.date}
                sx={{ scrollMarginTop: 180 }}
              >
                <GroupSection
                  groupKey={
                    day.date === today
                      ? 'today'
                      : day.date === addDays(today, 1)
                        ? 'tomorrow'
                        : `day:${day.date}`
                  }
                  title={title}
                  count={tasks.length}
                  actions={
                    <Tooltip title={t('agenda.addTo', { day: title })}>
                      <IconButton
                        size="small"
                        aria-label={t('agenda.addTo', { day: title })}
                        aria-pressed={adding === day.date}
                        onClick={() => setAdding(adding === day.date ? null : day.date)}
                      >
                        <AddRounded fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  }
                >
                  {adding === day.date && (
                    <AddTaskInput
                      autoFocus
                      defaults={{
                        listId: inbox,
                        schedule: { start: day.date, end: null, allDay: true, timeZone: zone },
                      }}
                      label={t('agenda.addTo', { day: title })}
                    />
                  )}
                  {tasks.length > 0 ? (
                    <TaskTree
                      tasks={tasks}
                      showList
                      ownPlace={hasOwnDate}
                      dragZone={{ group: { kind: 'date', value: day.date } }}
                    />
                  ) : (
                    adding !== day.date && (
                      <Typography variant="body2" color="text.disabled" sx={{ px: 1, pb: 0.5 }}>
                        {t('agenda.nothing')}
                      </Typography>
                    )
                  )}
                </GroupSection>
              </Box>
            );
          })}
        </TaskDragProvider>
        <Box ref={end} sx={{ textAlign: 'center', py: 2 }}>
          {more && typeof IntersectionObserver === 'undefined' && (
            <Button size="small" onClick={() => setCount(Math.min(MAX_DAYS, count + MORE_DAYS))}>
              {t('agenda.showMore')}
            </Button>
          )}
        </Box>
      </Box>
    </Page>
  );
}
