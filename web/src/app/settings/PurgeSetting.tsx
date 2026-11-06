import { MenuItem, TextField } from '@mui/material';
import { useState } from 'react';
import { PURGE_CHOICES, purgeDaysOf, updateSettings } from '../../core/settings.ts';
import { erasedByShortening } from '../../core/trash.ts';
import { t } from '../i18n/i18n.ts';
import { ConfirmDialog } from '../lists/ListDialog.tsx';
import { useApply, useWorkspace } from '../store/hooks.ts';
import { purgePeriod } from './purgePeriod.ts';
import { SettingRow } from './settingsLayout.tsx';

/**
 * Settings > Your data (PL-130): how long deleted, completed and won't-do tasks stay. A shorter time erases
 * what the Trash holds beyond it at once and for good, so that asks first.
 */
export function PurgeSetting() {
  const workspace = useWorkspace();
  const apply = useApply();
  const [asking, setAsking] = useState<{ days: number; tasks: number } | null>(null);
  const save = (days: number) =>
    apply((ctx, ws) => updateSettings(ctx, ws, { purgeAfterDays: days }));
  const pick = (days: number) => {
    const tasks = erasedByShortening(workspace, days, Date.now());
    if (tasks > 0 && days < purgeDaysOf(workspace)) setAsking({ days, tasks });
    else save(days);
  };
  return (
    <SettingRow label={t('settings.data.purge')} hint={t('settings.data.purgeHint')}>
      <TextField
        select
        size="small"
        value={purgeDaysOf(workspace)}
        onChange={(event) => pick(Number(event.target.value))}
        slotProps={{ htmlInput: { 'aria-label': t('settings.data.purge') } }}
      >
        {PURGE_CHOICES.map((days) => (
          <MenuItem key={days} value={days}>
            {purgePeriod(days)}
          </MenuItem>
        ))}
      </TextField>
      {asking && (
        <ConfirmDialog
          open
          message={t('settings.data.purgeConfirm', {
            tasks: asking.tasks,
            period: purgePeriod(asking.days),
          })}
          confirmLabel={t('settings.data.purgeGo')}
          onClose={() => setAsking(null)}
          onConfirm={() => {
            save(asking.days);
            setAsking(null);
          }}
        />
      )}
    </SettingRow>
  );
}
