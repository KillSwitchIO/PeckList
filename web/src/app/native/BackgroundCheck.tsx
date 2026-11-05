import { Alert, Button, MenuItem, Switch, TextField } from '@mui/material';
import { useEffect, useState } from 'react';
import type { BackgroundCheck, NativeShell } from '../../ports/nativeShell.ts';
import { t } from '../i18n/i18n.ts';
import { notifier } from '../reminders/notifier.ts';
import { Section, SettingRow } from '../settings/settingsLayout.tsx';
import { useSyncState } from '../sync/syncContext.ts';
import { useShellInfo } from './shell.ts';

/** The first shell api with the background check-in. */
export const CHECK_API = 2;

/**
 * Settings > Notifications in the Android app (ADR-0017): a WebView has no Web Push, so the app
 * checks in with the server in the background instead. On, every 5 minutes, unless changed here.
 */
export function BackgroundCheckSettings({ shell }: { shell: NativeShell }) {
  const [state, setState] = useState<BackgroundCheck | null>(null);
  const [permission, setPermission] = useState(() => notifier().permission());

  useEffect(() => {
    let live = true;
    const load = () => {
      void shell.backgroundCheck().then(
        (answer) => live && setState(answer),
        () => undefined,
      );
      setPermission(notifier().permission());
    };
    load();
    // Back from Android's own settings: what was allowed there shows at once.
    const onVisible = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      live = false;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [shell]);

  if (!state) return null;
  const change = (patch: { enabled?: boolean; minutes?: number }) =>
    void shell.setBackgroundCheck(patch).then(setState, () => undefined);

  return (
    <Section title={t('notifications.thisDevice')}>
      <SettingRow label={t('backgroundCheck.label')} hint={t('backgroundCheck.hint')}>
        <Switch
          checked={state.enabled}
          onChange={(event) => change({ enabled: event.target.checked })}
          slotProps={{ input: { 'aria-label': t('backgroundCheck.label') } }}
        />
      </SettingRow>
      <SettingRow label={t('backgroundCheck.every')}>
        <TextField
          select
          size="small"
          value={state.minutes}
          disabled={!state.enabled}
          onChange={(event) => change({ minutes: Number(event.target.value) })}
          slotProps={{ htmlInput: { 'aria-label': t('backgroundCheck.every') } }}
        >
          {state.choices.map((minutes) => (
            <MenuItem key={minutes} value={minutes}>
              {minutes === 60 ? t('settings.oneHour') : t('settings.minutes', { minutes })}
            </MenuItem>
          ))}
        </TextField>
      </SettingRow>
      {state.enabled && permission !== 'granted' && (
        <Alert
          severity="warning"
          variant="outlined"
          sx={{ mx: 1 }}
          action={
            permission === 'default' && (
              <Button size="small" onClick={() => void notifier().request().then(setPermission)}>
                {t('backgroundCheck.allow')}
              </Button>
            )
          }
        >
          {permission === 'default' ? t('backgroundCheck.notificationsOff') : t('reminder.blocked')}
        </Alert>
      )}
      {state.enabled && !state.unrestricted && (
        <Alert
          severity="warning"
          variant="outlined"
          sx={{ mx: 1 }}
          action={
            <Button
              size="small"
              onClick={() => void shell.allowBackground().then(setState, () => undefined)}
            >
              {t('backgroundCheck.allow')}
            </Button>
          }
        >
          {t('backgroundCheck.restricted')}
        </Alert>
      )}
      {state.enabled && state.maker === 'samsung' && (
        <Alert severity="info" variant="outlined" sx={{ mx: 1 }}>
          {t('backgroundCheck.samsung')}
        </Alert>
      )}
    </Section>
  );
}

/**
 * Once signed in to a server, the Android app asks once for what the check-in needs: to show
 * notifications, and to run in the background. Each is Android's own dialog; Settings asks again.
 */
export function BackgroundCheckPrompt() {
  const { shell, info } = useShellInfo();
  const ready = useSyncState((state) => state.phase === 'ready');
  const wanted = Boolean(shell && info?.server && info.api >= CHECK_API && ready);
  useEffect(() => {
    if (!wanted || !shell) return;
    let live = true;
    void (async () => {
      const state = await shell.backgroundCheck();
      if (!live || state.asked || !state.enabled) return;
      await notifier().request();
      if (live) await shell.allowBackground();
    })().catch(() => undefined);
    return () => {
      live = false;
    };
  }, [wanted, shell]);
  return null;
}
