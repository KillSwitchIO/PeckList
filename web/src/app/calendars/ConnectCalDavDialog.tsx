import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Link,
  MenuItem,
  TextField,
  Typography,
} from '@mui/material';
import { useState, type FormEvent } from 'react';
import type { CalendarAccountInfo, CalendarsApi } from '../../ports/calendars.ts';
import { t } from '../i18n/i18n.ts';
import { ProblemAlert } from '../layout/ProblemAlert.tsx';
import { problemText } from './calendarText.ts';

type Service = 'icloud' | 'fastmail' | 'nextcloud' | 'other';

/**
 * The services the dialog knows: their address (filled in, so nobody types it) and the page that
 * says how to make an app password. iCloud's address is the one CalDAV apps use for it; Apple does
 * not publish it on its help pages.
 */
const SERVICES: Record<Service, { url: string | null; help: string | null }> = {
  icloud: { url: 'https://caldav.icloud.com', help: 'https://support.apple.com/en-us/102654' },
  fastmail: {
    url: 'https://caldav.fastmail.com/',
    help: 'https://www.fastmail.help/hc/en-us/articles/360058752854',
  },
  nextcloud: { url: null, help: null },
  other: { url: null, help: null },
};

/** The service an address belongs to, for reconnecting with the same one picked. */
function serviceOf(url: string): Service {
  const known = (Object.keys(SERVICES) as Service[]).find(
    (service) =>
      SERVICES[service].url !== null && url.startsWith(SERVICES[service].url!.replace(/\/$/, '')),
  );
  if (known) return known;
  return url.includes('/remote.php/dav') ? 'nextcloud' : 'other';
}

/**
 * Connect a CalDAV calendar account (spec: PL-134 decision 4: one connector for iCloud, Fastmail,
 * Nextcloud and the rest). The password goes to this server only, which checks it with the
 * calendar service before keeping it, encrypted. It is never kept in the page after a try.
 */
export function ConnectCalDavDialog({
  api,
  again,
  onConnected,
  onClose,
}: {
  api: CalendarsApi;
  /** Reconnecting an account whose password stopped working: its address and username */
  again?: { serverUrl: string; username: string };
  onConnected: (account: CalendarAccountInfo) => void;
  onClose: () => void;
}) {
  const [service, setService] = useState<Service>(again ? serviceOf(again.serverUrl) : 'icloud');
  const [address, setAddress] = useState(again?.serverUrl ?? '');
  const [username, setUsername] = useState(again?.username ?? '');
  const [password, setPassword] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const known = SERVICES[service];
  const serverUrl = known.url ?? address.trim();
  const ready = serverUrl !== '' && username.trim() !== '' && password !== '';

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setProblem(null);
    try {
      const result = await api.connectCalDav({ serverUrl, username: username.trim(), password });
      if (result.ok) {
        onConnected(result.value);
        onClose();
        return;
      }
      setProblem(problemText(result.code));
    } catch {
      setProblem(t('calendars.problem.offline'));
    } finally {
      // Not kept around for a second try: it is typed again.
      setPassword('');
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="xs" fullWidth>
      <Box component="form" onSubmit={(event) => void submit(event)}>
        <DialogTitle>{t('calendars.connect.title')}</DialogTitle>
        <DialogContent sx={{ display: 'grid', gap: 2, pt: '8px !important' }}>
          <TextField
            select
            size="small"
            label={t('calendars.connect.service')}
            value={service}
            onChange={(change) => setService(change.target.value as Service)}
          >
            <MenuItem value="icloud">{t('calendars.connect.icloud')}</MenuItem>
            <MenuItem value="fastmail">{t('calendars.connect.fastmail')}</MenuItem>
            <MenuItem value="nextcloud">{t('calendars.connect.nextcloud')}</MenuItem>
            <MenuItem value="other">{t('calendars.connect.other')}</MenuItem>
          </TextField>
          {known.url === null && (
            <TextField
              size="small"
              label={t('calendars.connect.address')}
              value={address}
              placeholder={
                service === 'nextcloud'
                  ? 'https://cloud.example.com/remote.php/dav'
                  : 'https://calendar.example.com'
              }
              helperText={t(
                service === 'nextcloud'
                  ? 'calendars.connect.addressHintNextcloud'
                  : 'calendars.connect.addressHint',
              )}
              slotProps={{
                htmlInput: { inputMode: 'url', autoCapitalize: 'none', spellCheck: false },
              }}
              onChange={(change) => setAddress(change.target.value)}
            />
          )}
          <TextField
            size="small"
            label={t('calendars.connect.username')}
            value={username}
            autoComplete="username"
            slotProps={{ htmlInput: { autoCapitalize: 'none', spellCheck: false } }}
            onChange={(change) => setUsername(change.target.value)}
          />
          <TextField
            size="small"
            type="password"
            label={t('calendars.connect.password')}
            value={password}
            autoComplete="new-password"
            onChange={(change) => setPassword(change.target.value)}
          />
          <Typography variant="body2" color="text.secondary">
            {t('calendars.connect.passwordHint')}{' '}
            {known.help && (
              <Link href={known.help} target="_blank" rel="noreferrer">
                {t('calendars.connect.passwordHelp')}
              </Link>
            )}
          </Typography>
          <ProblemAlert problem={problem} />
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={busy}>
            {t('admin.cancel')}
          </Button>
          <Button
            type="submit"
            variant="contained"
            disableElevation
            disabled={!ready}
            // The server dials out before answering: a spinner in place of the label, same width.
            loading={busy}
          >
            {t('calendars.connect.action')}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}
