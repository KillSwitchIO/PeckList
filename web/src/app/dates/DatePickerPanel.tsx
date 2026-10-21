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
  FormControlLabel,
  IconButton,
  Stack,
  Switch,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { useState, type ReactNode } from 'react';
import { addDays } from '../../core/dates.ts';
import { formatDay, formatTime } from '../format.ts';
import { t } from '../i18n/i18n.ts';
import {
  addHour,
  DEFAULT_TIME,
  EVENING,
  orderedSpan,
  type DatePart,
  type DateValue,
} from './dateValue.ts';
import { MonthCalendar } from './MonthCalendar.tsx';
import { TimeInput } from './TimeInput.tsx';
import { TimeWheels } from './TimeWheels.tsx';

/** A calendar icon with "+7" or "+30" on its face. */
function PlusDaysIcon({ days }: { days: number }) {
  return (
    <Box sx={{ position: 'relative', display: 'inline-flex' }}>
      <CalendarTodayOutlined />
      <Box
        component="span"
        // Centered in the calendar's body: the icon draws it from (4, 10) to (20, 21) of 24.
        sx={{
          position: 'absolute',
          left: 4,
          width: 16,
          top: 10,
          height: 11,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: days >= 10 ? 8 : 9,
          fontWeight: 800,
          lineHeight: 1,
          letterSpacing: days >= 10 ? -0.4 : 0,
        }}
      >
        +{days}
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

/** "Time ........ 9:00 AM >" that opens a typed field (mouse) or wheels (touch). */
function TimeRow({
  time,
  touch,
  onChange,
  onRemove,
  defaultTime = DEFAULT_TIME,
}: {
  time: string | null;
  touch: boolean;
  onChange: (time: string | null) => void;
  onRemove: () => void;
  defaultTime?: string;
}) {
  const [editing, setEditing] = useState(false);
  if (!editing) {
    return (
      <ButtonBase
        onClick={() => {
          setEditing(true);
          // Wheels always show a value, so start from one rather than "no time".
          if (touch && !time) onChange(defaultTime);
        }}
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
    );
  }
  return (
    <Box
      sx={{ display: 'flex', alignItems: touch ? 'center' : 'flex-start', gap: 1, px: 1, pt: 0.5 }}
    >
      <AccessTimeRounded fontSize="small" color="action" sx={{ mt: 1 }} />
      {touch ? (
        <Box sx={{ flexGrow: 1 }}>
          <TimeWheels value={time} onChange={onChange} />
        </Box>
      ) : (
        <TimeInput value={time} autoFocus onChange={onChange} />
      )}
      <IconButton
        size="small"
        aria-label={t('date.removeTime')}
        onClick={() => {
          setEditing(false);
          onRemove();
        }}
      >
        <CloseRounded fontSize="small" />
      </IconButton>
    </Box>
  );
}

/** "Start  Wed, Oct 21  9:00 AM" field in Duration mode; the active one takes calendar picks. */
function SpanField({
  label,
  value,
  allDay,
  active,
  today,
  onClick,
}: {
  label: string;
  value: DatePart;
  allDay: boolean;
  active: boolean;
  today: string;
  onClick: () => void;
}) {
  const text = [formatDay(value.date, today), !allDay && value.time ? formatTime(value.time) : null]
    .filter(Boolean)
    .join(' ');
  return (
    <ButtonBase
      onClick={onClick}
      aria-pressed={active}
      aria-label={`${label}: ${text}`}
      sx={{
        flex: 1,
        minWidth: 0,
        flexDirection: 'column',
        alignItems: 'flex-start',
        px: 1.25,
        py: 0.75,
        borderRadius: 2,
        border: 1.5,
        borderColor: active ? 'primary.main' : 'divider',
        textAlign: 'left',
      }}
    >
      <Typography variant="caption" color={active ? 'primary.main' : 'text.secondary'}>
        {label}
      </Typography>
      <Typography variant="body2" noWrap sx={{ fontWeight: 600, maxWidth: '100%' }}>
        {text}
      </Typography>
    </ButtonBase>
  );
}

/**
 * The date picker body. Date mode: quick picks, the calendar, an optional time. Duration mode
 * (when `allowRange`, TickTick style): Start and End fields, the span shaded on the calendar, an
 * All day switch and a time for the active field. Quick picks apply at once; the rest on OK.
 * "No date" clears.
 */
export function DatePickerPanel({
  value,
  today,
  allowRange = false,
  onApply,
  onCancel,
}: {
  value: DateValue | null;
  today: string;
  allowRange?: boolean;
  onApply: (value: DateValue | null) => void;
  onCancel: () => void;
}) {
  const [mode, setMode] = useState<'date' | 'duration'>(
    allowRange && value?.end ? 'duration' : 'date',
  );
  const [date, setDate] = useState<string | null>(value?.date ?? null);
  const [time, setTime] = useState<string | null>(value?.time ?? null);
  const [end, setEnd] = useState<DatePart | null>(value?.end ?? null);
  const [active, setActive] = useState<'start' | 'end'>('start');
  // Phones, tablets and anything with a touch screen get hour / minute / AM-PM wheels;
  // large mouse-and-keyboard screens get the typed field. (Many tablets report a fine
  // pointer, especially with a keyboard attached, so screen size counts too.)
  const theme = useTheme();
  const anyTouch = useMediaQuery('(any-pointer: coarse)', { noSsr: true });
  const smallScreen = useMediaQuery(theme.breakpoints.down('lg'), { noSsr: true });
  const touch = anyTouch || smallScreen;

  const weekdayShort = new Intl.DateTimeFormat(undefined, { weekday: 'short', timeZone: 'UTC' });
  const monthDay = new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
  const atNoon = (day: string) => new Date(`${day}T12:00:00Z`);
  const quick = [
    { label: t('date.today'), icon: <WbSunnyOutlined />, days: 0 },
    { label: t('date.tomorrow'), icon: <WbTwilightOutlined />, days: 1 },
    { label: t('date.nextWeek'), icon: <PlusDaysIcon days={7} />, days: 7 },
    { label: t('date.inThirtyDays'), icon: <PlusDaysIcon days={30} />, days: 30 },
  ].map((pick) => {
    const day = addDays(today, pick.days);
    return {
      ...pick,
      hint: pick.days < 2 ? weekdayShort.format(atNoon(day)) : monthDay.format(atNoon(day)),
      value: { date: day, time: null } as DatePart,
    };
  });
  quick.push({
    label: t('date.tonight'),
    icon: <NightlightOutlined />,
    days: 0,
    hint: formatTime(EVENING).replace(':00', ''),
    value: { date: today, time: EVENING },
  });

  const start: DatePart = { date: date ?? today, time };
  const allDay = time === null;
  const span = end ? orderedSpan(start, end) : null;

  const enterDuration = () => {
    setMode('duration');
    setActive('start');
    if (!date) setDate(today);
    if (!end) setEnd({ date: date ?? today, time: time ? addHour(time) : null });
  };
  const toggleAllDay = (next: boolean) => {
    if (next) {
      setTime(null);
      setEnd((current) => (current ? { ...current, time: null } : current));
    } else {
      const startTime = time ?? DEFAULT_TIME;
      setTime(startTime);
      setEnd((current) => ({ date: current?.date ?? start.date, time: addHour(startTime) }));
    }
  };
  const pickDay = (day: string) => {
    if (mode === 'date' || active === 'start') {
      setDate(day);
      if (mode === 'duration') {
        // Keep the end at or after the new start, then move on to picking the end.
        if (end && end.date < day) setEnd({ ...end, date: day });
        setActive('end');
      }
    } else {
      setEnd({ date: day, time: end?.time ?? null });
    }
  };

  const apply = () => {
    if (mode === 'duration' && span) {
      onApply({ ...span.start, end: span.end });
    } else if (date) {
      onApply({ date, time });
    } else {
      onCancel();
    }
  };

  return (
    <Box sx={{ width: 300, maxWidth: '100%', p: 1.5 }}>
      {allowRange && (
        <ToggleButtonGroup
          exclusive
          fullWidth
          size="small"
          value={mode}
          onChange={(_, next: 'date' | 'duration' | null) => {
            if (next === 'duration') enterDuration();
            else if (next === 'date') {
              setMode('date');
              setEnd(null);
            }
          }}
          sx={{ mb: 1 }}
        >
          <ToggleButton value="date">{t('date.modeDate')}</ToggleButton>
          <ToggleButton value="duration">{t('date.modeDuration')}</ToggleButton>
        </ToggleButtonGroup>
      )}

      {mode === 'date' ? (
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
      ) : (
        <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
          <SpanField
            label={t('date.start')}
            value={start}
            allDay={allDay}
            active={active === 'start'}
            today={today}
            onClick={() => setActive('start')}
          />
          <SpanField
            label={t('date.end')}
            value={end ?? start}
            allDay={allDay}
            active={active === 'end'}
            today={today}
            onClick={() => setActive('end')}
          />
        </Stack>
      )}

      <MonthCalendar
        selected={mode === 'duration' && active === 'end' ? (end?.date ?? start.date) : date}
        today={today}
        onSelect={pickDay}
        {...(mode === 'duration' && span
          ? { range: { start: span.start.date, end: span.end.date } }
          : {})}
      />

      <Divider sx={{ my: 1 }} />

      {mode === 'duration' && (
        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={allDay}
              onChange={(event) => toggleAllDay(event.target.checked)}
            />
          }
          label={t('date.allDay')}
          sx={{ mx: 0, px: 1, width: '100%', justifyContent: 'space-between' }}
          labelPlacement="start"
        />
      )}

      {mode === 'date' ? (
        <TimeRow
          time={time}
          touch={touch}
          onChange={(next) => {
            setTime(next);
            if (next && !date) setDate(today);
          }}
          onRemove={() => setTime(null)}
        />
      ) : (
        !allDay && (
          <TimeRow
            key={active}
            time={active === 'start' ? time : (end?.time ?? null)}
            touch={touch}
            defaultTime={active === 'start' ? DEFAULT_TIME : addHour(time ?? DEFAULT_TIME)}
            onChange={(next) => {
              if (active === 'start') setTime(next);
              else setEnd({ date: end?.date ?? start.date, time: next });
            }}
            onRemove={() => toggleAllDay(true)}
          />
        )
      )}

      <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
        <Button fullWidth variant="outlined" onClick={() => onApply(null)}>
          {t('date.clear')}
        </Button>
        <Button fullWidth variant="contained" disableElevation onClick={apply}>
          {t('common.ok')}
        </Button>
      </Stack>
    </Box>
  );
}
