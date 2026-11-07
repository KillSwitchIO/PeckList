import { Box, ButtonBase, Typography, useTheme } from '@mui/material';
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { daysFrom, heatLevel, weekStartOf, type HeatScale } from '../../core/calendarLayout.ts';
import { addDays, monthGrid } from '../../core/dates.ts';
import { dateTimeFormat } from '../../core/intl.ts';
import { heatShades } from '../../core/palette.ts';
import { t } from '../i18n/i18n.ts';
import { dateHeading, rowRule } from './calendarLook.ts';
import { scrolling } from './scrollbars.ts';
import {
  monthAt,
  SPAN_YEARS,
  stayAt,
  stayTop,
  yearAt,
  yearLayout,
  yearParts,
  type YearStay,
} from './yearLayout.ts';

/** A year's open tasks per day, and how they shade: each year against itself. */
export interface YearHeat {
  counts: Map<string, number>;
  scale: HeatScale;
}

/** A year whose shades have not been worked out yet. */
const NO_HEAT: YearHeat = { counts: new Map(), scale: { few: 0, some: 0 } };
/** How long the scrolling must have stopped for before a year's shades are worked out. */
const SHADE_AFTER_MS = 120;

/** How far the arrow keys move in a year's days. */
const KEY_STEPS: Record<string, number> = {
  ArrowLeft: -1,
  ArrowRight: 1,
  ArrowUp: -7,
  ArrowDown: 7,
};

const at = (day: string) => new Date(`${day}T12:00:00Z`);

function dayLabel(day: string, today: string, count: number): string {
  // Always with its weekday and whole, unlike `formatDay`: the letters over the columns are for
  // the eye only, and someone looking for a free Saturday has to hear it.
  const date = dateTimeFormat(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    ...(day.slice(0, 4) === today.slice(0, 4) ? {} : { year: 'numeric' }),
    timeZone: 'UTC',
  }).format(at(day));
  const name = day === today ? `${t('date.today')}, ${date}` : date;
  if (count === 0) return t('calendar.yearDayFree', { day: name });
  if (count === 1) return t('calendar.yearDayOne', { day: name });
  return t('calendar.yearDayMany', { day: name, count });
}

interface MonthBlockProps {
  /** `YYYY-MM` */
  month: string;
  today: string;
  weekStart: number;
  counts: Map<string, number>;
  scale: HeatScale;
  /** The one day of this month that Tab lands on, if the year's is here */
  active: string | null;
}

