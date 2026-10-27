import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Tooltip,
  Typography,
} from '@mui/material';
import { keyframes } from '@emotion/react';
import { useState, type FormEvent } from 'react';
import { messageOf } from '../../core/errors.ts';
import { submitOnShiftEnter } from '../hooks/keys.ts';
import { t } from '../i18n/i18n.ts';
import { ProblemAlert } from '../layout/ProblemAlert.tsx';
import {
  AccountIcon,
  CloudAlertIcon,
  CloudDoneIcon,
  CloudOffIcon,
  CloudSyncIcon,
} from '../icons/icons.tsx';
import { passwordProblem, usePasswordDraft } from './passwordChange.ts';
import { PasswordChangeFields } from './PasswordChangeFields.tsx';
import { useSyncState } from './syncContext.ts';
import { syncSummary } from './syncSummary.ts';

const pulse = keyframes`
  from { opacity: 1; }
  to { opacity: 0.45; }
`;

/**
 * The top bar's sync button: a cloud that says how syncing stands, opening a menu to sync now.
 * Hidden without a server. The account's own things live in the profile menu (ProfileButton).
 */
export function SyncButton() {
  const phase = useSyncState((state) => state.phase);
  const status = useSyncState((state) => state.status);
  const lastSynced = useSyncState((state) => state.lastSynced);
  const error = useSyncState((state) => state.error);
  const account = useSyncState((state) => state.account);
  const syncNow = useSyncState((state) => state.syncNow);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  if (phase !== 'ready') return null;

  const summary = syncSummary({ status, lastSynced, error });
  const local = account?.authMode === 'local';
  const icon =
    status === 'syncing' ? (
      <CloudSyncIcon
        fontSize="small"
        sx={{
          animation: `${pulse} 700ms ease-in-out infinite alternate`,
          '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
        }}
      />
    ) : status === 'offline' ? (
      <CloudOffIcon fontSize="small" />
    ) : status === 'idle' ? (
      <CloudDoneIcon fontSize="small" />
    ) : (
      <CloudAlertIcon fontSize="small" color="warning" />
    );

  return (
    <>
      <Tooltip title={summary}>
        <IconButton
          aria-label={`${t('sync.label')}: ${summary}`}
          aria-haspopup="menu"
          onClick={(event) => setAnchor(event.currentTarget)}
          sx={{ color: 'text.secondary' }}
        >
          {icon}
        </IconButton>
      </Tooltip>
      <Menu
        anchorEl={anchor}
        open={anchor !== null}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { minWidth: 240, maxWidth: 320 } } }}
      >
        <Box sx={{ px: 2, py: 1, display: 'flex', gap: 1.5, alignItems: 'center' }}>
          <AccountIcon fontSize="small" sx={{ color: 'text.secondary' }} />
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="body2" noWrap>
              {local ? t('sync.signedInAs', { name: account.username }) : t('sync.noLogin')}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {summary}
            </Typography>
          </Box>
        </Box>
        <Divider />
        <MenuItem
          onClick={() => {
            setAnchor(null);
            void syncNow();
          }}
        >
          <ListItemIcon>
            <CloudSyncIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t('sync.now')}</ListItemText>
        </MenuItem>
      </Menu>
    </>
  );
}

/** Change the account's password (from the profile menu). */
export function ChangePasswordDialog({ onClose }: { onClose: () => void }) {
  const changePassword = useSyncState((state) => state.changePassword);
  const draft = usePasswordDraft();
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (draft.again !== draft.next) {
      setProblem(t('auth.mismatch'));
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const outcome = await changePassword(draft.current, draft.next);
      if (outcome.kind === 'ok') onClose();
      else setProblem(passwordProblem(outcome));
    } catch (error) {
      setProblem(messageOf(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <Box component="form" onSubmit={(event) => void submit(event)} onKeyDown={submitOnShiftEnter}>
        <DialogTitle>{t('auth.changeTitle')}</DialogTitle>
        <DialogContent sx={{ display: 'grid', gap: 2, pt: '8px !important' }}>
          <PasswordChangeFields draft={draft} />
          <ProblemAlert problem={problem} />
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="contained" disableElevation disabled={busy}>
            {t('auth.change')}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}
