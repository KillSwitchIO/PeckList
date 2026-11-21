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
import { submitOnShiftEnter } from '../hooks/keys.ts';
import { useRef, useState, type ReactNode } from 'react';
import { buildPalette } from '../../core/palette.ts';
import type { List } from '../../core/types.ts';
import { ColorPicker } from '../colors/ColorPicker.tsx';
import { IconPicker } from './IconPicker.tsx';
import { stemOf } from '../../core/attachments.ts';
import { t } from '../i18n/i18n.ts';

const LIGHT = buildPalette('light');

export interface ListFormValue {
  name: string;
  color: string;
  icon: string | null;
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
  const [icon, setIcon] = useState<string | null>(list?.icon ?? null);
  const valid = name.trim().length > 0;

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <form
        onKeyDown={submitOnShiftEnter}
        onSubmit={(event) => {
          event.preventDefault();
          if (valid) onSubmit({ name: name.trim(), color, icon });
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
            <Box>
              <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 1 }}>
                {t('list.icon')}
              </Typography>
              <IconPicker value={icon} color={color} onChange={setIcon} />
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

/**
 * One-field dialog for names (sections, groups, files). `fileName` selects the name before its
 * extension when the field first takes focus, so the extension stays unless it is edited.
 */
export function NameDialog({
  open,
  title,
  label,
  initial = '',
  submitLabel,
  fileName = false,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  label: string;
  initial?: string;
  submitLabel: string;
  fileName?: boolean;
  onClose: () => void;
  onSubmit: (name: string) => void;
}) {
  const [name, setName] = useState(initial);
  const selected = useRef(false);
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <form
        onKeyDown={submitOnShiftEnter}
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
            onFocus={(event) => {
              if (!fileName || selected.current) return;
              selected.current = true;
              const input = event.target as HTMLInputElement;
              input.setSelectionRange(...stemOf(input.value));
            }}
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
  children,
}: {
  open: boolean;
  message: string;
  confirmLabel: string;
  onClose: () => void;
  onConfirm: () => void;
  /** Choices that go with the question, under it. */
  children?: ReactNode;
}) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs">
      <DialogContent>
        <Typography>{message}</Typography>
        {children}
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
