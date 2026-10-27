import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControlLabel,
  Radio,
  RadioGroup,
  TextField,
  Typography,
} from '@mui/material';
import { useState } from 'react';
import { localDateTimeOf, localTimeZone } from '../../core/dates.ts';
import type { AdminApi, RestoreSource } from '../../ports/admin.ts';
import { formatWhen } from '../format.ts';
import { useToday } from '../hooks/useToday.ts';
import { t } from '../i18n/i18n.ts';
import { ProblemAlert } from '../layout/ProblemAlert.tsx';
import { useIsSuperAdmin, useLoaded } from './useAdmin.ts';

function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Restore from one backup: the whole server, or one person in it. */
function RestoreDialog({
  api,
  source,
  label,
  onClose,
  onDone,
}: {
  api: AdminApi;
  source: RestoreSource;
  label: string;
  onClose: () => void;
  onDone: (message: string, restarting: boolean) => void;
}) {
  // The whole server is for super admins (its backups hold the keys that sign sessions).
  const superAdmin = useIsSuperAdmin();
  const [what, setWhat] = useState<'person' | 'server'>('person');
  const [username, setUsername] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    setProblem(null);
    if (what === 'server') {
      const result = await api.restoreServer(source);
      setBusy(false);
      if (!result.ok) return setProblem(result.message);
      onDone(t('admin.backups.serverRestoring'), true);
      return onClose();
    }
    const result = await api.restoreUser(source, username.trim() || undefined);
    setBusy(false);
    if (!result.ok) return setProblem(result.message);
    const done = result.value;
    onDone(
      t(done.created ? 'admin.backups.personCreated' : 'admin.backups.personRestored', {
        name: done.username,
        restored: done.restored,
        removed: done.removed,
        dropped: done.dropped,
      }),
      false,
    );
    onClose();
  };
  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{t('admin.backups.restoreTitle', { name: label })}</DialogTitle>
      <DialogContent sx={{ display: 'grid', gap: 2 }}>
        {superAdmin && (
          <RadioGroup
            value={what}
            onChange={(event) => setWhat(event.target.value as 'person' | 'server')}
          >
            <FormControlLabel
              value="person"
              control={<Radio />}
              label={t('admin.backups.onePerson')}
            />
            <FormControlLabel
              value="server"
              control={<Radio />}
              label={t('admin.backups.wholeServer')}
            />
          </RadioGroup>
        )}
        {what === 'person' ? (
          <TextField
            label={t('admin.backups.username')}
            helperText={t('admin.backups.usernameHint')}
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            slotProps={{ htmlInput: { autoCapitalize: 'none', spellCheck: false } }}
          />
        ) : (
          <DialogContentText variant="body2">
            {t('admin.backups.wholeServerHint')}
          </DialogContentText>
        )}
        <ProblemAlert problem={problem} />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('admin.cancel')}</Button>
        <Button
          variant="contained"
          color={what === 'server' ? 'error' : 'primary'}
          disableElevation
          disabled={busy}
          onClick={() => void run()}
        >
          {t('admin.backups.restore')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** Admin > Backups (spec: Backup and restore). */
export function BackupsTab({ api }: { api: AdminApi }) {
  const today = useToday();
  const superAdmin = useIsSuperAdmin();
  const backups = useLoaded(api.backups);
  const [restoring, setRestoring] = useState<{ source: RestoreSource; label: string } | null>(null);
  const [notice, setNotice] = useState<{ text: string; restarting: boolean } | null>(null);
  const [taking, setTaking] = useState(false);
  const when = (iso: string) => formatWhen(localDateTimeOf(iso, localTimeZone()), today);

  return (
    <Box sx={{ maxWidth: 720, display: 'grid', gap: 3 }}>
      {notice && (
        <Alert
          severity={notice.restarting ? 'warning' : 'success'}
          variant="outlined"
          onClose={() => setNotice(null)}
          action={
            notice.restarting ? (
              <Button color="inherit" size="small" onClick={() => window.location.reload()}>
                {t('admin.backups.reload')}
              </Button>
            ) : undefined
          }
        >
          {notice.text}
        </Alert>
      )}
      <Box component="section" aria-label={t('admin.backups.scheduled')}>
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.5 }}>
          <Typography variant="subtitle2" color="text.secondary" sx={{ flexGrow: 1 }}>
            {t('admin.backups.scheduled')}
          </Typography>
          <Button
            size="small"
            disabled={taking}
            onClick={() => {
              setTaking(true);
              void api.backUpNow().then(() => {
                setTaking(false);
                backups.reload();
              });
            }}
          >
            {t('admin.backups.now')}
          </Button>
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          {t('admin.backups.hint')}
        </Typography>
        <Box role="list">
          {(backups.data ?? []).map((backup) => (
            <Box
              key={backup.name}
              role="listitem"
              aria-label={backup.name}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                px: 1,
                py: 0.75,
                borderRadius: 2,
                '&:hover': { bgcolor: 'action.hover' },
              }}
            >
              <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                <Typography noWrap>{when(backup.taken)}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {`${backup.name} · ${size(backup.size)}`}
                </Typography>
              </Box>
              {superAdmin && (
                <Button size="small" href={api.backupUrl(backup.name)} download>
                  {t('admin.backups.download')}
                </Button>
              )}
              <Button
                size="small"
                onClick={() =>
                  setRestoring({ source: { backup: backup.name }, label: when(backup.taken) })
                }
              >
                {t('admin.backups.restore')}
              </Button>
            </Box>
          ))}
          {backups.data?.length === 0 && (
            <Typography color="text.secondary" sx={{ px: 1 }}>
              {t('admin.backups.none')}
            </Typography>
          )}
        </Box>
      </Box>

      <Box component="section" aria-label={t('admin.backups.exportTitle')}>
        <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
          {t('admin.backups.exportTitle')}
        </Typography>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          {superAdmin && (
            <Button variant="outlined" href={api.exportUrl()} download>
              {t('admin.backups.exportServer')}
            </Button>
          )}
          <Button variant="outlined" component="label">
            {t('admin.backups.fromFile')}
            <input
              hidden
              type="file"
              accept=".json,application/json"
              aria-label={t('admin.backups.fromFile')}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) setRestoring({ source: { file }, label: file.name });
                event.target.value = '';
              }}
            />
          </Button>
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {t(superAdmin ? 'admin.backups.exportHint' : 'admin.backups.adminHint')}
        </Typography>
      </Box>

      {restoring && (
        <RestoreDialog
          api={api}
          source={restoring.source}
          label={restoring.label}
          onClose={() => setRestoring(null)}
          onDone={(text, restarting) => {
            setNotice({ text, restarting });
            backups.reload();
          }}
        />
      )}
    </Box>
  );
}
