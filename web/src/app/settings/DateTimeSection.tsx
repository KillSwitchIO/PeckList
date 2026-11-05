import { MenuItem, TextField, ToggleButton, ToggleButtonGroup } from '@mui/material';
import { ALL_DAY_REMINDER_TIME, allDayReminderTimeOf } from '../../core/reminders.ts';
import {
  DUE_SOON_CHOICES,
  POINT_EVENT_CHOICES,
  updateSettings,
  type SettingsPatch,
} from '../../core/settings.ts';
import { TimeField } from '../dates/TimeField.tsx';
import { t } from '../i18n/i18n.ts';
import { useApply, useWorkspace } from '../store/hooks.ts';
import { DateFormatSetting } from './DateFormatSetting.tsx';
import { Section, SettingRow } from './settingsLayout.tsx';
import { TimeZoneSetting } from './TimeZoneSetting.tsx';

/** Settings > Date and time: how dates read, and when they count as near. */
export function DateTimeSection() {
  const workspace = useWorkspace();
  const apply = useApply();
  const settings = workspace.entities.settings[0];
  const change = (patch: SettingsPatch) => apply((ctx, ws) => updateSettings(ctx, ws, patch));
  return (
    <Section title={t('settings.dates')} plain>
      <TimeZoneSetting
        value={settings?.timeZone ?? null}
        onChange={(timeZone) => change({ timeZone })}
      />
      <DateFormatSetting
        value={settings?.dateFormat ?? null}
        onChange={(dateFormat) => change({ dateFormat })}
      />
      <SettingRow label={t('settings.clock')}>
        <ToggleButtonGroup
          exclusive
          size="small"
          value={settings?.clockFormat ?? '12h'}
          aria-label={t('settings.clock')}
          onChange={(_, next: '12h' | '24h' | null) => next && change({ clockFormat: next })}
        >
          <ToggleButton value="12h">{t('settings.clock.12h')}</ToggleButton>
          <ToggleButton value="24h">{t('settings.clock.24h')}</ToggleButton>
        </ToggleButtonGroup>
      </SettingRow>
      <SettingRow label={t('settings.weekStart')}>
        <ToggleButtonGroup
          exclusive
          size="small"
          value={settings?.weekStart ?? 0}
          aria-label={t('settings.weekStart')}
          onChange={(_, next: 0 | 1 | null) => next !== null && change({ weekStart: next })}
        >
          <ToggleButton value={0}>{t('settings.weekStart.sunday')}</ToggleButton>
          <ToggleButton value={1}>{t('settings.weekStart.monday')}</ToggleButton>
        </ToggleButtonGroup>
      </SettingRow>
      <SettingRow label={t('settings.dueSoon')} hint={t('settings.dueSoonHint')}>
        <TextField
          select
          size="small"
          value={settings?.dueSoonDays ?? 2}
          onChange={(event) => change({ dueSoonDays: Number(event.target.value) })}
          slotProps={{ htmlInput: { 'aria-label': t('settings.dueSoon') } }}
        >
          {DUE_SOON_CHOICES.map((days) => (
            <MenuItem key={days} value={days}>
              {days === 0
                ? t('settings.dueSoon.off')
                : days === 1
                  ? t('settings.dueSoon.one')
                  : t('settings.dueSoon.days', { days })}
            </MenuItem>
          ))}
        </TextField>
      </SettingRow>
      <SettingRow label={t('settings.pointEvent')} hint={t('settings.pointEventHint')}>
        <TextField
          select
          size="small"
          value={settings?.pointEventMinutes ?? 60}
          onChange={(event) => change({ pointEventMinutes: Number(event.target.value) })}
          slotProps={{ htmlInput: { 'aria-label': t('settings.pointEvent') } }}
        >
          {POINT_EVENT_CHOICES.map((minutes) => (
            <MenuItem key={minutes} value={minutes}>
              {minutes < 60
                ? t('settings.minutes', { minutes })
                : minutes === 60
                  ? t('settings.oneHour')
                  : t('settings.hours', { hours: minutes / 60 })}
            </MenuItem>
          ))}
        </TextField>
      </SettingRow>
      <SettingRow label={t('newTask.allDayTime')} hint={t('newTask.allDayTimeHint')}>
        <TimeField
          label={t('newTask.allDayTime')}
          value={allDayReminderTimeOf(workspace)}
          onChange={(time) => change({ allDayReminderTime: time ?? ALL_DAY_REMINDER_TIME })}
        />
      </SettingRow>
    </Section>
  );
}
