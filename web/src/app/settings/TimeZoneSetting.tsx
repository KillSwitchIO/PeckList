import { Autocomplete, TextField } from '@mui/material';
import { useMemo } from 'react';
import { deviceTimeZone } from '../../core/dates.ts';
import { t } from '../i18n/i18n.ts';
import { useSyncState } from '../sync/syncContext.ts';
import { SettingRow } from './settingsLayout.tsx';

const DEFAULT = '';

/** Every IANA zone the browser knows, else a short list (older browsers). */
function zones(): string[] {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    return [
      'UTC',
      'Europe/London',
      'Europe/Berlin',
      'America/New_York',
      'America/Chicago',
      'America/Denver',
      'America/Los_Angeles',
      'Asia/Tokyo',
      'Australia/Sydney',
    ];
  }
}

/**
 * The person's time zone (spec: PL-086): "today", due dates and the calendar follow it. The first
 * choice follows the server's zone (or, without a server, the device's).
 */
export function TimeZoneSetting({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (zone: string | null) => void;
}) {
  const server = useSyncState((state) => state.server?.timeZone ?? null);
  const fallback = server ?? deviceTimeZone();
  const options = useMemo(() => [DEFAULT, ...zones()], []);
  const label = (zone: string) =>
    zone === DEFAULT
      ? t(server ? 'settings.timeZone.server' : 'settings.timeZone.device', {
          zone: fallback.replaceAll('_', ' '),
        })
      : zone.replaceAll('_', ' ');
  return (
    <SettingRow label={t('settings.timeZone')} hint={t('settings.timeZoneHint')}>
      <Autocomplete
        size="small"
        disableClearable
        options={options}
        value={value ?? DEFAULT}
        getOptionLabel={label}
        onChange={(_, next) => onChange(next === DEFAULT ? null : next)}
        sx={{ width: 260 }}
        renderInput={(params) => (
          <TextField
            {...params}
            slotProps={{
              ...params.slotProps,
              htmlInput: { ...params.slotProps.htmlInput, 'aria-label': t('settings.timeZone') },
            }}
          />
        )}
      />
    </SettingRow>
  );
}
