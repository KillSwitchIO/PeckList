import { Alert, Switch } from '@mui/material';
import { useEffect, useState } from 'react';
import { updateSettings } from '../../core/settings.ts';
import type { NotificationSwitches } from '../../core/types.ts';
import { t } from '../i18n/i18n.ts';
import { useApply, useWorkspace } from '../store/hooks.ts';
import { BackgroundCheckSettings, CHECK_API } from '../native/BackgroundCheck.tsx';
import { useShellInfo } from '../native/shell.ts';
import { browserPush } from '../reminders/notifier.ts';
import { useSyncState } from '../sync/syncContext.ts';
import { Section, SettingRow } from './settingsLayout.tsx';

type State = 'checking' | 'on' | 'off' | 'unsupported' | 'blocked' | 'failed';

/**
 * Settings > Notifications (spec: PL-061): Web Push for this device, so reminders and
 * notifications arrive with Punchlist closed. Each device turns it on for itself. The Android app
 * has no Web Push and checks in with the server instead.
 */
export function NotificationSettings() {
  const { shell, info } = useShellInfo();
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
  if (shell) {
    if (!info) return null;
    if (info.server !== null && info.api >= CHECK_API)
      return (
        <>
          <NotificationKinds />
          <BackgroundCheckSettings shell={shell} />
        </>
      );
  }

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
    <>
      <NotificationKinds />
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
    </>
  );
}

type Key = Parameters<typeof t>[0];
const KINDS: { key: keyof NotificationSwitches; label: Key; hint?: Key }[] = [
  { key: 'reminders', label: 'notifications.kindReminders' },
  { key: 'assignments', label: 'notifications.kindAssignments' },
  { key: 'shares', label: 'notifications.kindShares' },
  { key: 'comments', label: 'notifications.kindComments' },
  { key: 'vibrate', label: 'notifications.vibrate', hint: 'notifications.vibrateHint' },
];

/**
 * Which kinds of notification reach this person, and whether they vibrate (settings.notifications,
 * PL-115): synced, honored by the server for pushes and check-ins and by every device for what it
 * shows. Each switch absent means on.
 */
function NotificationKinds() {
  const workspace = useWorkspace();
  const apply = useApply();
  const current = workspace.entities.settings[0]?.notifications ?? {};
  const set = (key: keyof NotificationSwitches, on: boolean) =>
    apply((ctx, ws) =>
      updateSettings(ctx, ws, {
        notifications: { ...(ws.entities.settings[0]?.notifications ?? {}), [key]: on },
      }),
    );
  return (
    <Section title={t('notifications.kinds')} hint={t('notifications.kindsHint')}>
      {KINDS.map(({ key, label, hint }) => (
        <SettingRow key={key} label={t(label)} {...(hint ? { hint: t(hint) } : {})}>
          <Switch
            checked={current[key] !== false}
            onChange={(event) => set(key, event.target.checked)}
            slotProps={{ input: { 'aria-label': t(label) } }}
          />
        </SettingRow>
      ))}
    </Section>
  );
}
