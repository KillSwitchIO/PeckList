import { Box, Button } from '@mui/material';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { ConfirmDialog } from '../admin/AdminDialogs.tsx';
import { t } from '../i18n/i18n.ts';
import { Section, SettingRow } from '../settings/settingsLayout.tsx';
import { CONFIRM_API, useShellInfo } from './shell.ts';

/** Settings > Server, in the Android app only: which server it runs on, and moving off it. */
export function ServerSection() {
  const navigate = useNavigate();
  const { shell, info } = useShellInfo();
  const [confirming, setConfirming] = useState(false);
  if (!shell || !info) return null;
  const connect = () => void navigate('/connect');
  return (
    <Section
      title={t('settings.server')}
      hint={t('settings.server.version', { version: info.version })}
    >
      {info.server === null ? (
        <SettingRow label={t('settings.server.none')} hint={t('settings.server.noneHint')}>
          <Button size="small" variant="outlined" onClick={connect}>
            {t('settings.server.connect')}
          </Button>
        </SettingRow>
      ) : (
        <SettingRow label={info.server} hint={t('settings.server.connected')}>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button size="small" onClick={connect}>
              {t('settings.server.change')}
            </Button>
            <Button
              size="small"
              color="error"
              onClick={() =>
                // From api 8 the shell asks in its own dialog (audit A4).
                info.api >= CONFIRM_API ? void shell.disconnect() : setConfirming(true)
              }
            >
              {t('settings.server.disconnect')}
            </Button>
          </Box>
        </SettingRow>
      )}
      <ConfirmDialog
        confirm={
          confirming
            ? {
                title: t('settings.server.disconnectTitle'),
                text: t('settings.server.disconnectText'),
                action: t('settings.server.disconnect'),
                run: () => void shell.disconnect(),
              }
            : null
        }
        onClose={() => setConfirming(false)}
      />
    </Section>
  );
}
