import { Box, ButtonBase, Typography, useMediaQuery, useTheme } from '@mui/material';
import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CalendarItem } from '../../core/calendar.ts';
import { daysFrom, weekStartOf } from '../../core/calendarLayout.ts';
import { addDays, daysBetween, monthOf } from '../../core/dates.ts';
import { mix } from '../../core/palette.ts';
import { formatDay } from '../format.ts';
import { t } from '../i18n/i18n.ts';
import { ItemLine } from './ItemLine.tsx';
import { besideScrolling, scrolling } from './scrollbars.ts';

/** Weeks either side of today the month view scrolls through. */
const SPAN_WEEKS = 520;
const LINE = 19;
const HEADER = 22;
/** Rows drawn above and below the ones on screen, so a quick scroll does not show gaps. */
const OVERSCAN = 2;

export interface MonthViewInfo {
  /** The first and last day drawn */
  from: string;
  to: string;
  /** The month the screen is mostly showing, `YYYY-MM` */
  month: string;
}

const shortMonthDay = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});
const weekdayShort = new Intl.DateTimeFormat(undefined, { weekday: 'short', timeZone: 'UTC' });
const at = (day: string) => new Date(`${day}T12:00:00Z`);

interface DayCellProps {
  day: string;
  items: CalendarItem[];
  capacity: number;
  today: string;
  month: string;
  selected: boolean;
  onOpenTask: (taskId: string) => void;
  onOpenDay: (day: string, anchor: HTMLElement) => void;
  onGrab: (event: React.PointerEvent<HTMLElement>, item: CalendarItem) => void;
  /** Narrow cells (phones) say "+3" rather than "+3 more" */
  narrow: boolean;
  /** Its column, 0 to 6 */
  col: number;
}

const DayCell = memo(function DayCell({
  day,
  items,
  capacity,
  today,
  month,
  selected,
  onOpenTask,
  onOpenDay,
  onGrab,
  narrow,
  col,
}: DayCellProps) {
  const isToday = day === today;
  const first = day.endsWith('-01');
  const overflow = items.length > capacity;
  const shown = overflow ? items.slice(0, Math.max(0, capacity - 1)) : items;
  const label = formatDay(day, today);
  // Month outline, as in the date picker: a firmer line where the day above or to the left is in
  // another month, so each month reads as its own block.
  const own = monthOf(day);
  const edges = [
    monthOf(addDays(day, -7)) !== own ? 'inset 0 2px 0 var(--month-line)' : null,
    col > 0 && monthOf(addDays(day, -1)) !== own ? 'inset 2px 0 0 var(--month-line)' : null,
  ].filter(Boolean);
  return (
    <Box
      role="gridcell"
      data-cal-day={day}
      aria-label={label}
      aria-selected={selected || undefined}
      {...(edges.length ? { style: { boxShadow: edges.join(', ') } } : {})}
      sx={{
        minWidth: 0,
        overflow: 'hidden',
        borderRight: 1,
        borderBottom: 1,
        borderColor: 'divider',
        px: 0.25,
        cursor: 'pointer',
        bgcolor: selected ? 'action.selected' : undefined,
        '&:last-of-type': { borderRight: 0 },
      }}
    >
      <Box sx={{ height: HEADER, display: 'flex', alignItems: 'center', px: 0.25 }}>
        <ButtonBase
          aria-label={t('calendar.openDay', { day: label })}
          onClick={(event) => onOpenDay(day, event.currentTarget)}
          onPointerDown={(event) => event.stopPropagation()}
          sx={{
            minWidth: 20,
            height: 20,
            px: 0.5,
            borderRadius: 10,
            fontSize: 12,
            whiteSpace: 'nowrap',
            fontWeight: isToday || first ? 700 : 400,
            color: isToday
              ? 'primary.contrastText'
              : day.startsWith(month)
                ? 'text.primary'
                : 'text.disabled',
            bgcolor: isToday ? 'primary.main' : undefined,
          }}
        >
          {first ? shortMonthDay.format(at(day)) : Number(day.slice(8))}
        </ButtonBase>
      </Box>
      <Box sx={{ display: 'grid', gap: '1px' }}>
        {shown.map((item) => (
          <ItemLine
            key={item.id}
            item={item}
            day={day}
            dense
            onOpen={() => onOpenTask(item.taskId)}
            onPointerDown={(event) => {
              event.stopPropagation();
              if (item.movable) onGrab(event, item);
            }}
          />
        ))}
        {overflow && (
          <ButtonBase
            onClick={(event) => onOpenDay(day, event.currentTarget)}
            onPointerDown={(event) => event.stopPropagation()}
            sx={{
              height: 16,
              px: 0.5,
              justifyContent: 'flex-start',
              fontSize: 11,
              color: 'text.secondary',
              borderRadius: 0.75,
              '&:hover': { bgcolor: 'action.hover' },
            }}
          >
            {narrow
              ? `+${items.length - shown.length}`
              : t('calendar.more', { count: items.length - shown.length })}
          </ButtonBase>
        )}
      </Box>
    </Box>
  );
});

