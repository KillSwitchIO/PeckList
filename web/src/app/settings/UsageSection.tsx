import { MenuItem, Switch, TextField } from '@mui/material';
import { useEffect, useState } from 'react';
import type { CrashChoice, TelemetryStatus } from '../../ports/sync.ts';
import { t } from '../i18n/i18n.ts';
import { useSyncState } from '../sync/syncContext.ts';
import { applyStatus } from '../telemetry/usage.ts';
import { Section, SettingRow } from './settingsLayout.tsx';

/**
 * The person's own usage switch (PL-116): on, the app counts which views and features they use
 * (never what they write) and their server adds it to its daily report. Synced: one choice for all
 * their devices. Only when the server reports at all.
 */
export function UsageSection() {
  const transport = useSyncState((state) => state.transport);
  const ready = useSyncState((state) => state.phase === 'ready' && state.account !== null);
  const api = ready ? transport.telemetry : undefined;
  const [status, setStatus] = useState<TelemetryStatus | null>(null);

  useEffect(() => {
    if (!api) return;
    let live = true;
    api.status().then(
      (answer) => live && setStatus(answer),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [api]);

  if (!api || !status || (!status.enabled && !status.crashReportsEnabled)) return null;

  const choose = async (choice: { shareUsage?: boolean; crashReports?: CrashChoice }) => {
    const answer = await api.choose(choice);
    setStatus(answer);
    applyStatus(answer);
  };

  return (
    <Section title={t('settings.usage')}>
      {status.enabled && (
        <SettingRow label={t('settings.usage.share')} hint={t('settings.usage.shareHint')}>
          <Switch
            checked={status.shareUsage}
            onChange={(event) => void choose({ shareUsage: event.target.checked })}
            slotProps={{ input: { 'aria-label': t('settings.usage.share') } }}
          />
        </SettingRow>
      )}
      {status.crashReportsEnabled && (
        <SettingRow label={t('settings.usage.crash')} hint={t('settings.usage.crashHint')}>
          <TextField
            select
            size="small"
            value={status.crashReports}
            onChange={(event) => void choose({ crashReports: event.target.value as CrashChoice })}
            slotProps={{ htmlInput: { 'aria-label': t('settings.usage.crash') } }}
          >
            {(['ask', 'always', 'never'] as const).map((each) => (
              <MenuItem key={each} value={each}>
                {t(`settings.usage.crash.${each}`)}
              </MenuItem>
            ))}
          </TextField>
        </SettingRow>
      )}
    </Section>
  );
}
