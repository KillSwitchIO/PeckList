import RadioButtonUncheckedRounded from '@mui/icons-material/RadioButtonUncheckedRounded';
import { Box, ButtonBase, IconButton, Tooltip, Typography } from '@mui/material';
import { useMemo, useState } from 'react';
import { addDays, addMonths, datePart, monthGrid, monthOf, weekday } from '../../core/dates.ts';
import { isLive } from '../../core/collections.ts';
import { useToday } from '../hooks/useToday.ts';
import { t } from '../i18n/i18n.ts';
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronUpIcon,
} from '../icons/icons.tsx';
import { useWorkspace } from '../store/hooks.ts';
import { weekdayInitials, monthTitle } from './miniCalendarText.ts';

/** What the grid shows: days, the months of a year, or twelve years. */
type Level = 'days' | 'months' | 'years';

const monthShort = new Intl.DateTimeFormat(undefined, { month: 'short', timeZone: 'UTC' });
const monthLong = new Intl.DateTimeFormat(undefined, { month: 'long', timeZone: 'UTC' });

/** The first day of the week holding `date`, starting on `weekStart` (0 Sunday). */
function weekOf(date: string, weekStart: number): string {
  return addDays(date, -((weekday(date) - weekStart + 7) % 7));
}

/**
 * A small month at the bottom of the sidebar (spec: PL-090): days with open tasks get a dot, and a
 * click opens that day's tasks (Today for today). It steps a month at a time, or folds down to one
 * week and steps a week at a time, like TickTick's. The title zooms out, to the months of the
 * year and then to years, to jump far; the dot between the arrows goes back to now.
 */
