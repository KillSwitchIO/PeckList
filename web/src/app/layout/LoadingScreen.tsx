import { Box, CircularProgress } from '@mui/material';
import { useEffect, useState } from 'react';
import { t } from '../i18n/i18n.ts';

/**
 * How long the page may have been open before a wait shows a spinner (PL-149). The workspace is
 * on the device, so an ordinary start opens it well within this and shows only the background
 * until the lists are there, never a spinner that flashes. Later waits (a page split off the first
 * load) are past it and show the spinner at once, as before.
 */
export const SPINNER_AFTER_MS = 1_000;

/** Left in the page's performance timeline when the spinner shows, for the e2e check. */
export const SPINNER_MARK = 'pecklist:spinner';

/** The whole page waiting, before there is anything of the app to wait inside. */
export function LoadingScreen({ label = t('status.waiting') }: { label?: string }) {
  const [shown, setShown] = useState(() => performance.now() >= SPINNER_AFTER_MS);
  useEffect(() => {
    if (shown) {
      performance.mark(SPINNER_MARK);
      return;
    }
    const timer = setTimeout(() => setShown(true), SPINNER_AFTER_MS - performance.now());
    return () => clearTimeout(timer);
  }, [shown]);
  return (
    <Box aria-busy="true" sx={{ display: 'grid', placeItems: 'center', minHeight: '100dvh' }}>
      {shown && <CircularProgress aria-label={label} />}
    </Box>
  );
}
