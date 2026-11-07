import {
  Alert,
  Box,
  Button,
  Collapse,
  Dialog,
  DialogContent,
  DialogTitle,
  Typography,
} from '@mui/material';
import { Component, useEffect, useState, type ErrorInfo, type ReactNode } from 'react';
import type { CrashChoice, CrashReportDraft } from '../../ports/sync.ts';
import { t } from '../i18n/i18n.ts';
import { isLoadFailure } from '../loadOnce.ts';
import { CenteredCard } from '../layout/CenteredCard.tsx';
import { nativeShell } from '../native/shell.ts';
import { useSyncState } from '../sync/syncContext.ts';
import { crashReport, nativeCrashReport } from './crash.ts';
import { countError } from './usage.ts';

/**
 * Catches an error the app could not get past (PL-116): instead of a blank page, it says so,
 * offers a reload, and, when the server takes crash reports, offers to send one.
 */
export class CrashBoundary extends Component<
  { children: ReactNode },
  { report: CrashReportDraft | null; loadFailed: boolean }
> {
  override state = { report: null as CrashReportDraft | null, loadFailed: false };

  static getDerivedStateFromError(error: unknown) {
    return { report: crashReport(error), loadFailed: isLoadFailure(error) };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo) {
    if (isLoadFailure(error)) return;
    countError(error);
    // With where in the app it broke.
    this.setState({ report: crashReport(error, info.componentStack) });
  }

  override render() {
    if (this.state.loadFailed) return <LoadFailedScreen />;
    return this.state.report ? <CrashScreen report={this.state.report} /> : this.props.children;
  }
}

/** A part of the app could not be fetched: nothing has broken, so there is nothing to report. */
function LoadFailedScreen() {
  return (
    <CenteredCard title={t('crash.loadTitle')} subtitle={t('crash.loadSubtitle')}>
      <Button
        variant="contained"
        size="large"
        disableElevation
        fullWidth
        onClick={() => window.location.reload()}
      >
        {t('crash.reload')}
      </Button>
    </CenteredCard>
  );
}

/** The page after a crash: Reload, and the report offer. */
export function CrashScreen({ report }: { report: CrashReportDraft }) {
  return (
    <CenteredCard title={t('crash.title')} subtitle={t('crash.subtitle')}>
      <Box sx={{ display: 'grid', gap: 2 }}>
        <Button
          variant="contained"
          size="large"
          disableElevation
          onClick={() => window.location.reload()}
        >
          {t('crash.reload')}
        </Button>
        <CrashOffer report={report} />
      </Box>
    </CenteredCard>
  );
}

type Sent = 'idle' | 'sending' | 'sent' | 'kept' | 'failed';

/**
 * The offer itself, with the report in full and four choices (Ben, 2026-10-30): Send, Don't send,
 * Always send (this and later ones, without asking), Never send (no reports, and usage sharing off
 * too). "Always" sends at once; "Never" asks nothing. `onSettled` hears once nothing more is asked.
 */
export function CrashOffer({
  report,
  onSettled,
}: {
  report: CrashReportDraft;
  onSettled?: (asked: boolean) => void;
}) {
  const transport = useSyncState((state) => state.transport);
  const api = transport.telemetry;
  const [choice, setChoice] = useState<CrashChoice | null>(null);
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState<Sent>('idle');

  const send = async () => {
    if (!api?.crash) return;
    setSent('sending');
    try {
      await api.crash(report);
      setSent('sent');
    } catch {
      setSent('failed');
    }
  };

  useEffect(() => {
    if (!api) {
      onSettled?.(false);
      return;
    }
    let live = true;
    api.status().then(
      (status) => {
        if (!live) return;
        if (!status.crashReportsEnabled || !api.crash || status.crashReports === 'never') {
          onSettled?.(false);
          return;
        }
        setChoice(status.crashReports);
        if (status.crashReports === 'always') {
          void send();
          onSettled?.(false);
        }
      },
      () => onSettled?.(false),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, for the report this offer shows
  }, [api]);

  const decide = async (next: CrashChoice | 'once' | 'skip') => {
    if (next === 'skip') {
      setSent('kept');
      onSettled?.(true);
      return;
    }
    if (next !== 'once') await api?.choose({ crashReports: next }).catch(() => undefined);
    if (next === 'never') {
      setSent('kept');
      onSettled?.(true);
      return;
    }
    await send();
    onSettled?.(true);
  };

  return (
    <>
      {sent === 'idle' && choice === 'ask' && (
        <>
          <Typography variant="body2" color="text.secondary">
            {t('crash.offer')}
          </Typography>
          <Button
            size="small"
            onClick={() => setOpen((each) => !each)}
            sx={{ justifySelf: 'start' }}
          >
            {open ? t('crash.hide') : t('crash.show')}
          </Button>
          <Collapse in={open}>
            <Box
              component="pre"
              aria-label={t('crash.report')}
              sx={{
                m: 0,
                p: 1.5,
                maxHeight: 240,
                overflow: 'auto',
                fontSize: 12,
                bgcolor: 'action.hover',
                borderRadius: 1,
                whiteSpace: 'pre-wrap',
              }}
            >
              {JSON.stringify(report, null, 2)}
            </Box>
          </Collapse>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            <Button variant="outlined" onClick={() => void decide('once')}>
              {t('crash.send')}
            </Button>
            <Button onClick={() => void decide('skip')}>{t('crash.dontSend')}</Button>
            <Button onClick={() => void decide('always')}>{t('crash.always')}</Button>
            <Button onClick={() => void decide('never')}>{t('crash.never')}</Button>
          </Box>
        </>
      )}
      {sent === 'sent' && (
        <Alert severity="success" variant="outlined">
          {t('crash.sent')}
        </Alert>
      )}
      {sent === 'failed' && (
        <Alert severity="warning" variant="outlined">
          {t('crash.failed')}
        </Alert>
      )}
    </>
  );
}

/**
 * The Android app went down since it last ran (a crash or an ANR the shell noticed): on the next
 * start, once signed in, offer the report the same way, in a dialog.
 */
export function NativeCrashOffer() {
  const ready = useSyncState((state) => state.phase === 'ready' && state.account !== null);
  const [report, setReport] = useState<CrashReportDraft | null>(null);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    const shell = nativeShell();
    if (!ready || !shell?.lastCrash) return;
    let live = true;
    void Promise.all([shell.lastCrash(), shell.info()]).then(
      ([crash, info]) => {
        if (live && crash) setReport(nativeCrashReport(crash, info.version));
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [ready]);

  if (!report) return null;
  return (
    <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
      <DialogTitle>{t('crash.nativeTitle')}</DialogTitle>
      <DialogContent sx={{ display: 'grid', gap: 2 }}>
        <CrashOffer
          report={report}
          onSettled={(asked) => {
            if (!asked) setOpen(false);
          }}
        />
        <Button onClick={() => setOpen(false)} sx={{ justifySelf: 'end' }}>
          {t('admin.done')}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
