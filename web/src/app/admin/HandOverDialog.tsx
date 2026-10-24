import {
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  TextField,
  Typography,
} from '@mui/material';
import { useCallback, useState } from 'react';
import type { AdminApi, AdminUser } from '../../ports/admin.ts';
import { t } from '../i18n/i18n.ts';
import { useLoaded } from './useAdmin.ts';

/**
 * Hand someone's shared lists and groups to another person (spec: Account management,
 * ownership). Members and tasks stay; the old owner stays in as an editor or member.
 */
export function HandOverDialog({
  api,
  user,
  users,
  onClose,
  onDone,
}: {
  api: AdminApi;
  user: AdminUser;
  users: AdminUser[];
  onClose: () => void;
  onDone: (moved: number) => void;
}) {
  const load = useCallback(() => api.shared(user.id), [api, user.id]);
  const { data: shares } = useLoaded(load);
  const [left, setLeft] = useState<ReadonlySet<string>>(new Set());
  const [to, setTo] = useState('');
  const chosen = (shares ?? []).filter((share) => !left.has(share.id));
  const toggle = (id: string) => {
    const next = new Set(left);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setLeft(next);
  };
  const handOver = async () => {
    const moved = await api.handOver(
      user.id,
      to,
      chosen.map((share) => share.id),
    );
    onDone(moved);
    onClose();
  };
  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{t('admin.handOver.title', { name: user.username })}</DialogTitle>
      <DialogContent>
        {shares?.length === 0 && (
          <DialogContentText>
            {t('admin.handOver.nothing', { name: user.username })}
          </DialogContentText>
        )}
        {shares && shares.length > 0 && (
          <>
            <DialogContentText variant="body2" sx={{ mb: 1 }}>
              {t('admin.handOver.hint')}
            </DialogContentText>
            {shares.map((share) => (
              <FormControlLabel
                key={share.id}
                sx={{ display: 'flex', mr: 0 }}
                control={
                  <Checkbox checked={!left.has(share.id)} onChange={() => toggle(share.id)} />
                }
                label={
                  <Box>
                    <Typography>{share.name}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {t(share.kind === 'list' ? 'admin.handOver.list' : 'admin.handOver.group', {
                        count: share.people,
                      })}
                    </Typography>
                  </Box>
                }
              />
            ))}
            <TextField
              select
              fullWidth
              size="small"
              label={t('admin.handOver.to')}
              value={to}
              onChange={(event) => setTo(event.target.value)}
              sx={{ mt: 2 }}
            >
              {users
                .filter((each) => each.id !== user.id && !each.disabled)
                .map((each) => (
                  <MenuItem key={each.id} value={each.id}>
                    {each.username}
                  </MenuItem>
                ))}
            </TextField>
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('admin.cancel')}</Button>
        {shares && shares.length > 0 && (
          <Button
            variant="contained"
            disableElevation
            disabled={to === '' || chosen.length === 0}
            onClick={() => void handOver()}
          >
            {t('admin.handOver.button')}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
