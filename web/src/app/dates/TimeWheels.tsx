import { Box } from '@mui/material';
import { t } from '../i18n/i18n.ts';
import { DEFAULT_TIME } from './dateValue.ts';
import { Wheel } from './Wheel.tsx';

const HOURS = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] as const;
const MINUTES = Array.from({ length: 60 }, (_, i) => i);
const PERIODS = ['AM', 'PM'] as const;

function split(time: string): { hour: number; minute: number; period: 'AM' | 'PM' } {
  const [h, m] = time.split(':').map(Number) as [number, number];
  return { hour: h % 12 === 0 ? 12 : h % 12, minute: m, period: h < 12 ? 'AM' : 'PM' };
}

function join(hour: number, minute: number, period: 'AM' | 'PM'): string {
  const h24 = (hour % 12) + (period === 'PM' ? 12 : 0);
  return `${String(h24).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/**
 * Hour | minute | AM/PM wheels for touch screens. Works on 24-hour `HH:mm` values.
 * (A 24-hour layout without the AM/PM wheel comes with the clock setting, PL-025.)
 */
export function TimeWheels({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (time: string) => void;
}) {
  const { hour, minute, period } = split(value ?? DEFAULT_TIME);
  return (
    <Box
      sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 0.5, py: 0.5 }}
    >
      <Wheel
        label={t('time.hour')}
        options={HOURS}
        value={hour as (typeof HOURS)[number]}
        onChange={(next) => onChange(join(next, minute, period))}
      />
      <Box component="span" aria-hidden sx={{ typography: 'h2', color: 'text.secondary' }}>
        :
      </Box>
      <Wheel
        label={t('time.minute')}
        options={MINUTES}
        value={minute}
        format={(m) => String(m).padStart(2, '0')}
        onChange={(next) => onChange(join(hour, next, period))}
      />
      <Wheel
        label={t('time.period')}
        options={PERIODS}
        value={period}
        onChange={(next) => onChange(join(hour, minute, next))}
      />
    </Box>
  );
}
