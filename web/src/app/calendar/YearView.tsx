import { Box, ButtonBase, Typography, useTheme } from '@mui/material';
import { memo, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  daysFrom,
  heatLevel,
  heatScale,
  weekStartOf,
  type HeatScale,
} from '../../core/calendarLayout.ts';
import { addDays, monthGrid } from '../../core/dates.ts';
import { dateTimeFormat } from '../../core/intl.ts';
import { heatShades } from '../../core/palette.ts';
import { t } from '../i18n/i18n.ts';
import { scrolling } from './scrollbars.ts';

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
  const days = monthGrid(`${month}-01`, weekStart);
  const narrow = dateTimeFormat(undefined, { weekday: 'narrow', timeZone: 'UTC' });
  return (
    <div className="year-month" data-year-month={month}>
      <ButtonBase
        className="year-month-name"
        data-year-open-month={month}
        aria-label={t('calendar.openMonth', { month: name })}
      >
        {name}
      </ButtonBase>
      {/* Each day's own label names its weekday, so these letters are for the eye only. */}
      <div className="year-weekdays" aria-hidden>
        {daysFrom(weekStartOf(today, weekStart), 7).map((day) => (
          <span key={day}>{narrow.format(at(day))}</span>
        ))}
      </div>
      <div className="year-weeks" role="grid" aria-label={name}>
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
  '& .year-months': {
    display: 'grid',
    minHeight: '100%',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gridAutoRows: 'minmax(196px, 1fr)',
    // By the room the calendar has, not the window's: the side panel and the menu take from it.
    '@container (min-width: 560px)': { gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' },
    '@container (min-width: 840px)': {
      gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
      gridAutoRows: 'minmax(148px, 1fr)',
    },
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
 * The year view (spec: PL-093, Business Calendar 2's heat map): twelve small months, each day
 * shaded by how many open tasks fall on it, to find free and crowded days at a glance. A day opens
 * in Days, a month's name opens Month. Every day is drawn, so it stays this plain: no component or
 * handler per day, and the arrow keys walk the days with one Tab stop rather than 365.
 */
export function YearView({
  date,
  seq,
  today,
  weekStart,
  counts,
  onOpenDay,
  onOpenMonth,
}: {
  /** A day in the year shown; a phone scrolls to its month */
  date: string;
  /** Changes for each new request to go to `date` (Today, the date picker) */
  seq: number;
  today: string;
  weekStart: number;
  /** Open tasks per day (`openCountsByDay`) */
  counts: Map<string, number>;
  onOpenDay: (day: string) => void;
  onOpenMonth: (month: string) => void;
}) {
  const year = date.slice(0, 4);
  const months = useMemo(
    () => Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`),
    [year],
  );
  const scale = useMemo(() => heatScale(counts.values()), [counts]);

  const theme = useTheme();
  const shades = useMemo(() => {
    const vars: Record<string, string> = {};
    heatShades(theme.pecklist).forEach(({ fill, on }, index) => {
      vars[`--heat-${index + 1}`] = fill;
      vars[`--heat-on-${index + 1}`] = on;
    });
    return vars;
  }, [theme]);

  // The one day Tab lands on: the last one focused, else the day the view was opened for.
  const [cursor, setCursor] = useState(date);
  const active = cursor.startsWith(year) ? cursor : date;

  const scroller = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = scroller.current;
    const block = element?.querySelector<HTMLElement>(`[data-year-month="${date.slice(0, 7)}"]`);
    if (element && block) element.scrollTop = block.offsetTop;
    // Only on opening and for a new request: the arrows change the year and leave the scroll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seq]);

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
        sx={{
          flexGrow: 1,
          minHeight: 0,
          overflowY: 'auto',
          position: 'relative',
          containerType: 'inline-size',
          userSelect: 'none',
          ...scrolling,
        }}
      >
        <div className="year-months">
          {months.map((month) => (
            <MonthBlock
              key={month}
              month={month}
              today={today}
              weekStart={weekStart}
              counts={counts}
              scale={scale}
              active={active.startsWith(month) ? active : null}
            />
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
