import ChevronLeftRounded from '@mui/icons-material/ChevronLeftRounded';
import ChevronRightRounded from '@mui/icons-material/ChevronRightRounded';
import RadioButtonUncheckedRounded from '@mui/icons-material/RadioButtonUncheckedRounded';
import { Box, ButtonBase, IconButton, Tooltip, Typography } from '@mui/material';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { addDays, addMonths, daysBetween, monthOf } from '../../core/dates.ts';
import { t } from '../i18n/i18n.ts';

const DAY = 36;
/** Height of one week row; the scroller snaps to these. */
const ROW = 38;
/** Weeks in view at once. */
const VISIBLE = 6;
/** Rows rendered around the view (the rest of the years are empty space). */
const BUFFER = 2;
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
        color: selected ? 'primary.contrastText' : current ? 'primary.main' : 'text.primary',
        bgcolor: selected ? 'primary.main' : 'transparent',
        '&:hover': { bgcolor: selected ? 'primary.main' : 'action.hover' },
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

  const monthTitle = new Intl.DateTimeFormat(locale, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const monthShort = new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' });
  const dayLabel = new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeZone: 'UTC' });
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

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: `repeat(7, ${DAY}px)`,
          justifyContent: 'space-between',
        }}
      >
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
          const next = Math.round(event.currentTarget.scrollTop / ROW);
          if (next !== topRow) {
            fromScroll.current = true;
            setTopRow(next);
          }
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
        sx={{
          position: 'relative',
          height: VISIBLE * ROW,
          overflowY: 'auto',
          overscrollBehavior: 'contain',
          scrollSnapType: 'y mandatory',
          scrollbarWidth: 'none',
          '&::-webkit-scrollbar': { display: 'none' },
        }}
      >
        <Box sx={{ position: 'relative', height: totalRows * ROW }}>
          {rows.map((row) => (
            <Box
              key={row}
              role="row"
              sx={{
                position: 'absolute',
                top: row * ROW,
                left: 0,
                right: 0,
                height: ROW,
                display: 'grid',
                gridTemplateColumns: `repeat(7, ${DAY}px)`,
                justifyContent: 'space-between',
                alignItems: 'center',
                scrollSnapAlign: 'start',
              }}
            >
              {Array.from({ length: 7 }, (_, col) => {
                const date = dateAt(row, col);
                const inShownMonth = monthOf(date) === monthOf(shownMonth);
                const isEnd = range !== undefined && (date === range.start || date === range.end);
                const isSelected = date === selected || isEnd;
                const inside = range !== undefined && date > range.start && date < range.end;
                const isToday = date === today;
                const firstOfMonth = date.endsWith('-01');
                return (
                  <ButtonBase
                    key={date}
                    role="gridcell"
                    data-date={date}
                    tabIndex={date === focused ? 0 : -1}
                    aria-selected={isSelected}
                    aria-current={isToday ? 'date' : undefined}
                    aria-label={dayLabel.format(utc(date))}
                    onClick={() => {
                      setFocused(date);
                      onSelect(date);
                    }}
                    sx={{
                      width: DAY,
                      height: DAY,
                      borderRadius: '50%',
                      flexDirection: 'column',
                      lineHeight: 1,
                      typography: 'body2',
                      fontWeight: isToday || isSelected ? 600 : 400,
                      color: isSelected
                        ? 'primary.contrastText'
                        : isToday
                          ? 'primary.main'
                          : inShownMonth
                            ? 'text.primary'
                            : 'text.secondary',
                      bgcolor: isSelected
                        ? 'primary.main'
                        : inside
                          ? 'action.selected'
                          : 'transparent',
                      // Days inside a span join into a band.
                      ...(inside ? { borderRadius: 1 } : {}),
                      '&:hover': { bgcolor: isSelected ? 'primary.main' : 'action.hover' },
                      '&.Mui-focusVisible': {
                        outline: 2,
                        outlineColor: 'primary.main',
                        outlineStyle: 'solid',
                      },
                    }}
                  >
                    {/* The 1st of each month names the month, so scrolling stays oriented. */}
                    {firstOfMonth && (
                      <Box
                        component="span"
                        aria-hidden
                        sx={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', mb: '1px' }}
                      >
                        {monthShort.format(utc(date))}
                      </Box>
                    )}
                    {Number(date.slice(8))}
                  </ButtonBase>
                );
              })}
            </Box>
          ))}
        </Box>
      </Box>
    </Box>
  );
}
