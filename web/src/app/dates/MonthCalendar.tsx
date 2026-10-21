import ChevronLeftRounded from '@mui/icons-material/ChevronLeftRounded';
import ChevronRightRounded from '@mui/icons-material/ChevronRightRounded';
import RadioButtonUncheckedRounded from '@mui/icons-material/RadioButtonUncheckedRounded';
import { Box, ButtonBase, IconButton, Tooltip, Typography } from '@mui/material';
import { memo, useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { addDays, addMonths, daysBetween, monthOf } from '../../core/dates.ts';
import { t } from '../i18n/i18n.ts';

const DAY = 36;
/** Height of one week row; the scroller snaps to these. */
const ROW = 38;
/** Weeks in view at once. */
const VISIBLE = 6;
/** Rows rendered around the view (the rest of the years are empty space). */
const BUFFER = 6;
/** A Sunday far back; the week grid counts rows from here. */
const ORIGIN_SUNDAY = '1900-01-07';
const LAST_DAY = '2199-12-31';
const FIRST_YEAR = 1900;
const LAST_YEAR = 2199;

function utc(date: string): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d, 12));
}

function weekdayLabels(locale: string | undefined, weekStartsOn: number): string[] {
  const format = new Intl.DateTimeFormat(locale, { weekday: 'narrow', timeZone: 'UTC' });
  return Array.from({ length: 7 }, (_, i) =>
    format.format(utc(addDays(ORIGIN_SUNDAY, i + weekStartsOn))),
  );
}

type Level = 'days' | 'months' | 'years';

interface Formats {
  monthTitle: Intl.DateTimeFormat;
  monthShort: Intl.DateTimeFormat;
  dayLabel: Intl.DateTimeFormat;
}

// Formatters are costly to build; make them once per locale, not on every scroll frame.
const formatCache = new Map<string, Formats>();
function formatsFor(locale: string | undefined): Formats {
  const key = locale ?? '';
  let formats = formatCache.get(key);
  if (!formats) {
    formats = {
      monthTitle: new Intl.DateTimeFormat(locale, {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      }),
      monthShort: new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' }),
      dayLabel: new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeZone: 'UTC' }),
    };
    formatCache.set(key, formats);
  }
  return formats;
}

/**
 * One week of day cells: plain buttons styled once from the grid, memoized, so scrolling only
 * re-renders rows whose look changes.
 */
const WeekRow = memo(function WeekRow({
  row,
  firstDay,
  shownMonth,
  selected,
  today,
  focused,
  rangeStart,
  rangeEnd,
  formats,
  onPick,
}: {
  row: number;
  firstDay: string;
  shownMonth: string;
  selected: string | null;
  today: string;
  focused: string;
  rangeStart: string | null;
  rangeEnd: string | null;
  formats: Formats;
  onPick: (date: string) => void;
}) {
  return (
    <div role="row" className="week" style={{ transform: `translateY(${row * ROW}px)` }}>
      {Array.from({ length: 7 }, (_, col) => {
        const date = addDays(firstDay, col);
        const isEnd = date === rangeStart || date === rangeEnd;
        const isSelected = date === selected || isEnd;
        const inside =
          rangeStart !== null && rangeEnd !== null && date > rangeStart && date < rangeEnd;
        // Month outline: a thin line where the day above or to the left is in another month,
        // plus the outer sides, so each month reads as its own box.
        const month = monthOf(date);
        const edges = [
          monthOf(addDays(date, -7)) !== month ? 'inset 0 1px 0 var(--month-line)' : null,
          col === 0 || monthOf(addDays(date, -1)) !== month
            ? 'inset 1px 0 0 var(--month-line)'
            : null,
          col === 6 ? 'inset -1px 0 0 var(--month-line)' : null,
        ].filter(Boolean);
        return (
          <button
            key={date}
            type="button"
            role="gridcell"
            data-date={date}
            data-selected={isSelected || undefined}
            data-today={date === today || undefined}
            data-inside={inside || undefined}
            data-muted={monthOf(date) !== shownMonth || undefined}
            tabIndex={date === focused ? 0 : -1}
            aria-selected={isSelected}
            aria-current={date === today ? 'date' : undefined}
            aria-label={formats.dayLabel.format(utc(date))}
            onClick={() => onPick(date)}
            {...(edges.length ? { style: { boxShadow: edges.join(', ') } } : {})}
          >
            <span className="dot">
              {/* The 1st of each month names the month, so scrolling stays oriented. */}
              {date.endsWith('-01') && (
                <span className="month" aria-hidden>
                  {formats.monthShort.format(utc(date))}
                </span>
              )}
              {Number(date.slice(8))}
            </span>
          </button>
        );
      })}
    </div>
  );
});

