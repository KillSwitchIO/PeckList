import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
} from '@mui/material';
import { useState } from 'react';
import { t } from '../i18n/i18n.ts';
import { CopyIcon } from '../icons/icons.tsx';

/** A password or link shown once, with Copy (spec: Account management, "shown once"). */
export function SecretDialog({
  secret,
  onClose,
}: {
  secret: { title: string; value: string; hint: string } | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const close = () => {
    setCopied(false);
    onClose();
  };
  return (
    <Dialog open={secret !== null} onClose={close} maxWidth="xs" fullWidth>
      {secret && (
        <>
          <DialogTitle>{secret.title}</DialogTitle>
          <DialogContent>
            <Box
              aria-label={secret.title}
              sx={{
                fontFamily: 'monospace',
                fontSize: '0.9375rem',
                p: 1.5,
                borderRadius: 1.5,
                bgcolor: 'action.hover',
                wordBreak: 'break-all',
                userSelect: 'all',
              }}
            >
              {secret.value}
            </Box>
            <DialogContentText variant="body2" sx={{ mt: 1.5 }}>
              {secret.hint}
            </DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button
              startIcon={<CopyIcon />}
              onClick={() =>
                void navigator.clipboard?.writeText(secret.value).then(() => setCopied(true))
              }
            >
              {copied ? t('admin.copied') : t('admin.copy')}
            </Button>
            <Button variant="contained" disableElevation onClick={close}>
              {t('admin.done')}
            </Button>
          </DialogActions>
        </>
      )}
    </Dialog>
  );
}

/** Are you sure, for actions that sign people out or detach things. */
export function ConfirmDialog({
  confirm,
  onClose,
}: {
  confirm: { title: string; text: string; action: string; run: () => void } | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={confirm !== null} onClose={onClose} maxWidth="xs" fullWidth>
      {confirm && (
        <>
          <DialogTitle>{confirm.title}</DialogTitle>
          <DialogContent>
            <DialogContentText>{confirm.text}</DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button onClick={onClose}>{t('admin.cancel')}</Button>
            <Button
              variant="contained"
              color="error"
              disableElevation
              onClick={() => {
                confirm.run();
                onClose();
              }}
            >
              {confirm.action}
            </Button>
          </DialogActions>
        </>
      )}
    </Dialog>
  );
}
