import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from '@mui/material';
import { useCallback, useState } from 'react';
import type { AdminApi, ServerCrash, TelemetryView } from '../../ports/admin.ts';
import { useLoaded } from './useAdmin.ts';
import { t } from '../i18n/i18n.ts';

/** The usage report exactly as it would go, as JSON (PL-116: nothing hidden). */
function ReportDialog({
  open,
  view,
  onClose,
}: {
  open: boolean;
  view: TelemetryView;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{t('telemetry.dialogTitle')}</DialogTitle>
      <DialogContent>
        <Box
          component="pre"
          sx={{ m: 0, fontSize: 13, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}
        >
          {JSON.stringify(view.report, null, 2)}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('telemetry.close')}</Button>
      </DialogActions>
    </Dialog>
  );
}

/**
 * Under Settings > Telemetry: what the report is, when it last went, the report itself, and a new
 * install id on asking. The switch and the address are ordinary settings above it.
 */
export function TelemetryPanel({
  view,
  api,
  onChange,
}: {
  view: TelemetryView | null;
  api: AdminApi;
  onChange: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [renewed, setRenewed] = useState(false);
  if (!view) return null;
  const status = !view.enabled
    ? t('telemetry.off')
    : view.sentAt
      ? t('telemetry.sentAt', { when: new Date(view.sentAt).toLocaleString() })
      : t('telemetry.notSent');
  return (
    <Box sx={{ px: 1, py: 1, display: 'grid', gap: 1 }}>
      <Typography variant="body2" color="text.secondary">
        {t('telemetry.about')} {status}
      </Typography>
      {renewed && (
        <Typography variant="body2" role="status">
          {t('telemetry.newIdDone')}
        </Typography>
      )}
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        <Button variant="outlined" size="small" onClick={() => setOpen(true)}>
          {t('telemetry.show')}
        </Button>
        <Button
          size="small"
          onClick={() => {
            void api.renewTelemetryId().then(() => {
              setRenewed(true);
              onChange();
            });
          }}
        >
          {t('telemetry.newId')}
        </Button>
      </Box>
      <ReportDialog open={open} view={view} onClose={() => setOpen(false)} />
      <ServerCrashes api={api} />
    </Box>
  );
}

/** The server's own crashes (PL-116): each with what it would send, Send and Forget. */
function ServerCrashes({ api }: { api: AdminApi }) {
  const load = useCallback(
    () => api.crashReports?.() ?? Promise.resolve({ enabled: false, crashes: [] as ServerCrash[] }),
    [api],
  );
  const { data, reload } = useLoaded(load);
  const [looking, setLooking] = useState<ServerCrash | null>(null);
  if (!data?.enabled || data.crashes.length === 0) return null;
  return (
    <Box
      component="section"
      aria-label={t('telemetry.crashes')}
      sx={{ mt: 1, display: 'grid', gap: 1 }}
    >
      <Typography variant="subtitle2">{t('telemetry.crashes')}</Typography>
      <Typography variant="body2" color="text.secondary">
        {t('telemetry.crashesHint')}
      </Typography>
      {data.crashes.map((crash) => (
        <Box
          key={crash.fingerprint}
          sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}
        >
          <Box sx={{ flexGrow: 1, minWidth: 0 }}>
            <Typography noWrap>{crash.report.kind}</Typography>
            <Typography variant="caption" color="text.secondary">
              {t('telemetry.crashSeen', {
                count: crash.count,
                when: new Date(crash.lastAt).toLocaleString(),
              })}
            </Typography>
          </Box>
          <Button size="small" onClick={() => setLooking(crash)}>
            {t('telemetry.crashShow')}
          </Button>
          <Button
            size="small"
            variant="outlined"
            onClick={() => void api.sendCrashReport?.(crash.fingerprint).then(reload)}
          >
            {t('crash.send')}
          </Button>
          <Button
            size="small"
            onClick={() => void api.forgetCrashReport?.(crash.fingerprint).then(reload)}
          >
            {t('telemetry.forget')}
          </Button>
        </Box>
      ))}
      <Dialog open={looking !== null} onClose={() => setLooking(null)} fullWidth maxWidth="sm">
        <DialogTitle>{t('crash.report')}</DialogTitle>
        <DialogContent>
          <Box
            component="pre"
            sx={{ m: 0, fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}
          >
            {looking && JSON.stringify(looking.report, null, 2)}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setLooking(null)}>{t('telemetry.close')}</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

/** The one-time notice at the top of Settings that the server reports (until an admin dismisses it). */
export function TelemetryNotice({
  view,
  api,
  onSeen,
}: {
  view: TelemetryView | null;
  api: AdminApi;
  onSeen: () => void;
}) {
  const [open, setOpen] = useState(false);
  if (!view || !view.enabled || view.noticeSeen) return null;
  return (
    <>
      <Alert
        severity="info"
        variant="outlined"
        action={
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            <Button
              color="inherit"
              size="small"
              sx={{ whiteSpace: 'nowrap' }}
              onClick={() => setOpen(true)}
            >
              {t('telemetry.show')}
            </Button>
            <Button
              color="inherit"
              size="small"
              onClick={() => void api.telemetryNoticeSeen().then(onSeen)}
            >
              {t('telemetry.gotIt')}
            </Button>
          </Box>
        }
      >
        {t('telemetry.notice')}
      </Alert>
      <ReportDialog open={open} view={view} onClose={() => setOpen(false)} />
    </>
  );
}
