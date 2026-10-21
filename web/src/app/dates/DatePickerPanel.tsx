import AccessTimeRounded from '@mui/icons-material/AccessTimeRounded';
import CalendarTodayOutlined from '@mui/icons-material/CalendarTodayOutlined';
import ChevronRightRounded from '@mui/icons-material/ChevronRightRounded';
import CloseRounded from '@mui/icons-material/CloseRounded';
import NightlightOutlined from '@mui/icons-material/NightlightOutlined';
import WbSunnyOutlined from '@mui/icons-material/WbSunnyOutlined';
import WbTwilightOutlined from '@mui/icons-material/WbTwilightOutlined';
import {
  Box,
  Button,
  ButtonBase,
  Divider,
  IconButton,
  Stack,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { useState, type ReactNode } from 'react';
import { addDays, shiftMonths } from '../../core/dates.ts';
import { formatTime } from '../format.ts';
import { t } from '../i18n/i18n.ts';
import { DEFAULT_TIME, EVENING, type DateValue } from './dateValue.ts';
import { MonthCalendar } from './MonthCalendar.tsx';
import { TimeInput } from './TimeInput.tsx';
import { TimeWheels } from './TimeWheels.tsx';

function NextWeekIcon() {
  return (
    <Box sx={{ position: 'relative', display: 'inline-flex' }}>
      <CalendarTodayOutlined />
      <Box
        component="span"
        sx={{
          position: 'absolute',
          inset: 0,
          top: 5,
          fontSize: 9,
          fontWeight: 700,
          textAlign: 'center',
        }}
      >
        +7
      </Box>
    </Box>
  );
}

function NextMonthIcon() {
  return (
    <Box sx={{ position: 'relative', display: 'inline-flex' }}>
      <CalendarTodayOutlined />
      <Box
        component="span"
        sx={{
          position: 'absolute',
          inset: 0,
          top: 5,
          fontSize: 9,
          fontWeight: 700,
          textAlign: 'center',
        }}
      >
        +1
      </Box>
    </Box>
  );
}

/** A compact quick-pick icon with what it sets ("Thu", "Oct 28") tucked in its lower left. */
function QuickPick({
  label,
  icon,
  hint,
  active,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  hint: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip title={`${label}: ${hint}`}>
      <IconButton
        aria-label={label}
        aria-pressed={active}
        onClick={onClick}
        sx={{
          position: 'relative',
          width: 48,
          height: 44,
          borderRadius: 2,
          color: active ? 'primary.main' : 'text.secondary',
          bgcolor: active ? 'action.selected' : 'transparent',
        }}
      >
        {/* Nudged up and right to leave the lower left to the hint. */}
        <Box component="span" sx={{ display: 'inline-flex', transform: 'translate(5px, -5px)' }}>
          {icon}
        </Box>
        <Box
          component="span"
          data-testid="quick-hint"
          sx={{
            position: 'absolute',
            left: 2,
            bottom: 2,
            px: '3px',
            borderRadius: 0.75,
            bgcolor: 'background.paper',
            fontSize: 9.5,
            fontWeight: 700,
            lineHeight: '12px',
            whiteSpace: 'nowrap',
          }}
        >
          {hint}
        </Box>
      </IconButton>
    </Tooltip>
  );
}

/**
 * The date picker body: quick picks, a month calendar, an optional time, Clear and OK.
 * Quick picks apply immediately; calendar and time changes apply on OK.
 */
export function DatePickerPanel({
  value,
  today,
  onApply,
  onCancel,
}: {
  value: DateValue | null;
  today: string;
  onApply: (value: DateValue | null) => void;
  onCancel: () => void;
}) {
  const [date, setDate] = useState<string | null>(value?.date ?? null);
  const [time, setTime] = useState<string | null>(value?.time ?? null);
  const [editingTime, setEditingTime] = useState(false);
  // Phones, tablets and anything with a touch screen get hour / minute / AM-PM wheels;
  // large mouse-and-keyboard screens get the typed field. (Many tablets report a fine
  // pointer, especially with a keyboard attached, so screen size counts too.)
  const theme = useTheme();
  const anyTouch = useMediaQuery('(any-pointer: coarse)', { noSsr: true });
  const smallScreen = useMediaQuery(theme.breakpoints.down('lg'), { noSsr: true });
  const touch = anyTouch || smallScreen;
  const startEditingTime = () => {
    setEditingTime(true);
    if (touch && !time) {
      // Wheels always show a value, so start from it rather than "no time".
      setTime(DEFAULT_TIME);
      if (!date) setDate(today);
    }
  };

  const weekdayShort = new Intl.DateTimeFormat(undefined, { weekday: 'short', timeZone: 'UTC' });
  const monthDay = new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
  const atNoon = (date: string) => new Date(`${date}T12:00:00Z`);
  const nextWeek = addDays(today, 7);
  const nextMonth = shiftMonths(today, 1);
  const quick = [
    {
      label: t('date.today'),
      icon: <WbSunnyOutlined />,
      hint: weekdayShort.format(atNoon(today)),
      value: { date: today, time: null },
    },
    {
      label: t('date.tomorrow'),
      icon: <WbTwilightOutlined />,
      hint: weekdayShort.format(atNoon(addDays(today, 1))),
      value: { date: addDays(today, 1), time: null },
    },
    {
      label: t('date.nextWeek'),
      icon: <NextWeekIcon />,
      hint: monthDay.format(atNoon(nextWeek)),
      value: { date: nextWeek, time: null },
    },
    {
      label: t('date.nextMonth'),
      icon: <NextMonthIcon />,
      hint: monthDay.format(atNoon(nextMonth)),
      value: { date: nextMonth, time: null },
    },
    {
      label: t('date.tonight'),
      icon: <NightlightOutlined />,
      hint: formatTime(EVENING).replace(':00', ''),
      value: { date: today, time: EVENING },
    },
  ];

  return (
    <Box sx={{ width: 300, maxWidth: '100%', p: 1.5 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
        {quick.map((pick) => (
          <QuickPick
            key={pick.label}
            label={pick.label}
            icon={pick.icon}
            hint={pick.hint}
            active={date === pick.value.date && time === pick.value.time}
            onClick={() => onApply(pick.value)}
          />
        ))}
      </Box>

      <MonthCalendar selected={date} today={today} onSelect={setDate} />

      <Divider sx={{ my: 1 }} />

      {editingTime ? (
        <Box
          sx={{
            display: 'flex',
            alignItems: touch ? 'center' : 'flex-start',
            gap: 1,
            px: 1,
            pt: 0.5,
          }}
        >
          <AccessTimeRounded fontSize="small" color="action" sx={{ mt: 1 }} />
          {touch ? (
            <Box sx={{ flexGrow: 1 }}>
              <TimeWheels value={time} onChange={setTime} />
            </Box>
          ) : (
            <TimeInput
              value={time}
              autoFocus
              onChange={(next) => {
                setTime(next);
                if (next && !date) setDate(today);
              }}
            />
          )}
          <IconButton
            size="small"
            aria-label={t('date.removeTime')}
            onClick={() => {
              setTime(null);
              setEditingTime(false);
            }}
          >
            <CloseRounded fontSize="small" />
          </IconButton>
        </Box>
      ) : (
        <ButtonBase
          onClick={startEditingTime}
          sx={{
            width: '100%',
            display: 'flex',
            gap: 1.5,
            px: 1,
            py: 1,
            borderRadius: 2,
            '&:hover': { bgcolor: 'action.hover' },
          }}
        >
          <AccessTimeRounded fontSize="small" color="action" />
          <Typography sx={{ flexGrow: 1, textAlign: 'left' }}>{t('date.time')}</Typography>
          {time && (
            <Typography color="text.secondary" variant="body2">
              {formatTime(time)}
            </Typography>
          )}
          <ChevronRightRounded fontSize="small" color="action" />
        </ButtonBase>
      )}

      <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
        <Button fullWidth variant="outlined" onClick={() => onApply(null)}>
          {t('date.clear')}
        </Button>
        <Button
          fullWidth
          variant="contained"
          disableElevation
          onClick={() => (date ? onApply({ date, time }) : onCancel())}
        >
          {t('common.ok')}
        </Button>
      </Stack>
    </Box>
  );
}
