import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  MenuItem,
  TextField,
  Typography,
} from '@mui/material';
import { useCallback } from 'react';
import type { AdminApi, AdminUser } from '../../ports/admin.ts';
import { t } from '../i18n/i18n.ts';
import { CloseIcon } from '../icons/icons.tsx';
import { useLoaded } from './useAdmin.ts';

/** Someone's friends, as an admin sets them up (spec: Account management, Friends). */
export function FriendsDialog({
  api,
  user,
  users,
  onClose,
}: {
  api: AdminApi;
  user: AdminUser;
  users: AdminUser[];
  onClose: () => void;
}) {
  const load = useCallback(() => api.friends(user.id), [api, user.id]);
  const { data: friends, reload } = useLoaded(load);
  const others = users.filter(
    (each) => each.id !== user.id && !friends?.some((friend) => friend.userId === each.id),
  );
  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{t('admin.friends.title', { name: user.username })}</DialogTitle>
      <DialogContent>
        {(friends ?? []).map((friend) => (
          <Box key={friend.userId} sx={{ display: 'flex', alignItems: 'center', py: 0.5 }}>
            <Box sx={{ flexGrow: 1, minWidth: 0 }}>
              <Typography noWrap>{friend.username}</Typography>
              {friend.state === 'pending' && (
                <Typography variant="caption" color="text.secondary">
                  {t('admin.friends.pending')}
                </Typography>
              )}
            </Box>
            <IconButton
              size="small"
              aria-label={t('admin.friends.end', { name: friend.username })}
              onClick={() => void api.endFriendship(user.id, friend.userId).then(reload)}
            >
              <CloseIcon fontSize="small" />
            </IconButton>
          </Box>
        ))}
        {friends?.length === 0 && (
          <Typography color="text.secondary">{t('admin.friends.none')}</Typography>
        )}
        {others.length > 0 && (
          <TextField
            select
            size="small"
            fullWidth
            label={t('admin.friends.add')}
            value=""
            onChange={(event) => void api.makeFriends(user.id, event.target.value).then(reload)}
            sx={{ mt: 2 }}
          >
            {others.map((each) => (
              <MenuItem key={each.id} value={each.id}>
                {each.username}
              </MenuItem>
            ))}
          </TextField>
        )}
      </DialogContent>
      <DialogActions>
        <Button variant="contained" disableElevation onClick={onClose}>
          {t('admin.done')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
