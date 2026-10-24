import { Box, MenuItem, TextField, Typography } from '@mui/material';
import { useState } from 'react';
import {
  DATE_FORMAT_AUTO,
  DATE_FORMAT_MAX,
  DATE_FORMAT_PRESETS,
  formatDatePattern,
  isDatePattern,
} from '../../core/dateFormat.ts';
import { useToday } from '../hooks/useToday.ts';
import { t } from '../i18n/i18n.ts';
import { SettingRow } from './settingsLayout.tsx';

const CUSTOM = 'custom';
const PRESETS: readonly string[] = DATE_FORMAT_PRESETS;

/**
 * How dates show (Settings > Dates): the language's own, a preset (each shown as today's date
 * looks in it), or a pattern typed in, like YYYYMMDD, with a live example. Today, Tomorrow and
 * Yesterday keep their names.
 */
export function DateFormatSetting({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (format: string) => void;
}) {
  const today = useToday();
  const current = value ?? DATE_FORMAT_AUTO;
  const known = PRESETS.includes(current);
  const [custom, setCustom] = useState(known ? null : current);
  const choice = custom !== null ? CUSTOM : current;
  const example = (pattern: string) =>
    pattern === DATE_FORMAT_AUTO
      ? t('settings.dateFormat.auto', {
          example: new Intl.DateTimeFormat(undefined, {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            timeZone: 'UTC',
          }).format(new Date(`${today}T12:00:00Z`)),
        })
      : `${formatDatePattern(today, pattern)}  (${pattern})`;
  const usable = custom !== null && isDatePattern(custom);

  return (
    <SettingRow label={t('settings.dateFormat')} hint={t('settings.dateFormatHint')}>
      <Box sx={{ display: 'grid', gap: 1, width: 260 }}>
        <TextField
          select
          size="small"
          value={choice}
          onChange={(event) => {
            const next = event.target.value;
            if (next === CUSTOM) {
              setCustom(known ? 'YYYYMMDD' : current);
              return;
            }
            setCustom(null);
            onChange(next);
          }}
          slotProps={{ htmlInput: { 'aria-label': t('settings.dateFormat') } }}
        >
          {DATE_FORMAT_PRESETS.map((pattern) => (
            <MenuItem key={pattern} value={pattern}>
              {example(pattern)}
            </MenuItem>
          ))}
          <MenuItem value={CUSTOM}>{t('settings.dateFormat.custom')}</MenuItem>
        </TextField>
        {custom !== null && (
          <>
            <TextField
              size="small"
              value={custom}
              error={!usable}
              onChange={(event) => {
                const next = event.target.value;
                setCustom(next);
                if (isDatePattern(next)) onChange(next);
              }}
              slotProps={{
                htmlInput: {
                  'aria-label': t('settings.dateFormat.pattern'),
                  maxLength: DATE_FORMAT_MAX,
                  spellCheck: false,
                },
              }}
              helperText={
                usable
                  ? t('settings.dateFormat.looks', { example: formatDatePattern(today, custom) })
                  : t('settings.dateFormat.invalid')
              }
            />
            <Typography variant="caption" color="text.secondary">
              {t('settings.dateFormat.tokens')}
            </Typography>
          </>
        )}
      </Box>
    </SettingRow>
  );
}
