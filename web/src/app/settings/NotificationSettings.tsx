import { Alert, Switch } from '@mui/material';
import { useEffect, useState } from 'react';
import { t } from '../i18n/i18n.ts';
import { browserPush } from '../reminders/notifier.ts';
import { useSyncState } from '../sync/syncContext.ts';
import { Section, SettingRow } from './settingsLayout.tsx';

type State = 'checking' | 'on' | 'off' | 'unsupported' | 'blocked' | 'failed';

/**
 * Settings > Notifications (spec: PL-061): Web Push for this device, so reminders and
 * notifications arrive with Punchlist closed. Each device turns it on for itself.
 */
export function NotificationSettings() {
  const api = useSyncState((state) => state.transport.push);
  const ready = useSyncState((state) => state.phase === 'ready');
  const [checked, setState] = useState<State>('checking');
  const [supported] = useState(() => browserPush().supported());
  const state: State = supported ? checked : 'unsupported';

  useEffect(() => {
    if (!api || !ready || !supported) return;
    const push = browserPush();
    let current = true;
    push.current().then(
      (subscription) => {
        if (!current) return;
        setState(subscription ? 'on' : 'off');
        // Already on here: make sure the server has it (it may have been restored or moved).
        if (subscription) void api.subscribe(subscription).catch(() => undefined);
      },
      () => current && setState('off'),
    );
    return () => {
      current = false;
    };
  }, [api, ready, supported]);

  if (!api || !ready) return null;

  const turn = async (on: boolean) => {
    const push = browserPush();
    setState('checking');
    try {
      if (on) {
        const subscription = await push.subscribe(await api.key());
        await api.subscribe(subscription);
        setState('on');
      } else {
        const endpoint = await push.unsubscribe();
        if (endpoint) await api.unsubscribe(endpoint);
        setState('off');
      }
    } catch {
      setState(Notification.permission === 'denied' ? 'blocked' : 'failed');
    }
  };

  return (
    <Section title={t('notifications.settings')}>
      <SettingRow label={t('notifications.push')} hint={t('notifications.pushHint')}>
        <Switch
          checked={state === 'on'}
          disabled={state === 'checking' || state === 'unsupported'}
          onChange={(event) => void turn(event.target.checked)}
          slotProps={{ input: { 'aria-label': t('notifications.push') } }}
        />
      </SettingRow>
      {state === 'unsupported' && (
        <Alert severity="info" variant="outlined" sx={{ mx: 1 }}>
          {t('notifications.pushUnsupported')}
        </Alert>
      )}
      {state === 'blocked' && (
        <Alert severity="warning" variant="outlined" sx={{ mx: 1 }}>
          {t('reminder.blocked')}
        </Alert>
      )}
      {state === 'failed' && (
        <Alert severity="warning" variant="outlined" sx={{ mx: 1 }}>
          {t('notifications.pushFailed')}
        </Alert>
      )}
    </Section>
  );
}
