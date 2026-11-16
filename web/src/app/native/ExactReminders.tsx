import { Alert, Button, type SxProps, type Theme } from '@mui/material';
import { t } from '../i18n/i18n.ts';
import { useExactAlarms } from './exactAlarms.ts';

/**
 * "Allow exact reminders", where the reminder permissions show: only when Android has a page to
 * allow them and they are not allowed yet (the Google Play build on Android 14 and up). Until then
 * reminders still come, but Android may hold them back a while.
 */
export function ExactRemindersPrompt({ sx }: { sx?: SxProps<Theme> }) {
  const { state, allow } = useExactAlarms();
  if (!state?.canAsk) return null;
  return (
    <Alert
      severity="warning"
      variant="outlined"
      sx={sx}
      action={
        <Button size="small" onClick={allow}>
          {t('exactAlarms.allow')}
        </Button>
      }
    >
      {t('exactAlarms.needed')}
    </Alert>
  );
}
