import { TextField } from '@mui/material';
import { useState } from 'react';
import type { AdminApi, AdminUser } from '../../ports/admin.ts';
import { t } from '../i18n/i18n.ts';
import { openViewAs } from '../store/viewAs.ts';
import { ActionDialog } from './AdminDialogs.tsx';

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
  return (
    <ActionDialog
      title={t('admin.viewAs.title', { name: user.username })}
      text={t('admin.viewAs.text', { name: user.username })}
      action={t('admin.viewAs.open')}
      ready
      run={() => api.impersonate(user.id, reason)}
      onDone={(value) => openViewAs(value.token, user.username)}
      onClose={onClose}
    >
      <TextField
        label={t('admin.viewAs.reason')}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        autoFocus
        required
      />
    </ActionDialog>
  );
}
