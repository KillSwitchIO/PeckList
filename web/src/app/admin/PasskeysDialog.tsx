import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from '@mui/material';
import { useCallback } from 'react';
import type { AdminApi, AdminUser } from '../../ports/admin.ts';
import { t } from '../i18n/i18n.ts';
import { useLoaded } from './useAdmin.ts';

/** Someone's passkeys, so an admin can remove a lost one (PL-123). */
export function PasskeysDialog({
  api,
  user,
  onClose,
  onChanged,
}: {
  api: AdminApi;
  user: AdminUser;
  onClose: () => void;
  onChanged: () => void;
}) {
  const load = useCallback(() => api.passkeys(user.id), [api, user.id]);
  const { data: passkeys, reload } = useLoaded(load);
  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{t('admin.passkeys.title', { name: user.username })}</DialogTitle>
      <DialogContent>
        {passkeys?.length === 0 && (
          <Typography color="text.secondary">{t('admin.passkeys.none')}</Typography>
        )}
        {(passkeys ?? []).map((passkey) => (
          <Box key={passkey.id} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5 }}>
            <Box sx={{ flexGrow: 1, minWidth: 0 }}>
              <Typography noWrap>{passkey.name}</Typography>
              <Typography variant="caption" color="text.secondary">
                {passkey.lastUsedAt
                  ? t('admin.passkeys.used', {
                      date: new Date(passkey.lastUsedAt).toLocaleDateString(),
                    })
                  : t('admin.passkeys.unused')}
              </Typography>
            </Box>
            <Button
              size="small"
              color="error"
              aria-label={t('settings.passkeys.removeNamed', { name: passkey.name })}
              onClick={() =>
                void api.removePasskey(user.id, passkey.id).then(() => {
                  reload();
                  onChanged();
                })
              }
            >
              {t('settings.passkeys.remove')}
            </Button>
          </Box>
        ))}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('admin.done')}</Button>
      </DialogActions>
    </Dialog>
  );
}
