import { Box, Typography, useTheme } from '@mui/material';
import { Fragment, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { heatLevel } from '../../core/calendarLayout.ts';
import { doneScale, heatColumns } from '../../core/completions.ts';
import { heatShades } from '../../core/palette.ts';
import { formatDay } from '../format.ts';
import { t } from '../i18n/i18n.ts';
import { localeDateFormat } from '../../core/intl.ts';

const CELL = 12;
const GAP = 3;
const monthShort = localeDateFormat({ month: 'short', timeZone: 'UTC' });

/** A day's name and count, for the screen reader and the tooltip. */
function heatDayLabel(day: string, today: string, count: number): string {
  const name = formatDay(day, today);
  return t('completed.day', { day: name, count });
}

// One style for the whole grid; each day only says what it is on data attributes (as the year
// view does: hundreds of days, no style object or component each).
const gridStyles = {
  '& .heat-day': {
    width: CELL,
    height: CELL,
    p: 0,
    border: 1,
    borderColor: 'divider',
    borderRadius: 0.5,
    bgcolor: 'transparent',
    cursor: 'pointer',
    '&:hover': { boxShadow: 'inset 0 0 0 1px currentColor' },
    '&[data-today]': { outline: '2px solid', outlineColor: 'text.primary', outlineOffset: -1 },
    '&[aria-pressed="true"]': {
      outline: '2px solid',
      outlineColor: 'primary.main',
      outlineOffset: 1,
    },
    '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 1 },
  },
  '& .heat-month': {
    fontSize: 10,
    lineHeight: `${CELL}px`,
    color: 'text.secondary',
    whiteSpace: 'nowrap',
    overflow: 'visible',
  },
  '& .heat-swatch': {
    width: CELL,
    height: CELL,
    border: 1,
    borderColor: 'divider',
    borderRadius: 0.5,
  },
  ...Object.fromEntries(
    [1, 2, 3].map((level) => [
      `& [data-heat="${level}"]`,
      { backgroundColor: `var(--heat-${level})`, borderColor: 'transparent' },
    ]),
  ),
} as const;

/** How far each key moves the focus through the days, which run a week to a column. */
const STEPS: Record<string, number> = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -7, ArrowRight: 7 };

/**
 * The Completed page's heatmap (spec: PL-144), a contribution graph: one square per day in weeks
 * side by side, shaded by how many tasks were done that day against the rest of the span. On a
 * narrow screen it scrolls sideways and opens on the newest weeks. A day picks that day, again
 * shows all. The grid is one tab stop: the arrow keys move by day and week, Home and End to the
 * first and last day.
 */
export function CompletedHeatmap({
  counts,
  today,
  weeks,
  weekStart,
  selected,
  onSelect,
}: {
  counts: ReadonlyMap<string, number>;
  today: string;
  weeks: number;
  weekStart: number;
  selected: string | null;
  onSelect: (day: string | null) => void;
}) {
  const theme = useTheme();
  const shades = useMemo(() => {
    const vars: Record<string, string> = {};
    heatShades(theme.pecklist).forEach(({ fill }, index) => {
      vars[`--heat-${index + 1}`] = fill;
    });
    return vars;
  }, [theme]);
  const columns = useMemo(() => heatColumns(today, weeks, weekStart), [today, weeks, weekStart]);
  const level = useMemo(() => {
    const scale = doneScale(columns.flat().map((day) => (day ? (counts.get(day) ?? 0) : 0)));
    return (count: number) => heatLevel(count, scale);
  }, [columns, counts]);
  const days = useMemo(
    () => columns.flat().filter((day): day is string => day !== null),
    [columns],
  );
  const [focused, setFocused] = useState<string | null>(null);
  // The one day Tab lands on: the last one moved to, else the picked day, else today.
  const stop =
    [focused, selected, today].find((day) => day !== null && days.includes(day)) ?? days.at(-1);
  const scroller = useRef<HTMLDivElement>(null);
  const move = (event: KeyboardEvent) => {
    const from = days.indexOf((event.target as HTMLElement).dataset.day ?? '');
    const step = STEPS[event.key];
    if (from < 0) return;
    const to =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? days.length - 1
          : step === undefined
            ? null
            : Math.min(days.length - 1, Math.max(0, from + step));
    const day = to === null ? undefined : days[to];
    if (day === undefined) return;
    event.preventDefault();
    setFocused(day);
    scroller.current?.querySelector<HTMLElement>(`[data-day="${day}"]`)?.focus();
  };
  useLayoutEffect(() => {
    const element = scroller.current;
    if (element) element.scrollLeft = element.scrollWidth;
  }, [weeks]);

  return (
    <Box component="section" aria-label={t('completed.heatmap')} sx={{ ...shades, ...gridStyles }}>
      <Box ref={scroller} sx={{ overflowX: 'auto', pb: 0.5 }}>
        <Box
          onKeyDown={move}
          sx={{
            display: 'grid',
            gridTemplateRows: `${CELL}px repeat(7, ${CELL}px)`,
            gridAutoFlow: 'column',
            gridAutoColumns: `${CELL}px`,
            gap: `${GAP}px`,
            width: 'max-content',
            pr: 0.5,
          }}
        >
          {columns.map((week) => {
            // The month's name over the week its first day falls in.
            const first = week.find((day) => day?.endsWith('-01'));
            const label = first ? monthShort.format(new Date(`${first}T12:00:00Z`)) : '';
            return (
              <Fragment key={week.find((day) => day !== null) ?? 'end'}>
                <span className="heat-month" aria-hidden>
                  {label}
                </span>
                {week.map((day, row) =>
                  day ? (
                    <button
                      key={day}
                      type="button"
                      className="heat-day"
                      data-day={day}
                      tabIndex={day === stop ? 0 : -1}
                      onFocus={() => setFocused(day)}
                      data-heat={level(counts.get(day) ?? 0)}
                      data-today={day === today ? '' : undefined}
                      aria-pressed={day === selected}
                      aria-label={heatDayLabel(day, today, counts.get(day) ?? 0)}
                      title={heatDayLabel(day, today, counts.get(day) ?? 0)}
                      onClick={() => onSelect(day === selected ? null : day)}
                    />
                  ) : (
                    <span key={`none-${row}`} aria-hidden />
                  ),
                )}
              </Fragment>
            );
          })}
        </Box>
      </Box>
      <Box
        aria-hidden
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: '3px',
          justifyContent: 'flex-end',
          mt: 0.5,
        }}
      >
        <Typography variant="caption" color="text.secondary" sx={{ mr: 0.5 }}>
          {t('completed.fewer')}
        </Typography>
        {[0, 1, 2, 3].map((level) => (
          <span key={level} className="heat-swatch" data-heat={level} />
        ))}
        <Typography variant="caption" color="text.secondary" sx={{ ml: 0.5 }}>
          {t('completed.more')}
        </Typography>
      </Box>
    </Box>
  );
}
