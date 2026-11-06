import { Box, CircularProgress } from '@mui/material';
import { t } from '../i18n/i18n.ts';

/** The whole page waiting, before there is anything of the app to wait inside. */
export function LoadingScreen({ label = t('status.waiting') }: { label?: string }) {
  return (
    <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '100dvh' }}>
      <CircularProgress aria-label={label} />
    </Box>
  );
}