export function MiniCalendar({
  onPick,
  selected = null,
}: {
  onPick: (date: string) => void;
  /** The day open in the main view, if any, to ring. */
  selected?: string | null;
}) {
  const today = useToday();
  const workspace = useWorkspace();
  const weekStart = workspace.entities.settings[0]?.weekStart ?? 0;
  // Always starts folded to one week, so the sidebar's lists keep the room (Ben, R-FB-76).
  const [folded, setFolded] = useState(true);
  const [month, setMonth] = useState(() => monthOf(today));
  const [week, setWeek] = useState(() => weekOf(selected ?? today, weekStart));
  const [level, setLevel] = useState<Level>('days');
  const [year, setYear] = useState(() => Number(today.slice(0, 4)));
  // Twelve years a page, in dozens.
  const firstYear = year - (((year % 12) + 12) % 12);
  const days = folded
    ? Array.from({ length: 7 }, (_, index) => addDays(week, index))
    : monthGrid(month, weekStart);
  // A folded week across two months is titled by the month most of it is in.
  const shownMonth = folded ? monthOf(addDays(week, 3)) : month;
  const busy = useMemo(() => {
    const dates = new Set<string>();
    for (const task of workspace.entities.tasks) {
      if (task.status === 'open' && isLive(task) && task.schedule)
        dates.add(datePart(task.schedule.start));
    }
    return dates;
  }, [workspace.entities.tasks]);

  const fold = (next: boolean) => {
    setFolded(next);
    // Folding shows the week of what is open, else this week; unfolding, that week's month.
    if (next) setWeek(weekOf(selected ?? today, weekStart));
    else setMonth(monthOf(addDays(week, 3)));
  };
  const step = (by: number) => {
    if (level === 'months') setYear(year + by);
    else if (level === 'years') setYear(year + 12 * by);
    else if (folded) setWeek(addDays(week, 7 * by));
    else setMonth(monthOf(addMonths(month, by)));
  };
  const backToNow = () => {
    setLevel('days');
    setYear(Number(today.slice(0, 4)));
    if (folded) setWeek(weekOf(today, weekStart));
    else setMonth(monthOf(today));
  };
  const zoomOut = () => {
    if (level === 'days') {
      setYear(Number(shownMonth.slice(0, 4)));
      setLevel('months');
    } else if (level === 'months') {
      setLevel('years');
    }
  };
  const openMonth = (picked: string) => {
    setLevel('days');
    setMonth(picked);
    setWeek(weekOf(`${picked}-01`, weekStart));
  };
  const title =
    level === 'years'
      ? `${firstYear} - ${firstYear + 11}`
      : level === 'months'
        ? String(year)
        : monthTitle(shownMonth, today);
  const pickCell = {
    height: 30,
    borderRadius: 1,
    fontSize: 11,
    '&:hover': { bgcolor: 'action.hover' },
  } as const;

  return (
    <Box
      component="section"
      aria-label={t('miniCalendar.label')}
      sx={{
        px: 1.5,
        pb: 1,
        // Short windows keep the room for lists and tags; a folded week is small enough to stay.
        ...(folded ? {} : { '@media (max-height: 760px)': { display: 'none' } }),
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center' }}>
        <ButtonBase
          onClick={zoomOut}
          disabled={level === 'years'}
          aria-label={
            level === 'days'
              ? t('miniCalendar.pickMonth', { title })
              : level === 'months'
                ? t('miniCalendar.pickYear', { title })
                : title
          }
          sx={{
            borderRadius: 1,
            px: 0.5,
            mr: 'auto',
            '&:hover': { bgcolor: 'action.hover' },
            '&.Mui-disabled': { color: 'text.primary' },
          }}
        >
          <Typography variant="caption" sx={{ fontWeight: 600 }} aria-live="polite">
            {title}
          </Typography>
        </ButtonBase>
        <IconButton
          size="small"
          aria-label={
            level === 'months'
              ? t('miniCalendar.previousYear')
              : level === 'years'
                ? t('miniCalendar.previousYears')
                : folded
                  ? t('miniCalendar.previousWeek')
                  : t('miniCalendar.previous')
          }
          onClick={() => step(-1)}
        >
          <ChevronLeftIcon sx={{ fontSize: 16 }} />
        </IconButton>
        <Tooltip title={folded ? t('miniCalendar.thisWeek') : t('miniCalendar.thisMonth')}>
          <IconButton
            size="small"
            aria-label={folded ? t('miniCalendar.thisWeek') : t('miniCalendar.thisMonth')}
            onClick={backToNow}
          >
            <RadioButtonUncheckedRounded sx={{ fontSize: 10 }} />
          </IconButton>
        </Tooltip>
        <IconButton
          size="small"
          aria-label={
            level === 'months'
              ? t('miniCalendar.nextYear')
              : level === 'years'
                ? t('miniCalendar.nextYears')
                : folded
                  ? t('miniCalendar.nextWeek')
                  : t('miniCalendar.next')
          }
          onClick={() => step(1)}
        >
          <ChevronRightIcon sx={{ fontSize: 16 }} />
        </IconButton>
        <Tooltip
          title={folded ? t('miniCalendar.unfold') : t('miniCalendar.fold')}
          disableFocusListener
        >
          <IconButton
            size="small"
            aria-label={folded ? t('miniCalendar.unfold') : t('miniCalendar.fold')}
            aria-expanded={!folded}
            onClick={() => fold(!folded)}
          >
            {/* At the bottom of the sidebar it grows upward: folded points up, open points down. */}
            {folded ? (
              <ChevronUpIcon sx={{ fontSize: 16 }} />
            ) : (
              <ChevronDownIcon sx={{ fontSize: 16 }} />
            )}
          </IconButton>
        </Tooltip>
      </Box>
      {level === 'months' && (
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 0.5, py: 0.5 }}>
          {Array.from({ length: 12 }, (_, index) => {
            const value = `${year}-${String(index + 1).padStart(2, '0')}`;
            const at = new Date(Date.UTC(year, index, 15));
            const current = value === monthOf(today);
            return (
              <ButtonBase
                key={value}
                aria-label={`${monthLong.format(at)} ${year}`}
                {...(current ? { 'aria-current': 'date' as const } : {})}
                onClick={() => openMonth(value)}
                sx={{
                  ...pickCell,
                  fontWeight: current ? 700 : 400,
                  color: current ? 'primary.main' : 'text.primary',
                }}
              >
                {monthShort.format(at)}
              </ButtonBase>
            );
          })}
        </Box>
      )}
      {level === 'years' && (
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 0.5, py: 0.5 }}>
          {Array.from({ length: 12 }, (_, index) => {
            const value = firstYear + index;
            const current = value === Number(today.slice(0, 4));
            return (
              <ButtonBase
                key={value}
                aria-label={String(value)}
                {...(current ? { 'aria-current': 'date' as const } : {})}
                onClick={() => {
                  setYear(value);
                  setLevel('months');
                }}
                sx={{
                  ...pickCell,
                  fontWeight: current ? 700 : 400,
                  color: current ? 'primary.main' : 'text.primary',
                }}
              >
                {value}
              </ButtonBase>
            );
          })}
        </Box>
      )}
      <Box
        role="grid"
        aria-label={monthTitle(shownMonth, today)}
        sx={{
          display: level === 'days' ? 'grid' : 'none',
          gridTemplateColumns: 'repeat(7, 1fr)',
          textAlign: 'center',
        }}
      >
        {weekdayInitials(weekStart).map((letter, index) => (
          <Typography
            key={index}
            variant="caption"
            color="text.secondary"
            aria-hidden
            sx={{ fontSize: 10, lineHeight: '20px' }}
          >
            {letter}
          </Typography>
        ))}
        {days.map((day) => {
          const inMonth = folded || day.startsWith(month);
          const isToday = day === today;
          const isOpen = day === selected && !isToday;
          return (
            <ButtonBase
              key={day}
              role="gridcell"
              aria-label={t(busy.has(day) ? 'miniCalendar.dayBusy' : 'miniCalendar.day', {
                date: day,
              })}
              aria-current={isToday ? 'date' : undefined}
              aria-selected={day === selected}
              onClick={() => onPick(day)}
              sx={{
                position: 'relative',
                height: 26,
                borderRadius: '50%',
                fontSize: 11,
                color: inMonth ? 'text.primary' : 'text.disabled',
                fontWeight: isToday || isOpen ? 700 : 400,
                bgcolor: isToday ? 'primary.main' : isOpen ? 'action.selected' : undefined,
                ...(isToday ? { color: 'primary.contrastText' } : {}),
                '&:hover': { bgcolor: isToday ? 'primary.dark' : 'action.hover' },
              }}
            >
              {Number(day.slice(8))}
              {busy.has(day) && !isToday && (
                <Box
                  component="span"
                  sx={{
                    position: 'absolute',
                    bottom: 2,
                    width: 3,
                    height: 3,
                    borderRadius: '50%',
                    bgcolor: inMonth ? 'primary.main' : 'text.disabled',
                  }}
                />
              )}
            </ButtonBase>
          );
        })}
      </Box>
    </Box>
  );
}