/**
 * The month view (spec: PL-093): weeks in one continuous run, scrolling a week at a time, each
 * day listing its tasks as short lines ("+N more" when it is full). Only the weeks on screen are
 * drawn. A click on a day opens it; a drag across days (a swipe on a phone) picks them.
 */
export function MonthView({
  today,
  weekStart,
  weeks,
  target,
  byDay,
  onView,
  onOpenTask,
  onOpenDay,
  onRange,
  rangeOpen,
  onGrab,
}: {
  today: string;
  weekStart: number;
  weeks: number;
  /** Scroll so this day's week is on top; `seq` changes for each new request */
  target: { date: string; seq: number };
  byDay: Map<string, CalendarItem[]>;
  onView: (info: MonthViewInfo) => void;
  onOpenTask: (taskId: string) => void;
  onOpenDay: (day: string, anchor: HTMLElement) => void;
  onRange: (first: string, last: string, point: { x: number; y: number }) => void;
  /** The page's menu for picked days is open: keep them marked */
  rangeOpen: boolean;
  onGrab: (event: React.PointerEvent<HTMLElement>, item: CalendarItem) => void;
}) {
  const [origin] = useState(() => addDays(weekStartOf(today, weekStart), -7 * SPAN_WEEKS));
  const rows = SPAN_WEEKS * 2 + 1;
  const rowOf = (date: string) => Math.floor(daysBetween(origin, date) / 7);
  const weekAt = (row: number) => addDays(origin, row * 7);

  const scroller = useRef<HTMLDivElement>(null);
  const theme = useTheme();
  const narrow = useMediaQuery(theme.breakpoints.down('sm'), { noSsr: true });
  const [height, setHeight] = useState(600);
  const rowHeight = Math.max(56, Math.floor(height / weeks));
  const [top, setTop] = useState(() => rowOf(target.date));
  const [selection, setSelection] = useState<{ anchor: string; current: string } | null>(null);
  const [pressing, setPressing] = useState(false);

  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    setHeight(element.clientHeight || 600);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setHeight(element.clientHeight || 600));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Go where the page asks (Today, the arrows, a link), and stay put when the size changes.
  const [seenSeq, setSeenSeq] = useState(target.seq);
  if (target.seq !== seenSeq) {
    setSeenSeq(target.seq);
    setTop(rowOf(target.date));
  }
  useLayoutEffect(() => {
    const element = scroller.current;
    if (element) element.scrollTop = top * rowHeight;
    // Only for a new request or a new size: scrolling itself moves `top`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.seq, rowHeight]);

  const frame = useRef<number | null>(null);
  const onScroll = () => {
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const element = scroller.current;
      if (element) setTop(Math.max(0, Math.floor(element.scrollTop / rowHeight + 0.5)));
    });
  };

  const first = Math.max(0, top - OVERSCAN);
  const last = Math.min(rows - 1, top + weeks + OVERSCAN);
  // The month of the top row's last day: a week holding the 1st already belongs to the new month,
  // so the arrows (which bring the 1st's week to the top) and the title always agree.
  const month = addDays(weekAt(top), 6).slice(0, 7);
  const from = weekAt(first);
  const to = addDays(weekAt(last), 6);
  const report = useRef(onView);
  useEffect(() => {
    report.current = onView;
  });
  useEffect(() => {
    report.current({ from, to, month });
  }, [from, to, month]);

  const capacity = Math.max(0, Math.floor((rowHeight - HEADER - 2) / LINE));
  const inSelection = (day: string) => {
    if (!selection || !(pressing || rangeOpen)) return false;
    const [a, b] = [selection.anchor, selection.current].sort();
    return day >= a! && day <= b!;
  };

  // Picking days: press on a day and move across others (a swipe on a phone).
  const dayAt = (x: number, y: number) =>
    document.elementFromPoint?.(x, y)?.closest<HTMLElement>('[data-cal-day]')?.dataset.calDay;
  const press = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const day = (event.target as HTMLElement).closest<HTMLElement>('[data-cal-day]')?.dataset
      .calDay;
    if (!day) return;
    const cell = (event.target as HTMLElement).closest<HTMLElement>('[data-cal-day]')!;
    const id = event.pointerId;
    let current = day;
    let moved = false;
    const move = (next: PointerEvent) => {
      if (next.pointerId !== id) return;
      const over = dayAt(next.clientX, next.clientY);
      if (over && over !== current) {
        current = over;
        moved = true;
        setPressing(true);
        setSelection({ anchor: day, current: over });
      }
    };
    const up = (next: PointerEvent) => {
      if (next.pointerId !== id) return;
      done();
      setPressing(false);
      if (moved && current !== day) {
        const [a, b] = [day, current].sort();
        onRange(a!, b!, { x: next.clientX, y: next.clientY });
      } else {
        setSelection(null);
        onOpenDay(day, cell);
      }
    };
    const done = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
    };
    // The browser took the touch to scroll: nothing picked.
    const cancel = () => {
      done();
      setPressing(false);
      setSelection(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
  };

  const headers = daysFrom(weekStartOf(today, weekStart), 7);
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <Box
        aria-hidden
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
          borderBottom: 1,
          borderColor: 'divider',
          ...besideScrolling,
        }}
      >
        {headers.map((day) => (
          <Typography
            key={day}
            variant="caption"
            color="text.secondary"
            sx={{ textAlign: 'center', py: 0.5 }}
          >
            {weekdayShort.format(at(day))}
          </Typography>
        ))}
      </Box>
      <Box
        ref={scroller}
        role="grid"
        aria-label={t('calendar.month')}
        onScroll={onScroll}
        onPointerDown={press}
        sx={{
          flexGrow: 1,
          minHeight: 0,
          overflowY: 'auto',
          ...scrolling,
          position: 'relative',
          scrollSnapType: 'y mandatory',
          touchAction: 'pan-y',
          // Firmer than the day lines, so the months stand apart on light and dark paper alike.
          '--month-line': (theme) => mix(theme.punchlist.outline, theme.punchlist.textMuted, 0.45),
          userSelect: 'none',
        }}
      >
        <Box sx={{ height: rows * rowHeight, position: 'relative' }}>
          {Array.from({ length: last - first + 1 }, (_, index) => {
            const row = first + index;
            const start = weekAt(row);
            return (
              <Box
                key={start}
                role="row"
                sx={{
                  position: 'absolute',
                  top: row * rowHeight,
                  left: 0,
                  right: 0,
                  height: rowHeight,
                  display: 'grid',
                  gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
                  scrollSnapAlign: 'start',
                }}
              >
                {daysFrom(start, 7).map((day, col) => (
                  <DayCell
                    key={day}
                    col={col}
                    day={day}
                    items={byDay.get(day) ?? EMPTY}
                    capacity={capacity}
                    today={today}
                    month={month}
                    selected={inSelection(day)}
                    onOpenTask={onOpenTask}
                    onOpenDay={onOpenDay}
                    onGrab={onGrab}
                    narrow={narrow}
                  />
                ))}
              </Box>
            );
          })}
        </Box>
      </Box>
    </Box>
  );
}

const EMPTY: CalendarItem[] = [];