function Header({
  title,
  onTitle,
  titleHint,
  previousLabel,
  nextLabel,
  onPrevious,
  onNext,
  onToday,
}: {
  title: string;
  onTitle?: () => void;
  titleHint?: string;
  previousLabel: string;
  nextLabel: string;
  onPrevious: () => void;
  onNext: () => void;
  onToday: () => void;
}) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', px: 0.5, mb: 0.5 }}>
      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
        {onTitle ? (
          <Tooltip title={titleHint ?? ''} describeChild>
            <ButtonBase
              onClick={onTitle}
              sx={{
                px: 0.75,
                ml: -0.75,
                py: 0.25,
                borderRadius: 1.5,
                typography: 'body1',
                fontWeight: 600,
                '&:hover': { bgcolor: 'action.hover' },
              }}
            >
              <span aria-live="polite">{title}</span>
            </ButtonBase>
          </Tooltip>
        ) : (
          <Typography sx={{ fontWeight: 600 }} aria-live="polite">
            {title}
          </Typography>
        )}
      </Box>
      <IconButton size="small" aria-label={previousLabel} onClick={onPrevious}>
        <ChevronLeftRounded fontSize="small" />
      </IconButton>
      <Tooltip title={t('calendar.goToToday')}>
        <IconButton size="small" aria-label={t('calendar.goToToday')} onClick={onToday}>
          <RadioButtonUncheckedRounded sx={{ fontSize: 12 }} />
        </IconButton>
      </Tooltip>
      <IconButton size="small" aria-label={nextLabel} onClick={onNext}>
        <ChevronRightRounded fontSize="small" />
      </IconButton>
    </Box>
  );
}

/** A 4 x 3 grid of months or years, the same height as the weeks it replaces. */
function PickGrid({ children }: { children: ReactNode }) {
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 1,
        height: VISIBLE * ROW + 28,
        alignContent: 'center',
      }}
    >
      {children}
    </Box>
  );
}

function PickButton({
  label,
  text,
  current,
  selected,
  onClick,
}: {
  label: string;
  text: string;
  current: boolean;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <ButtonBase
      aria-label={label}
      aria-pressed={selected}
      {...(current ? { 'aria-current': 'date' as const } : {})}
      onClick={onClick}
      sx={{
        height: 44,
        borderRadius: 999,
        typography: 'body2',
        fontWeight: current || selected ? 600 : 400,
        color: (theme) =>
          selected
            ? theme.palette.primary.contrastText
            : current
              ? theme.punchlist.onAccentContainer
              : theme.palette.text.primary,
        bgcolor: (theme) =>
          selected
            ? theme.palette.primary.main
            : current
              ? theme.punchlist.accentContainer
              : 'transparent',
        '&:hover': {
          bgcolor: (theme) =>
            selected
              ? theme.palette.primary.main
              : current
                ? theme.punchlist.accentContainer
                : theme.palette.action.hover,
        },
      }}
    >
      {text}
    </ButtonBase>
  );
}

/**
 * Date grid as a continuous run of weeks (scroll, or page by month), opening with the current
 * week at the top. The title zooms out: days, then the months of a year, then years.
 * Arrow keys move the focused day.
 */
