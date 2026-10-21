import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useState } from 'react';
import { buildPalette } from '../../core/palette.ts';
import type { List } from '../../core/types.ts';
import { ColorPicker } from '../colors/ColorPicker.tsx';
import { t } from '../i18n/i18n.ts';

const LIGHT = buildPalette('light');

export interface ListFormValue {
  name: string;
  color: string;
}

export function ListDialog({
  open,
  list,
  onClose,
  onSubmit,
}: {
  open: boolean;
  list?: List;
  onClose: () => void;
  onSubmit: (value: ListFormValue) => void;
}) {
  const [name, setName] = useState(list?.name ?? '');
  const [color, setColor] = useState(list?.color ?? LIGHT.pastels.sky.fill);
  const valid = name.trim().length > 0;

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (valid) onSubmit({ name: name.trim(), color });
        }}
      >
        <DialogTitle>{list ? t('list.edit') : t('list.new')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {!list?.isInbox && (
              <TextField
                label={t('list.name')}
                value={name}
                autoFocus
                onChange={(event) => setName(event.target.value)}
              />
            )}
            <Box>
              <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 1 }}>
                {t('list.color')}
              </Typography>
              <ColorPicker value={color} onChange={setColor} />
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="contained" disabled={!valid}>
            {list ? t('common.save') : t('common.create')}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

/** One-field dialog for names (sections). */
export function NameDialog({
  open,
  title,
  label,
  initial = '',
  submitLabel,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  label: string;
  initial?: string;
  submitLabel: string;
  onClose: () => void;
  onSubmit: (name: string) => void;
}) {
  const [name, setName] = useState(initial);
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim()) onSubmit(name.trim());
        }}
      >
        <DialogTitle>{title}</DialogTitle>
        <DialogContent>
          <TextField
            label={label}
            value={name}
            autoFocus
            fullWidth
            sx={{ mt: 1 }}
            onChange={(event) => setName(event.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="contained" disabled={!name.trim()}>
            {submitLabel}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

export function ConfirmDialog({
  open,
  message,
  confirmLabel,
  onClose,
  onConfirm,
}: {
  open: boolean;
  message: string;
  confirmLabel: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs">
      <DialogContent>
        <Typography>{message}</Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button color="error" variant="contained" onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
