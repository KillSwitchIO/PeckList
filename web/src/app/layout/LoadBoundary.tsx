import { Box, Button, Typography } from '@mui/material';
import { Component, type ReactNode } from 'react';
import { t } from '../i18n/i18n.ts';
import { forgetFailedLoads } from '../lazyAgain.tsx';
import { isLoadFailure } from '../loadOnce.ts';

/**
 * Around a part of the screen that loads on first use (a page, the notes editor). When that part
 * could not be fetched, `fallback` says so there and the rest of the app goes on working: the
 * sidebar, other pages, the task's other fields. Any other error is a fault in the app and goes on
 * to CrashBoundary, which offers a report. Starting over asks again for what could not load: a
 * new `resetKey` (the page's address, so another page and back), or a new boundary on screen (the
 * notes of another task).
 */
export class LoadBoundary extends Component<
  { children: ReactNode; fallback: ReactNode; resetKey?: string },
  { failed: { error: unknown } | null }
> {
  override state = { failed: null as { error: unknown } | null };

  constructor(props: { children: ReactNode; fallback: ReactNode; resetKey?: string }) {
    super(props);
    forgetFailedLoads();
  }

  static getDerivedStateFromError(error: unknown) {
    return { failed: { error } };
  }

  override componentDidUpdate(previous: { resetKey?: string }) {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) {
      forgetFailedLoads();
      this.setState({ failed: null });
    }
  }

  override render() {
    const { failed } = this.state;
    if (!failed) return this.props.children;
    if (!isLoadFailure(failed.error)) throw failed.error;
    return this.props.fallback;
  }
}

/** In the page area: the page could not be fetched. Nothing broke, so there is nothing to report. */
export function PageLoadFailed() {
  return (
    <Box sx={{ maxWidth: 520, py: 3, display: 'grid', gap: 1.5, justifyItems: 'start' }}>
      <Typography variant="h5" component="h1">
        {t('crash.loadTitle')}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {t('crash.loadSubtitle')}
      </Typography>
      <Button variant="contained" disableElevation onClick={() => window.location.reload()}>
        {t('crash.reload')}
      </Button>
    </Box>
  );
}
