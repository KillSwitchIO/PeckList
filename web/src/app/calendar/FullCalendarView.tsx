// The CalendarView adapter for FullCalendar (MIT, standard plugins only): month on the day grid,
// week and day on the time grid, drag and resize, and drop-in from outside the calendar.

import type { DatesSetArg, EventContentArg, EventDropArg, EventInput } from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin, {
  Draggable,
  type DropArg,
  type EventResizeDoneArg,
} from '@fullcalendar/interaction';
import FullCalendar from '@fullcalendar/react';
import timeGridPlugin from '@fullcalendar/timegrid';
import { Box, alpha, useTheme } from '@mui/material';
import { useEffect, useMemo, useRef } from 'react';
import type { CalendarItem } from '../../core/calendar.ts';
import { addDays } from '../../core/dates.ts';
import type { CalendarMode, CalendarViewProps } from '../../ports/calendarView.ts';
import { DueIcon } from '../icons/icons.tsx';
import { t } from '../i18n/i18n.ts';

const VIEWS: Record<CalendarMode, string> = {
  month: 'dayGridMonth',
  week: 'timeGridWeek',
  day: 'timeGridDay',
};

const two = (n: number) => String(n).padStart(2, '0');

/** A Date (FullCalendar works in local time) as our wall-clock text. */
function wall(date: Date, allDay: boolean): string {
  const day = `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
  return allDay ? day : `${day}T${two(date.getHours())}:${two(date.getMinutes())}`;
}

function toEvent(item: CalendarItem): EventInput {
  // FullCalendar's all-day ends are exclusive; ours are the last day.
  const end = item.allDay ? (item.end ? addDays(item.end, 1) : null) : item.end;
  return {
    id: item.id,
    title: item.title,
    start: item.start,
    ...(end ? { end } : {}),
    allDay: item.allDay,
    editable: item.movable,
    durationEditable: item.movable && item.kind === 'schedule',
    backgroundColor: item.kind === 'due' ? 'transparent' : item.color,
    borderColor: item.kind === 'due' ? 'transparent' : item.color,
    classNames: [`pl-${item.kind}`, item.done ? 'pl-done' : ''],
    extendedProps: { item },
  };
}

const PRIORITY_KEY = { 1: 'low', 2: 'medium', 3: 'high' } as const;

function Content({ arg }: { arg: EventContentArg }) {
  const theme = useTheme();
  const item = arg.event.extendedProps.item as CalendarItem;
  if (item.kind === 'due') {
    return (
      <Box
        component="span"
        title={t('calendar.dueFlag', { title: item.title })}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.25,
          color: 'text.secondary',
          overflow: 'hidden',
          fontSize: 12,
        }}
      >
        <DueIcon sx={{ fontSize: 13, flexShrink: 0 }} />
        <Box
          component="span"
          sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >
          {item.title}
        </Box>
      </Box>
    );
  }
  return (
    <Box
      component="span"
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.5,
        overflow: 'hidden',
        fontSize: 12,
        px: 0.25,
        textDecoration: item.done ? 'line-through' : 'none',
        opacity: item.done ? 0.6 : 1,
      }}
    >
      {item.priority > 0 && (
        <Box
          component="span"
          aria-hidden
          sx={{
            width: 7,
            height: 7,
            flexShrink: 0,
            borderRadius: '50%',
            border: 2,
            borderColor: theme.punchlist.priority[PRIORITY_KEY[item.priority as 1 | 2 | 3]].fill,
          }}
        />
      )}
      {arg.timeText && !arg.event.allDay && (
        <Box component="span" sx={{ flexShrink: 0, opacity: 0.75 }}>
          {arg.timeText}
        </Box>
      )}
      <Box
        component="span"
        sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
      >
        {item.title}
      </Box>
    </Box>
  );
}

export function FullCalendarView({
  mode,
  date,
  items,
  weekStart,
  clock,
  onRange,
  onOpen,
  onPlace,
  onDrop,
  dragSource,
}: CalendarViewProps) {
  const theme = useTheme();
  const ref = useRef<FullCalendar>(null);
  const events = useMemo(() => items.map(toEvent), [items]);

  // Follow the page's mode and date.
  useEffect(() => {
    ref.current?.getApi().changeView(VIEWS[mode], date);
  }, [mode, date]);

  // Tasks dragged in from the panel: FullCalendar only reports where they land (no event is made).
  useEffect(() => {
    if (!dragSource) return;
    const draggable = new Draggable(dragSource, {
      itemSelector: '[data-task-id]',
      eventData: (element) => ({
        title: element.getAttribute('data-title') ?? '',
        create: false,
        duration: '00:30',
      }),
    });
    return () => draggable.destroy();
  }, [dragSource]);

  const hour12 = clock === '12h';
  const timeFormat = {
    hour: 'numeric',
    minute: '2-digit',
    hour12,
    meridiem: hour12 ? 'short' : false,
  } as const;

  return (
    <Box
      sx={{
        height: '100%',
        '--fc-border-color': theme.palette.divider,
        '--fc-page-bg-color': theme.palette.background.default,
        '--fc-neutral-bg-color': theme.palette.action.hover,
        '--fc-today-bg-color': alpha(theme.palette.primary.main, 0.08),
        // List colors are pastels: dark neutral text reads on them in light and dark mode alike.
        '--fc-event-text-color': '#1F2328',
        '--fc-now-indicator-color': theme.palette.error.main,
        '& .fc': { fontFamily: theme.typography.fontFamily, fontSize: 13 },
        '& .fc .fc-event': { cursor: 'pointer' },
        '& .fc .pl-schedule, & .fc .pl-schedule *': { color: '#1F2328' },
        '& .fc .fc-col-header-cell-cushion, & .fc .fc-daygrid-day-number': {
          color: theme.palette.text.secondary,
          textDecoration: 'none',
        },
      }}
    >
      <FullCalendar
        ref={ref}
        plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
        initialView={VIEWS[mode]}
        initialDate={date}
        headerToolbar={false}
        height="100%"
        firstDay={weekStart}
        nowIndicator
        dayMaxEvents
        editable
        droppable
        events={events}
        eventTimeFormat={timeFormat}
        slotLabelFormat={timeFormat}
        allDayText={t('calendar.allDay')}
        eventContent={(arg) => <Content arg={arg} />}
        datesSet={(arg: DatesSetArg) =>
          onRange(wall(arg.start, true), addDays(wall(arg.end, true), -1))
        }
        eventClick={(arg) => onOpen((arg.event.extendedProps.item as CalendarItem).taskId)}
        eventDrop={(arg: EventDropArg) => {
          const item = arg.event.extendedProps.item as CalendarItem;
          const allDay = arg.event.allDay;
          // A move keeps the length (core/calendar.placedSchedule), so no end is passed.
          onPlace(item.taskId, { start: wall(arg.event.start!, allDay), end: null, allDay }, false);
        }}
        eventResize={(arg: EventResizeDoneArg) => {
          const item = arg.event.extendedProps.item as CalendarItem;
          const allDay = arg.event.allDay;
          const end = arg.event.end;
          onPlace(
            item.taskId,
            {
              start: wall(arg.event.start!, allDay),
              end: end ? (allDay ? addDays(wall(end, true), -1) : wall(end, false)) : null,
              allDay,
            },
            true,
          );
        }}
        drop={(arg: DropArg) => {
          const taskId = arg.draggedEl.getAttribute('data-task-id');
          if (!taskId) return;
          const at = wall(arg.date, arg.allDay);
          onDrop(taskId, at.slice(0, 10), arg.allDay ? null : at.slice(11, 16));
        }}
      />
    </Box>
  );
}
