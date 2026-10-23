import { Box, ButtonBase, IconButton, Typography } from '@mui/material';
import { useMemo, useState } from 'react';
import { addMonths, datePart, monthGrid, monthOf } from '../../core/dates.ts';
import { isLive } from '../../core/collections.ts';
import { useToday } from '../hooks/useToday.ts';
import { t } from '../i18n/i18n.ts';
import { ChevronLeftIcon, ChevronRightIcon } from '../icons/icons.tsx';
import { useWorkspace } from '../store/hooks.ts';
import { weekdayInitials, monthTitle } from './miniCalendarText.ts';

/**
 * A small month at the bottom of the sidebar (spec: PL-090): days with open tasks get a dot, and a
 * click opens that day in the calendar. It steps a month at a time and comes back to this month
 * with the title.
 */
export function MiniCalendar({ onPick }: { onPick: (date: string) => void }) {
  const today = useToday();
  const workspace = useWorkspace();
  const weekStart = workspace.entities.settings[0]?.weekStart ?? 0;
  const [month, setMonth] = useState(() => monthOf(today));
  const days = monthGrid(month, weekStart);
  const busy = useMemo(() => {
    const dates = new Set<string>();
    for (const task of workspace.entities.tasks) {
      if (task.status === 'open' && isLive(task) && task.schedule)
        dates.add(datePart(task.schedule.start));
    }
    return dates;
  }, [workspace.entities.tasks]);

  return (
    <Box
      component="section"
      aria-label={t('miniCalendar.label')}
      sx={{
        px: 1.5,
        pb: 1,
        // Short windows keep the room for lists and tags.
        '@media (max-height: 760px)': { display: 'none' },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center' }}>
        <ButtonBase
          onClick={() => setMonth(monthOf(today))}
          aria-label={t('miniCalendar.thisMonth')}
          sx={{ borderRadius: 1, px: 0.5, mr: 'auto' }}
        >
          <Typography variant="caption" sx={{ fontWeight: 600 }}>
            {monthTitle(month)}
          </Typography>
        </ButtonBase>
        <IconButton
          size="small"
          aria-label={t('miniCalendar.previous')}
          onClick={() => setMonth(monthOf(addMonths(month, -1)))}
        >
          <ChevronLeftIcon sx={{ fontSize: 16 }} />
        </IconButton>
        <IconButton
          size="small"
          aria-label={t('miniCalendar.next')}
          onClick={() => setMonth(monthOf(addMonths(month, 1)))}
        >
          <ChevronRightIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Box>
      <Box
        role="grid"
        aria-label={monthTitle(month)}
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
          const inMonth = day.startsWith(month);
          const isToday = day === today;
          return (
            <ButtonBase
              key={day}
              role="gridcell"
              aria-label={t(busy.has(day) ? 'miniCalendar.dayBusy' : 'miniCalendar.day', {
                date: day,
              })}
              aria-current={isToday ? 'date' : undefined}
              onClick={() => onPick(day)}
              sx={{
                position: 'relative',
                height: 26,
                borderRadius: '50%',
                fontSize: 11,
                color: inMonth ? 'text.primary' : 'text.disabled',
                fontWeight: isToday ? 700 : 400,
                bgcolor: isToday ? 'primary.main' : undefined,
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
