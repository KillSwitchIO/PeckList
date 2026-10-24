import { Box, ButtonBase, Typography } from '@mui/material';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CalendarItem } from '../../core/calendar.ts';
import {
  atMinutes,
  daysFrom,
  minutesOf,
  snap,
  timedBlocks,
  type TimedBlock,
} from '../../core/calendarLayout.ts';
import { datePart, localTimeZone, timePart } from '../../core/dates.ts';
import { formatDay, formatHour, formatTime } from '../format.ts';
import { t } from '../i18n/i18n.ts';
import { ItemLine } from './ItemLine.tsx';
import { MAX_HOUR, MIN_HOUR } from './calendarPrefs.ts';

const GUTTER = 44;
/** All-day lines a day shows before "+N" (the row grows when opened). */
const ALL_DAY_ROWS = 3;
const weekdayShort = new Intl.DateTimeFormat(undefined, { weekday: 'short', timeZone: 'UTC' });
const at = (day: string) => new Date(`${day}T12:00:00Z`);

/** Minutes since midnight now, in the app's zone, updated each minute. */
function useNowMinutes(): number {
  const read = () => {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: localTimeZone(),
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(new Date());
    return minutesOf(`2000-01-01T${parts}`);
  };
  const [now, setNow] = useState(read);
  useEffect(() => {
    const timer = setInterval(() => setNow(read()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/**
 * The Days view (spec: PL-093): 1 to 14 days side by side on a time grid, with an all-day row on
 * top. Pinch, or Ctrl and the wheel, makes hours taller or shorter; a swipe sideways on a phone
 * pages. A tap on an empty time adds a task there; tasks drag to another time or day, and their
 * bottom edge drags to change when they end.
 */
export function DaysView({
  start,
  count,
  today,
  byDay,
  hourHeight,
  onHourHeight,
  onOpenTask,
  onOpenDay,
  onSlot,
  onPage,
  onGrab,
  onResize,
}: {
  start: string;
  count: number;
  today: string;
  byDay: Map<string, CalendarItem[]>;
  hourHeight: number;
  onHourHeight: (height: number) => void;
  onOpenTask: (taskId: string) => void;
  onOpenDay: (day: string, anchor: HTMLElement) => void;
  onSlot: (day: string, minutes: number, anchor: HTMLElement) => void;
  onPage: (direction: 1 | -1) => void;
  onGrab: (event: React.PointerEvent<HTMLElement>, item: CalendarItem, grabMinutes: number) => void;
  onResize: (item: CalendarItem, end: string) => void;
}) {
  const days = daysFrom(start, count);
  const body = useRef<HTMLDivElement>(null);
  // How many tasks fit side by side: each wants about 44 px; more than that collapse to "+N".
  const [width, setWidth] = useState(800);
  useLayoutEffect(() => {
    const element = body.current;
    if (!element) return;
    setWidth(element.clientWidth || 800);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth || 800));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const side = Math.max(1, Math.floor((width - GUTTER) / count / 44));
  const now = useNowMinutes();
  const [allDayOpen, setAllDayOpen] = useState(false);
  const [resizing, setResizing] = useState<{ id: string; bottom: number } | null>(null);
  const height = useRef(hourHeight);
  useEffect(() => {
    height.current = hourHeight;
  });

  // Open on the working day: an hour before now when today is shown, else 7:00.
  useLayoutEffect(() => {
    const element = body.current;
    if (!element) return;
    const hour = days.includes(today) ? Math.max(0, Math.floor(now / 60) - 1) : 7;
    element.scrollTop = hour * hourHeight;
    // Only when first shown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Make hours `next` tall, keeping the time under `y` (px into the body) where it is. */
  const zoom = (next: number, y: number) => {
    const element = body.current;
    if (!element) return;
    const clamped = Math.min(MAX_HOUR, Math.max(MIN_HOUR, next));
    const minutes = ((element.scrollTop + y) / height.current) * 60;
    onHourHeight(clamped);
    requestAnimationFrame(() => {
      element.scrollTop = (minutes / 60) * clamped - y;
    });
  };
  const zoomRef = useRef(zoom);
  useEffect(() => {
    zoomRef.current = zoom;
  });
  // Ctrl and the wheel (a trackpad pinch arrives so too): taller or shorter hours, not page zoom.
  useEffect(() => {
    const element = body.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      zoomRef.current(height.current * Math.exp(-event.deltaY * 0.004), event.clientY - rect.top);
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, []);

  // Fingers on the grid: two pinch the hours; one swiped sideways pages.
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ distance: number; height: number; y: number } | null>(null);
  const swipe = useRef<{ x: number; y: number; id: number } | null>(null);
  const spread = () => {
    const [a, b] = [...touches.current.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };
  const onTouchDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'touch') return;
    touches.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (touches.current.size === 2) {
      const rect = body.current!.getBoundingClientRect();
      const [a, b] = [...touches.current.values()];
      pinch.current = { distance: spread(), height: hourHeight, y: (a!.y + b!.y) / 2 - rect.top };
      swipe.current = null;
    } else if (touches.current.size === 1) {
      swipe.current = { x: event.clientX, y: event.clientY, id: event.pointerId };
    }
  };
  const onTouchMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!touches.current.has(event.pointerId)) return;
    touches.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pinch.current && touches.current.size === 2 && pinch.current.distance > 0) {
      zoom((pinch.current.height * spread()) / pinch.current.distance, pinch.current.y);
    }
  };
  const onTouchUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!touches.current.has(event.pointerId)) return;
    touches.current.delete(event.pointerId);
    if (touches.current.size < 2) pinch.current = null;
    const begun = swipe.current;
    if (begun && begun.id === event.pointerId) {
      swipe.current = null;
      const dx = event.clientX - begun.x;
      const dy = event.clientY - begun.y;
      if (Math.abs(dx) > 60 && Math.abs(dy) < 40) onPage(dx < 0 ? 1 : -1);
    }
  };

  /** Minutes into the day at a pointer's height in a day column. */
  const minutesAt = (column: HTMLElement, y: number) =>
    ((y - column.getBoundingClientRect().top) / hourHeight) * 60;

  const tapSlot = (event: React.PointerEvent<HTMLElement>, day: string) => {
    if (event.target !== event.currentTarget || event.button !== 0) return;
    const column = event.currentTarget;
    const origin = { x: event.clientX, y: event.clientY };
    const up = (next: PointerEvent) => {
      window.removeEventListener('pointerup', up);
      if (Math.hypot(next.clientX - origin.x, next.clientY - origin.y) > 8) return;
      const minutes = Math.max(
        0,
        Math.min(1410, Math.floor(minutesAt(column, origin.y) / 30) * 30),
      );
      onSlot(day, minutes, column);
    };
    window.addEventListener('pointerup', up);
  };

  const startResize = (event: React.PointerEvent<HTMLElement>, block: TimedBlock, day: string) => {
    event.stopPropagation();
    event.preventDefault();
    const column = (event.currentTarget as HTMLElement).closest<HTMLElement>('[data-cal-slots]')!;
    const id = event.pointerId;
    const move = (next: PointerEvent) => {
      if (next.pointerId !== id) return;
      const bottom = Math.max(
        block.top + 15,
        Math.min(1440, snap(minutesAt(column, next.clientY))),
      );
      setResizing({ id: block.item.id, bottom });
    };
    const up = (next: PointerEvent) => {
      if (next.pointerId !== id) return;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const bottom = Math.max(
        block.top + 15,
        Math.min(1440, snap(minutesAt(column, next.clientY))),
      );
      setResizing(null);
      if (bottom !== block.bottom) onResize(block.item, atMinutes(day, bottom));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const columns = `${GUTTER}px repeat(${count}, minmax(0, 1fr))`;
  const allDay = days.map((day) =>
    (byDay.get(day) ?? []).filter((item) => item.allDay || item.kind === 'due'),
  );
  const tallest = Math.max(0, ...allDay.map((list) => list.length));

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: columns,
          borderBottom: 1,
          borderColor: 'divider',
        }}
      >
        <Box />
        {days.map((day) => (
          <ButtonBase
            key={day}
            onClick={(event) => onOpenDay(day, event.currentTarget)}
            aria-label={t('calendar.openDay', { day: formatDay(day, today) })}
            sx={{ flexDirection: 'column', py: 0.5, minWidth: 0 }}
          >
            <Typography variant="caption" color="text.secondary" noWrap>
              {weekdayShort.format(at(day))}
            </Typography>
            <Box
              component="span"
              sx={{
                minWidth: 26,
                height: 26,
                px: 0.5,
                borderRadius: 13,
                display: 'grid',
                placeItems: 'center',
                fontWeight: day === today ? 700 : 500,
                color: day === today ? 'primary.contrastText' : 'text.primary',
                bgcolor: day === today ? 'primary.main' : undefined,
              }}
            >
              {Number(day.slice(8))}
            </Box>
          </ButtonBase>
        ))}
      </Box>
      {tallest > 0 && (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: columns,
            borderBottom: 1,
            borderColor: 'divider',
            maxHeight: allDayOpen ? '40%' : undefined,
            overflowY: allDayOpen ? 'auto' : undefined,
            flexShrink: 0,
          }}
        >
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ fontSize: 10, textAlign: 'right', pr: 0.5, pt: 0.5 }}
          >
            {t('calendar.allDay')}
          </Typography>
          {days.map((day, index) => {
            const list = allDay[index]!;
            const limit =
              allDayOpen || list.length <= ALL_DAY_ROWS ? list.length : ALL_DAY_ROWS - 1;
            return (
              <Box
                key={day}
                data-cal-day={day}
                sx={{
                  display: 'grid',
                  gap: '1px',
                  alignContent: 'start',
                  p: 0.25,
                  minWidth: 0,
                  borderLeft: 1,
                  borderColor: 'divider',
                  minHeight: 22,
                }}
              >
                {list.slice(0, limit).map((item) => (
                  <ItemLine
                    key={item.id}
                    item={item}
                    day={day}
                    dense
                    onOpen={() => onOpenTask(item.taskId)}
                    onPointerDown={(event) => item.movable && onGrab(event, item, 0)}
                  />
                ))}
                {limit < list.length && (
                  <ButtonBase
                    onClick={() => setAllDayOpen(true)}
                    sx={{
                      height: 16,
                      fontSize: 11,
                      color: 'text.secondary',
                      justifyContent: 'flex-start',
                      px: 0.5,
                    }}
                  >
                    {t('calendar.more', { count: list.length - limit })}
                  </ButtonBase>
                )}
              </Box>
            );
          })}
        </Box>
      )}
      <Box
        ref={body}
        onPointerDown={onTouchDown}
        onPointerMove={onTouchMove}
        onPointerUp={onTouchUp}
        onPointerCancel={onTouchUp}
        sx={{
          flexGrow: 1,
          minHeight: 0,
          overflowY: 'auto',
          overflowX: 'hidden',
          touchAction: 'pan-y',
          userSelect: 'none',
        }}
      >
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: columns,
            height: 24 * hourHeight,
            position: 'relative',
          }}
        >
          <Box sx={{ position: 'relative' }} aria-hidden>
            {Array.from({ length: 23 }, (_, index) => index + 1).map((hour) => (
              <Typography
                key={hour}
                variant="caption"
                color="text.secondary"
                sx={{
                  position: 'absolute',
                  top: hour * hourHeight - 7,
                  right: 4,
                  fontSize: 10,
                  lineHeight: 1,
                }}
              >
                {formatHour(hour)}
              </Typography>
            ))}
          </Box>
          {days.map((day) => {
            const all = timedBlocks(byDay.get(day) ?? [], day);
            // Groups wider than fit keep their first columns; the rest wait behind "+N".
            const blocks = all.filter((block) => block.columns <= side || block.column < side - 1);
            const hidden = new Map<number, TimedBlock[]>();
            for (const block of all) {
              if (block.columns > side && block.column >= side - 1) {
                hidden.set(block.group, [...(hidden.get(block.group) ?? []), block]);
              }
            }
            return (
              <Box
                key={day}
                data-cal-slots={day}
                data-hour-height={hourHeight}
                aria-label={formatDay(day, today)}
                role="group"
                onPointerDown={(event) => tapSlot(event, day)}
                sx={{
                  position: 'relative',
                  borderLeft: 1,
                  borderColor: 'divider',
                  backgroundImage: (theme) =>
                    `repeating-linear-gradient(to bottom, transparent 0, transparent ${hourHeight - 1}px, ${theme.palette.divider} ${hourHeight - 1}px, ${theme.palette.divider} ${hourHeight}px)`,
                  bgcolor: day === today ? 'action.hover' : undefined,
                  cursor: 'cell',
                }}
              >
                {blocks.map((block) => {
                  const bottom = resizing?.id === block.item.id ? resizing.bottom : block.bottom;
                  const startText = timePart(block.item.start);
                  const ends = block.item.end && datePart(block.item.end) === day;
                  return (
                    <Box
                      key={block.item.id}
                      role="button"
                      tabIndex={0}
                      data-cal-item={block.item.id}
                      aria-label={`${startText ? formatTime(startText) : ''} ${block.item.title}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        onOpenTask(block.item.taskId);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') onOpenTask(block.item.taskId);
                      }}
                      onPointerDown={(event) => {
                        event.stopPropagation();
                        if (!block.item.movable) return;
                        const column = event.currentTarget.parentElement!;
                        onGrab(
                          event,
                          block.item,
                          snap(minutesAt(column, event.clientY) - block.top, 15),
                        );
                      }}
                      sx={{
                        position: 'absolute',
                        top: (block.top / 60) * hourHeight + 1,
                        height: Math.max(14, ((bottom - block.top) / 60) * hourHeight - 2),
                        left: `calc(${(block.column / Math.min(block.columns, side)) * 100}% + 1px)`,
                        width: `calc(${100 / Math.min(block.columns, side)}% - 3px)`,
                        bgcolor: block.item.color,
                        color: '#1F2328',
                        borderRadius: 0.75,
                        px: 0.5,
                        overflow: 'hidden',
                        fontSize: 11,
                        lineHeight: 1.25,
                        cursor: block.item.movable ? 'grab' : 'pointer',
                        opacity: block.item.done ? 0.55 : 1,
                        textDecoration: block.item.done ? 'line-through' : 'none',
                        boxShadow: resizing?.id === block.item.id ? 3 : 0,
                        touchAction: 'pan-y',
                      }}
                    >
                      <Box
                        component="span"
                        sx={{
                          fontWeight: 600,
                          display: 'block',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {block.item.title || t('task.untitled')}
                      </Box>
                      {((bottom - block.top) / 60) * hourHeight > 28 && startText && (
                        <Box component="span" sx={{ opacity: 0.75 }}>
                          {formatTime(startText)}
                          {ends && block.item.end
                            ? ` - ${formatTime(timePart(block.item.end) ?? '00:00')}`
                            : ''}
                        </Box>
                      )}
                      {block.item.movable && ends && (
                        <Box
                          aria-hidden
                          onPointerDown={(event) => startResize(event, block, day)}
                          sx={{
                            position: 'absolute',
                            left: 0,
                            right: 0,
                            bottom: 0,
                            height: 6,
                            cursor: 'ns-resize',
                            touchAction: 'none',
                          }}
                        />
                      )}
                    </Box>
                  );
                })}
                {[...hidden.values()].map((rest) => {
                  const first = Math.min(...rest.map((block) => block.top));
                  return (
                    <ButtonBase
                      key={`more-${rest[0]!.group}`}
                      aria-label={t('calendar.more', { count: rest.length })}
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation();
                        onOpenDay(day, event.currentTarget);
                      }}
                      sx={{
                        position: 'absolute',
                        top: (first / 60) * hourHeight + 1,
                        height: Math.max(16, Math.min(hourHeight / 2, 24)),
                        left: `calc(${((side - 1) / side) * 100}% + 1px)`,
                        width: `calc(${100 / side}% - 3px)`,
                        borderRadius: 0.75,
                        border: 1,
                        borderColor: 'divider',
                        bgcolor: 'background.paper',
                        fontSize: 11,
                        fontWeight: 600,
                        color: 'text.secondary',
                      }}
                    >
                      +{rest.length}
                    </ButtonBase>
                  );
                })}
                {day === today && (
                  <Box
                    aria-hidden
                    sx={{
                      position: 'absolute',
                      left: 0,
                      right: 0,
                      top: (now / 60) * hourHeight,
                      height: 2,
                      bgcolor: 'error.main',
                      pointerEvents: 'none',
                    }}
                  />
                )}
              </Box>
            );
          })}
        </Box>
      </Box>
    </Box>
  );
}
