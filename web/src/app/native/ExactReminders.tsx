import { Alert, Button, type SxProps, type Theme } from '@mui/material';
import { t } from '../i18n/i18n.ts';
import { useExactAlarms } from './exactAlarms.ts';

/**
 * "Allow exact reminders", where the reminder permissions show: whenever Android says alarms for
 * the exact minute are not allowed, in any build (the Google Play build on Android 14 and up, or an
 * install where the person took them away). The button shows when Android has a page to allow
 * them. Until then reminders still come, but Android may hold them back a while.
 */
export function ExactRemindersPrompt({ sx }: { sx?: SxProps<Theme> }) {
  const { state, allow } = useExactAlarms();
  if (!state || state.allowed) return null;
  return (
    <Alert
      severity="warning"
      variant="outlined"
      sx={sx}
      action={
        state.canAsk ? (
          <Button size="small" onClick={allow}>
            {t('exactAlarms.allow')}
          </Button>
        ) : undefined
      }
    >
      {t('exactAlarms.needed')}
    </Alert>
  );
}
