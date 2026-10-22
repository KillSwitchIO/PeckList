import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
} from '@mui/material';
import { useEffect, useState } from 'react';
import type { AdminApi, AdminUser } from '../../ports/admin.ts';
import { t } from '../i18n/i18n.ts';

/**
 * Deleting an account (spec: Users, delete with grace period and restore): what happens, and the
 * hand-over first when the person owns lists or groups shared with others.
 */
export function DeleteUserDialog({
  api,
  user,
  onClose,
  onHandOver,
  onDelete,
}: {
  api: AdminApi;
  user: AdminUser;
  onClose: () => void;
  onHandOver: () => void;
  onDelete: () => void;
}) {
  const [shared, setShared] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    api.shared(user.id).then(
      (list) => live && setShared(list.length),
      () => live && setShared(0),
    );
    return () => {
      live = false;
    };
  }, [api, user.id]);

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{t('admin.users.deleteTitle', { name: user.username })}</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: shared ? 1.5 : 0 }}>
          {t('admin.users.deleteText', { name: user.username })}
        </DialogContentText>
        {shared !== null && shared > 0 && (
          <DialogContentText>
            {t(shared === 1 ? 'admin.users.deleteSharedOne' : 'admin.users.deleteShared', {
              name: user.username,
              count: shared,
            })}
          </DialogContentText>
        )}
      </DialogContent>
      <DialogActions>
        {shared !== null && shared > 0 && (
          <Button onClick={onHandOver} sx={{ mr: 'auto' }}>
            {t('admin.users.handOverFirst')}
          </Button>
        )}
        <Button onClick={onClose}>{t('admin.cancel')}</Button>
        <Button
          variant="contained"
          color="error"
          disableElevation
          disabled={shared === null}
          onClick={onDelete}
        >
          {t('admin.users.delete')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