export function MonthCalendar({
  selected,
  today,
  onSelect,
  weekStartsOn = 0,
  locale,
  range,
}: {
  selected: string | null;
  today: string;
  onSelect: (date: string) => void;
  weekStartsOn?: number;
  locale?: string;
  /** A span to shade: its ends are filled, the days between tinted */
  range?: { start: string; end: string };
}) {
  const origin = addDays(ORIGIN_SUNDAY, weekStartsOn);
  const rowOf = (date: string) => Math.floor(daysBetween(origin, date) / 7);
  const dateAt = (row: number, col: number) => addDays(origin, row * 7 + col);
  const totalRows = rowOf(LAST_DAY) + 1;

  // Today's week on top, unless the selection would be out of view: then the selection's week.
  const [topRow, setTopRow] = useState(() => {
    const todayRow = rowOf(today);
    const selectedRow = selected ? rowOf(selected) : todayRow;
    return selectedRow < todayRow || selectedRow >= todayRow + VISIBLE ? selectedRow : todayRow;
  });
  const [focused, setFocused] = useState(selected ?? today);
  const [level, setLevel] = useState<Level>('days');
  const [year, setYear] = useState(Number(today.slice(0, 4)));
  const scroller = useRef<HTMLDivElement>(null);
  const fromScroll = useRef(false);

  // Moves made in code (buttons, keys, zooming back in) scroll the list; a user's own scrolling
  // only updates the state.
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    if (fromScroll.current) {
      fromScroll.current = false;
      return;
    }
    element.scrollTop = topRow * ROW;
  }, [topRow, level]);

  const formats = formatsFor(locale);
  const { monthTitle, monthShort } = formats;
  const frame = useRef<number | null>(null);
  // Stable for the memoized rows.
  const selectRef = useRef(onSelect);
  useLayoutEffect(() => {
    selectRef.current = onSelect;
  });
  const pick = useCallback((date: string) => {
    setFocused(date);
    selectRef.current(date);
  }, []);
  // The month the top week reaches into: the title changes once a month's 1st is on top.
  const shownMonth = `${monthOf(dateAt(topRow, 6))}-01`;
  const title = monthTitle.format(utc(shownMonth));

  const showMonth = (firstOfMonth: string) => setTopRow(rowOf(firstOfMonth));
  const goToToday = () => {
    setLevel('days');
    setTopRow(rowOf(today));
    setFocused(today);
  };

  const moveFocus = (date: string) => {
    setFocused(date);
    const row = rowOf(date);
    if (row < topRow) setTopRow(row);
    else if (row >= topRow + VISIBLE) setTopRow(row - VISIBLE + 1);
    requestAnimationFrame(() =>
      scroller.current?.querySelector<HTMLElement>(`[data-date="${date}"]`)?.focus(),
    );
  };

  if (level === 'months') {
    const selectedMonth = selected ? monthOf(selected) : null;
    return (
      <Box>
        <Header
          title={String(year)}
          onTitle={() => setLevel('years')}
          titleHint={t('calendar.showYears')}
          previousLabel={t('calendar.previousYear')}
          nextLabel={t('calendar.nextYear')}
          onPrevious={() => setYear((value) => Math.max(FIRST_YEAR, value - 1))}
          onNext={() => setYear((value) => Math.min(LAST_YEAR, value + 1))}
          onToday={goToToday}
        />
        <PickGrid>
          {Array.from({ length: 12 }, (_, index) => {
            const month = `${year}-${String(index + 1).padStart(2, '0')}`;
            return (
              <PickButton
                key={month}
                label={monthTitle.format(utc(`${month}-01`))}
                text={monthShort.format(utc(`${month}-01`))}
                current={month === monthOf(today)}
                selected={month === selectedMonth}
                onClick={() => {
                  setLevel('days');
                  showMonth(`${month}-01`);
                }}
              />
            );
          })}
        </PickGrid>
      </Box>
    );
  }

  if (level === 'years') {
    const first = Math.min(Math.max(FIRST_YEAR, year - 5), LAST_YEAR - 11);
    return (
      <Box>
        <Header
          title={`${first} - ${first + 11}`}
          previousLabel={t('calendar.previousYears')}
          nextLabel={t('calendar.nextYears')}
          onPrevious={() => setYear((value) => Math.max(FIRST_YEAR + 5, value - 12))}
          onNext={() => setYear((value) => Math.min(LAST_YEAR - 6, value + 12))}
          onToday={goToToday}
        />
        <PickGrid>
          {Array.from({ length: 12 }, (_, index) => {
            const value = first + index;
            return (
              <PickButton
                key={value}
                label={String(value)}
                text={String(value)}
                current={String(value) === today.slice(0, 4)}
                selected={selected !== null && String(value) === selected.slice(0, 4)}
                onClick={() => {
                  setYear(value);
                  setLevel('months');
                }}
              />
            );
          })}
        </PickGrid>
      </Box>
    );
  }

  const firstRow = Math.max(0, topRow - BUFFER);
  const lastRow = Math.min(totalRows - 1, topRow + VISIBLE + BUFFER - 1);
  const rows = Array.from({ length: lastRow - firstRow + 1 }, (_, index) => firstRow + index);

  return (
    <Box>
      <Header
        title={title}
        onTitle={() => {
          setYear(Number(shownMonth.slice(0, 4)));
          setLevel('months');
        }}
        titleHint={t('calendar.showMonths')}
        previousLabel={t('calendar.previousMonth')}
        nextLabel={t('calendar.nextMonth')}
        onPrevious={() => showMonth(addMonths(shownMonth, -1))}
        onNext={() => showMonth(addMonths(shownMonth, 1))}
        onToday={goToToday}
      />

      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
        {weekdayLabels(locale, weekStartsOn).map((label, index) => (
          <Typography
            key={index}
            variant="caption"
            color="text.secondary"
            aria-hidden
            sx={{ textAlign: 'center', lineHeight: '28px' }}
          >
            {label}
          </Typography>
        ))}
      </Box>

      <Box
        ref={scroller}
        role="grid"
        aria-label={title}
        onScroll={(event) => {
          // At most one update per frame while scrolling.
          const element = event.currentTarget;
          if (frame.current !== null) return;
          frame.current = requestAnimationFrame(() => {
            frame.current = null;
            const next = Math.round(element.scrollTop / ROW);
            if (next !== topRow) {
              fromScroll.current = true;
              setTopRow(next);
            }
          });
        }}
        onKeyDown={(event) => {
          const steps: Record<string, number> = {
            ArrowLeft: -1,
            ArrowRight: 1,
            ArrowUp: -7,
            ArrowDown: 7,
          };
          const step = steps[event.key];
          if (step !== undefined) {
            event.preventDefault();
            moveFocus(addDays(focused, step));
          }
        }}
        sx={(theme) => ({
          position: 'relative',
          height: VISIBLE * ROW,
          overflowY: 'auto',
          overscrollBehavior: 'contain',
          // Gentle snapping: settles on a week without fighting the wheel or trackpad.
          scrollSnapType: 'y proximity',
          scrollbarWidth: 'none',
          '&::-webkit-scrollbar': { display: 'none' },
          '--month-line': theme.palette.divider,
          '& .week': {
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: ROW,
            display: 'grid',
            gridTemplateColumns: 'repeat(7, 1fr)',
            scrollSnapAlign: 'start',
          },
          '& [role=gridcell]': {
            ...theme.typography.body2,
            padding: 0,
            border: 0,
            background: 'transparent',
            cursor: 'pointer',
            display: 'grid',
            placeItems: 'center',
            color: theme.palette.text.primary,
            outline: 'none',
          },
          '& .dot': {
            width: DAY - 2,
            height: DAY - 2,
            borderRadius: '50%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            lineHeight: 1,
          },
          '& [role=gridcell]:hover .dot': { background: theme.palette.action.hover },
          '& [role=gridcell]:focus-visible .dot': {
            outline: `2px solid ${theme.palette.primary.main}`,
          },
          '& [data-muted]': { color: theme.palette.text.secondary },
          // Today: a soft accent fill, clear in light and dark (the selection stays solid).
          '& [data-today] .dot, & [data-today]:hover .dot': {
            background: theme.punchlist.accentContainer,
            color: theme.punchlist.onAccentContainer,
            fontWeight: 700,
          },
          '& [data-inside] .dot': {
            background: theme.palette.action.selected,
            borderRadius: '8px',
          },
          '& [data-selected] .dot, & [data-selected]:hover .dot': {
            background: theme.palette.primary.main,
            color: theme.palette.primary.contrastText,
            fontWeight: 600,
          },
          '& .month': {
            fontSize: 9,
            fontWeight: 700,
            textTransform: 'uppercase',
            marginBottom: '1px',
            // Primary so month starts are quick to spot (white on the filled pick).
            color: theme.palette.primary.main,
          },
          '& [data-selected] .month': { color: 'inherit' },
        })}
      >
        <Box sx={{ position: 'relative', height: totalRows * ROW }}>
          {rows.map((row) => (
            <WeekRow
              key={row}
              row={row}
              firstDay={dateAt(row, 0)}
              shownMonth={monthOf(shownMonth)}
              selected={selected}
              today={today}
              focused={focused}
              rangeStart={range?.start ?? null}
              rangeEnd={range?.end ?? null}
              formats={formats}
              onPick={pick}
            />
          ))}
        </Box>
      </Box>
    </Box>
  );
}
