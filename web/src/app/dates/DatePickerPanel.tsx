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
import { addDays } from '../../core/dates.ts';
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

function QuickPick({
  label,
  icon,
  active,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip title={label}>
      <IconButton
        aria-label={label}
        aria-pressed={active}
        onClick={onClick}
        sx={{
          color: active ? 'primary.main' : 'text.secondary',
          bgcolor: active ? 'action.selected' : 'transparent',
        }}
      >
        {icon}
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

  const quick = [
    { label: t('date.today'), icon: <WbSunnyOutlined />, value: { date: today, time: null } },
    {
      label: t('date.tomorrow'),
      icon: <WbTwilightOutlined />,
      value: { date: addDays(today, 1), time: null },
    },
    {
      label: t('date.nextWeek'),
      icon: <NextWeekIcon />,
      value: { date: addDays(today, 7), time: null },
    },
    {
      label: t('date.tonight'),
      icon: <NightlightOutlined />,
      value: { date: today, time: EVENING },
    },
  ];

  return (
    <Box sx={{ width: 300, maxWidth: '100%', p: 1.5 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-around', mb: 1 }}>
        {quick.map((pick) => (
          <QuickPick
            key={pick.label}
            label={pick.label}
            icon={pick.icon}
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
