import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  TextField,
} from '@mui/material';
import { useState, type FormEvent } from 'react';
import type { AdminApi, AdminUser } from '../../ports/admin.ts';
import { t } from '../i18n/i18n.ts';
import { openViewAs } from '../store/viewAs.ts';
import { refusalText } from './useAdmin.ts';

/** Ask why, then open a tab that shows the app as `user` (super admins; spec: impersonation). */
export function ViewAsDialog({
  api,
  user,
  onClose,
}: {
  api: AdminApi;
  user: AdminUser;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const result = await api.impersonate(user.id, reason);
    if (!result.ok) {
      setProblem(refusalText(result.reason));
      return;
    }
    openViewAs(result.value.token, user.username);
    onClose();
  };
  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <Box component="form" onSubmit={(event) => void submit(event)}>
        <DialogTitle>{t('admin.viewAs.title', { name: user.username })}</DialogTitle>
        <DialogContent sx={{ display: 'grid', gap: 2 }}>
          <DialogContentText variant="body2">
            {t('admin.viewAs.text', { name: user.username })}
          </DialogContentText>
          <TextField
            label={t('admin.viewAs.reason')}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            autoFocus
            required
          />
          {problem && (
            <Alert severity="error" variant="outlined">
              {problem}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>{t('admin.cancel')}</Button>
          <Button type="submit" variant="contained" disableElevation>
            {t('admin.viewAs.open')}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}