const MonthBlock = memo(function MonthBlock({
  month,
  today,
  weekStart,
  counts,
  scale,
  active,
}: MonthBlockProps) {
  const name = dateTimeFormat(undefined, { month: 'long', timeZone: 'UTC' }).format(
    at(`${month}-15`),
  );
  // Several years are on the page: as with the days, a month in another one says which.
  const fullName = month.startsWith(today.slice(0, 4))
    ? name
    : dateTimeFormat(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
        at(`${month}-15`),
      );
  const days = monthGrid(`${month}-01`, weekStart);
  const narrow = dateTimeFormat(undefined, { weekday: 'narrow', timeZone: 'UTC' });
  return (
    <div className="year-month" data-year-month={month}>
      <ButtonBase
        className="year-month-name"
        data-year-open-month={month}
        aria-label={t('calendar.openMonth', { month: fullName })}
      >
        {name}
      </ButtonBase>
      {/* Each day's own label names its weekday, so these letters are for the eye only. */}
      <div className="year-weekdays" aria-hidden>
        {daysFrom(weekStartOf(today, weekStart), 7).map((day) => (
          <span key={day}>{narrow.format(at(day))}</span>
        ))}
      </div>
      <div className="year-weeks" role="grid" aria-label={fullName}>
        {[0, 1, 2, 3, 4, 5].map((week) => (
          <div key={week} className="year-week" role="row">
            {days.slice(week * 7, week * 7 + 7).map((day) => {
              // Six weeks always, blank past the month's ends, so every month lines up.
              if (!day.startsWith(month)) return <span key={day} role="gridcell" />;
              const count = counts.get(day) ?? 0;
              const label = dayLabel(day, today, count);
              return (
                <button
                  key={day}
                  type="button"
                  role="gridcell"
                  className="year-day"
                  data-year-day={day}
                  data-heat={heatLevel(count, scale)}
                  data-today={day === today ? '' : undefined}
                  aria-label={label}
                  title={label}
                  tabIndex={day === active ? 0 : -1}
                >
                  {Number(day.slice(8))}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
});

// Styles once for the whole view; each day only says what it is on data attributes, as in the
// month view (R-FB-94: a style object per day was most of that view's render time).
const yearStyles = {
  '& .year-months': { position: 'relative' },
  '& .year-row': {
    position: 'absolute',
    left: 0,
    right: 0,
    display: 'grid',
    boxSizing: 'border-box',
  },
  // A year ends as Month's rows do: a line under its last months, and nothing else.
  '& .year-row[data-year-end]': rowRule,
  '& .year-heading': {
    position: 'absolute',
    left: 0,
    right: 0,
    m: 0,
    px: 1.5,
    display: 'flex',
    alignItems: 'flex-end',
    pb: 0.25,
    lineHeight: '24px',
    ...dateHeading,
  },
  '& .year-month': { minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', p: 1 },
  '& .year-month-name': {
    alignSelf: 'flex-start',
    flexShrink: 0,
    height: 24,
    px: 0.5,
    borderRadius: 0.75,
    fontSize: 13,
    fontWeight: 600,
    '&:hover': { bgcolor: 'action.hover' },
    '&.Mui-focusVisible': { outline: '2px solid', outlineColor: 'primary.main' },
  },
  '& .year-weekdays': {
    flexShrink: 0,
    display: 'grid',
    gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
    height: 14,
    fontSize: 10,
    lineHeight: '14px',
    textAlign: 'center',
    color: 'text.secondary',
  },
  '& .year-weeks': {
    flexGrow: 1,
    minHeight: 0,
    display: 'grid',
    gridTemplateRows: 'repeat(6, minmax(0, 1fr))',
  },
  '& .year-week': {
    minHeight: 0,
    display: 'grid',
    gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
  },
  '& .year-day': {
    appearance: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 0,
    minHeight: 0,
    m: '1px',
    p: 0,
    border: 0,
    borderRadius: 0.5,
    background: 'none',
    color: 'text.primary',
    font: 'inherit',
    fontSize: 11,
    lineHeight: 1,
    cursor: 'pointer',
    '&:hover': { boxShadow: 'inset 0 0 0 1px currentColor' },
    // The day's own text color, so it shows on any shade; and bold, so not by color alone.
    '&[data-today]': { fontWeight: 700, outline: '2px solid currentColor', outlineOffset: -2 },
    '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 1 },
  },
  '& .year-swatch': { width: 12, height: 12, borderRadius: 0.5, border: 1, borderColor: 'divider' },
  ...Object.fromEntries(
    [1, 2, 3].map((level) => [
      `& [data-heat="${level}"]`,
      { backgroundColor: `var(--heat-${level})`, color: `var(--heat-on-${level})` },
    ]),
  ),
} as const;

/**
 * The year view (spec: PL-093, Business Calendar 2's heat map): small months in one scrolling run
 * from year to year, each day shaded by how many open tasks fall on it, to find free and crowded
 * days at a glance. A day opens in Days, a month's name opens Month. Only what is near the view is
 * drawn, and it stays this plain: no component or handler per day, and the arrow keys walk the days
 * with one Tab stop rather than hundreds.
 */
export function YearView({
  date,
  left,
  target,
  today,
  weekStart,
  heatOf,
  onOpenDay,
  onOpenMonth,
  onYear,
  onLeave,
}: {
  /** The day it opens on, scrolled to its month, if it has not been left somewhere */
  date: string;
  /** Where it was left, to come back to */
  left: YearStay | null;
  /** Where to go, for each new `seq` after opening (Today, the arrows, the date picker) */
  target: { date: string; seq: number };
  today: string;
  weekStart: number;
  /** A year's open tasks per day: asked only for the years drawn, and not during a scroll */
  heatOf: (year: string) => YearHeat;
  onOpenDay: (day: string) => void;
  onOpenMonth: (month: string) => void;
  /** The year in view has changed */
  onYear: (year: string) => void;
  /** It is going away, leaving the view here */
  onLeave: (stay: YearStay) => void;
}) {
  const [firstYear] = useState(() => Number(today.slice(0, 4)) - SPAN_YEARS);
  const [size, setSize] = useState({ width: 0, height: 600 });
  const layout = useMemo(
    () => yearLayout(size.width, size.height, firstYear),
    [size.width, size.height, firstYear],
  );
  // The scroll position, to the nearest row: it only redraws when a row has gone by.
  const [opened] = useState<YearStay>(() => left ?? { sent: date.slice(0, 7) });
  const [scrolled, setScrolled] = useState(() => stayTop(layout, opened));

  const theme = useTheme();
  const shades = useMemo(() => {
    const vars: Record<string, string> = {};
    heatShades(theme.pecklist).forEach(({ fill, on }, index) => {
      vars[`--heat-${index + 1}`] = fill;
      vars[`--heat-on-${index + 1}`] = on;
    });
    return vars;
  }, [theme]);

  const scroller = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const measure = () =>
      setSize({ width: element.clientWidth, height: element.clientHeight || 600 });
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const report = useRef(onYear);
  useEffect(() => {
    report.current = onYear;
  });
  const lastYear = useRef(date.slice(0, 4));
  /** Bring the drawing and the year in view up to where it has scrolled. */
  const follow = (at: number) => {
    setScrolled(Math.round(at / layout.rowHeight) * layout.rowHeight);
    const year = String(yearAt(layout, at));
    if (year !== lastYear.current) {
      lastYear.current = year;
      report.current(year);
    }
  };

  // Where the view stays: it never moves on its own, nothing snaps, and new data leaves it alone.
  // Only Today, the arrows and the date picker send it anywhere, and a new shape keeps the place.
  const stay = useRef(opened);
  // Where it put itself, so that move is not taken for scrolling.
  const placed = useRef<number | null>(null);
  useLayoutEffect(() => () => onLeave(stay.current), [onLeave]);
  // The one day Tab lands on: the last one focused or gone to.
  const [cursor, setCursor] = useState(date);
  const [seenSeq, setSeenSeq] = useState(target.seq);
  if (target.seq !== seenSeq) {
    setSeenSeq(target.seq);
    setCursor(target.date);
  }
  const wentSeq = useRef(target.seq);
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    if (wentSeq.current !== target.seq) {
      wentSeq.current = target.seq;
      stay.current = { sent: target.date.slice(0, 7) };
    }
    const top = stayTop(layout, stay.current);
    placed.current = top;
    element.scrollTop = top;
    follow(top);
    // Only for a new request or a new shape: scrolling itself runs `onScroll`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.seq, layout]);

  const frame = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );
  const lastScroll = useRef(0);
  const onScroll = () => {
    lastScroll.current = performance.now();
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const element = scroller.current;
      if (!element) return;
      const at = element.scrollTop;
      if (placed.current === null || Math.abs(at - placed.current) > 1) {
        placed.current = null;
        stay.current = stayAt(layout, at);
      }
      follow(at);
    });
  };

  // Near the view: a screen either way, so a fling meets months already drawn.
  const reach = Math.max(size.height, layout.rowHeight * 2);
  const { rows, headings } = useMemo(
    () => yearParts(layout, scrolled - reach, scrolled + size.height + reach),
    [layout, scrolled, reach, size.height],
  );

  // A year's shades can take a while on a busy workspace, so a scroll never waits for them: the
  // year it opens on has them at once, the others once the scrolling stops, and a change to the
  // tasks keeps the old shades until then. A shade is only a color, so nothing moves when it comes.
  const [heats, setHeats] = useState(() => {
    const year = date.slice(0, 4);
    return new Map([[year, { of: heatOf, heat: heatOf(year) }]]);
  });
  useEffect(() => {
    const drawn = rows.flatMap((row) => row.months).map((month) => month.slice(0, 4));
    const due = [String(yearAt(layout, scrolled)), ...drawn].find(
      (year) => heats.get(year)?.of !== heatOf,
    );
    if (!due) return;
    let timer: ReturnType<typeof setTimeout>;
    const whenStill = () => {
      const left = lastScroll.current + SHADE_AFTER_MS - performance.now();
      if (left > 0) {
        timer = setTimeout(whenStill, left);
        return;
      }
      const heat = heatOf(due);
      setHeats((now) => new Map(now).set(due, { of: heatOf, heat }));
    };
    timer = setTimeout(whenStill);
    return () => clearTimeout(timer);
  }, [rows, layout, scrolled, heats, heatOf]);

  // Scrolled far from that day, Tab lands on the first of the months in view instead.
  const near = rows.some((row) => row.months.includes(cursor.slice(0, 7)));
  const active = near ? cursor : `${monthAt(layout, scrolled)}-01`;

  const onClick = (event: React.MouseEvent<HTMLElement>) => {
    const found = (event.target as HTMLElement).closest<HTMLElement>(
      '[data-year-day], [data-year-open-month]',
    );
    if (found?.dataset.yearDay) onOpenDay(found.dataset.yearDay);
    else if (found?.dataset.yearOpenMonth) onOpenMonth(found.dataset.yearOpenMonth);
  };
  const onFocus = (event: React.FocusEvent<HTMLElement>) => {
    const day = event.target.dataset.yearDay;
    if (day) setCursor(day);
  };
  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    const day = (event.target as HTMLElement).dataset.yearDay;
    const step = KEY_STEPS[event.key];
    if (!day || !step) return;
    event.preventDefault();
    event.currentTarget
      .querySelector<HTMLElement>(`[data-year-day="${addDays(day, step)}"]`)
      ?.focus();
  };

  return (
    <Box
      sx={{ display: 'flex', flexDirection: 'column', height: '100%', ...shades, ...yearStyles }}
      onClick={onClick}
      onFocus={onFocus}
      onKeyDown={onKeyDown}
    >
      <Box
        ref={scroller}
        onScroll={onScroll}
        sx={{
          flexGrow: 1,
          minHeight: 0,
          overflowY: 'auto',
          position: 'relative',
          userSelect: 'none',
          overflowAnchor: 'none',
          ...scrolling,
        }}
      >
        <div className="year-months" style={{ height: layout.total }}>
          {headings.map(({ year, top }) => (
            <h3 key={year} className="year-heading" style={{ top, height: layout.headingHeight }}>
              {year}
            </h3>
          ))}
          {rows.map(({ months, top }) => (
            <div
              key={months[0]}
              className="year-row"
              data-year-end={months.at(-1)?.endsWith('-12') ? '' : undefined}
              style={{
                top,
                height: layout.rowHeight,
                gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))`,
              }}
            >
              {months.map((month) => {
                const { counts, scale } = heats.get(month.slice(0, 4))?.heat ?? NO_HEAT;
                return (
                  <MonthBlock
                    key={month}
                    month={month}
                    today={today}
                    weekStart={weekStart}
                    counts={counts}
                    scale={scale}
                    active={active.startsWith(month) ? active : null}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </Box>
      <Box
        aria-hidden
        sx={{
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          // At the left: the add button floats over the corner at the right.
          justifyContent: 'flex-start',
          gap: 0.5,
          height: 24,
          px: 1.5,
          borderTop: 1,
          borderColor: 'divider',
        }}
      >
        <Typography variant="caption" color="text.secondary" sx={{ mr: 0.5 }}>
          {t('calendar.heatFree')}
        </Typography>
        {[0, 1, 2, 3].map((level) => (
          <span key={level} className="year-swatch" data-heat={level} />
        ))}
        <Typography variant="caption" color="text.secondary" sx={{ ml: 0.5 }}>
          {t('calendar.heatBusy')}
        </Typography>
      </Box>
    </Box>
  );
}
