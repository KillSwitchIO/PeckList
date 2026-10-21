import ChevronLeftRounded from '@mui/icons-material/ChevronLeftRounded';
import ChevronRightRounded from '@mui/icons-material/ChevronRightRounded';
import RadioButtonUncheckedRounded from '@mui/icons-material/RadioButtonUncheckedRounded';
import { Box, ButtonBase, IconButton, Tooltip, Typography } from '@mui/material';
import { useRef, useState } from 'react';
import { addDays, addMonths, monthGrid, monthOf } from '../../core/dates.ts';
import { t } from '../i18n/i18n.ts';

const DAY = 36;

function utc(date: string): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d, 12));
}

function weekdayLabels(locale: string | undefined, weekStartsOn: number): string[] {
  const format = new Intl.DateTimeFormat(locale, { weekday: 'narrow', timeZone: 'UTC' });
  // 2026-10-18 is a Sunday.
  return Array.from({ length: 7 }, (_, i) =>
    format.format(utc(addDays('2026-10-18', i + weekStartsOn))),
  );
}

/** Month grid with today marked and the selected day filled. Arrow keys move the focus. */
export function MonthCalendar({
  selected,
  today,
  onSelect,
  weekStartsOn = 0,
  locale,
}: {
  selected: string | null;
  today: string;
  onSelect: (date: string) => void;
  weekStartsOn?: number;
  locale?: string;
}) {
  const [shown, setShown] = useState(`${monthOf(selected ?? today)}-01`);
  const [focused, setFocused] = useState(selected ?? today);
  const grid = useRef<HTMLDivElement>(null);
  const days = monthGrid(shown, weekStartsOn);
  const title = new Intl.DateTimeFormat(locale, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(utc(shown));
  const dayLabel = new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeZone: 'UTC' });

  const moveFocus = (date: string) => {
    setFocused(date);
    if (monthOf(date) !== monthOf(shown)) setShown(`${monthOf(date)}-01`);
    requestAnimationFrame(() =>
      grid.current?.querySelector<HTMLElement>(`[data-date="${date}"]`)?.focus(),
    );
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
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
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', px: 0.5, mb: 0.5 }}>
        <Typography sx={{ flexGrow: 1, fontWeight: 600 }} aria-live="polite">
          {title}
        </Typography>
        <IconButton
          size="small"
          aria-label={t('calendar.previousMonth')}
          onClick={() => setShown(addMonths(shown, -1))}
        >
          <ChevronLeftRounded fontSize="small" />
        </IconButton>
        <Tooltip title={t('calendar.goToToday')}>
          <IconButton
            size="small"
            aria-label={t('calendar.goToToday')}
            onClick={() => {
              setShown(`${monthOf(today)}-01`);
              setFocused(today);
            }}
          >
            <RadioButtonUncheckedRounded sx={{ fontSize: 12 }} />
          </IconButton>
        </Tooltip>
        <IconButton
          size="small"
          aria-label={t('calendar.nextMonth')}
          onClick={() => setShown(addMonths(shown, 1))}
        >
          <ChevronRightRounded fontSize="small" />
        </IconButton>
      </Box>

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
            sx={{ textAlign: 'center', lineHeight: `${DAY - 8}px` }}
          >
            {label}
          </Typography>
        ))}
      </Box>

      <Box
        ref={grid}
        role="grid"
        aria-label={title}
        onKeyDown={onKeyDown}
        sx={{
          display: 'grid',
          gridTemplateColumns: `repeat(7, ${DAY}px)`,
          justifyContent: 'space-between',
          rowGap: 0.25,
        }}
      >
        {days.map((date) => {
          const inMonth = monthOf(date) === monthOf(shown);
          const isSelected = date === selected;
          const isToday = date === today;
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
                typography: 'body2',
                fontWeight: isToday || isSelected ? 600 : 400,
                color: isSelected
                  ? 'primary.contrastText'
                  : isToday
                    ? 'primary.main'
                    : inMonth
                      ? 'text.primary'
                      : 'text.disabled',
                bgcolor: isSelected ? 'primary.main' : 'transparent',
                '&:hover': { bgcolor: isSelected ? 'primary.main' : 'action.hover' },
                '&.Mui-focusVisible': {
                  outline: 2,
                  outlineColor: 'primary.main',
                  outlineStyle: 'solid',
                },
              }}
            >
              {Number(date.slice(8))}
            </ButtonBase>
          );
        })}
      </Box>
    </Box>
  );
}
