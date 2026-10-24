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

const FOLDED = 'punchlist.miniCalendarFolded';

function loadFolded(): boolean {
  try {
    return localStorage.getItem(FOLDED) === '1';
  } catch {
    return false;
  }
}

/** The first day of the week holding `date`, starting on `weekStart` (0 Sunday). */
function weekOf(date: string, weekStart: number): string {
  return addDays(date, -((weekday(date) - weekStart + 7) % 7));
}

/**
 * A small month at the bottom of the sidebar (spec: PL-090): days with open tasks get a dot, and a
 * click opens that day's tasks (Today for today). It steps a month at a time, or folds down to one
 * week and steps a week at a time, like TickTick's; the title goes back to now.
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
  const [folded, setFolded] = useState(loadFolded);
  const [month, setMonth] = useState(() => monthOf(today));
  const [week, setWeek] = useState(() => weekOf(selected ?? today, weekStart));
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
    try {
      localStorage.setItem(FOLDED, next ? '1' : '0');
    } catch {
      // storage unavailable: folded for this visit only
    }
  };
  const step = (by: number) =>
    folded ? setWeek(addDays(week, 7 * by)) : setMonth(monthOf(addMonths(month, by)));

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
          onClick={() => (folded ? setWeek(weekOf(today, weekStart)) : setMonth(monthOf(today)))}
          aria-label={folded ? t('miniCalendar.thisWeek') : t('miniCalendar.thisMonth')}
          sx={{ borderRadius: 1, px: 0.5, mr: 'auto' }}
        >
          <Typography variant="caption" sx={{ fontWeight: 600 }}>
            {monthTitle(shownMonth)}
          </Typography>
        </ButtonBase>
        <IconButton
          size="small"
          aria-label={folded ? t('miniCalendar.previousWeek') : t('miniCalendar.previous')}
          onClick={() => step(-1)}
        >
          <ChevronLeftIcon sx={{ fontSize: 16 }} />
        </IconButton>
        <IconButton
          size="small"
          aria-label={folded ? t('miniCalendar.nextWeek') : t('miniCalendar.next')}
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
            {folded ? (
              <ChevronDownIcon sx={{ fontSize: 16 }} />
            ) : (
              <ChevronUpIcon sx={{ fontSize: 16 }} />
            )}
          </IconButton>
        </Tooltip>
      </Box>
      <Box
        role="grid"
        aria-label={monthTitle(shownMonth)}
        sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', textAlign: 'center' }}
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
