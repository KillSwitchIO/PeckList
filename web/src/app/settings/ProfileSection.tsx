import { Box, Button, Typography } from '@mui/material';
import { useState } from 'react';
import { setProfilePhoto } from '../../core/profile.ts';
import { Avatar } from '../friends/Avatar.tsx';
import { PhotoDialog } from '../friends/PhotoDialog.tsx';
import { t } from '../i18n/i18n.ts';
import { useApply, useStoreState } from '../store/hooks.ts';
import { useSyncState } from '../sync/syncContext.ts';
import { Section } from './settingsLayout.tsx';

const NO_COLOR = '#B8BCC4';

/**
 * Settings > Profile (spec: R-FB-57, R-FB-63): your picture as others see it, to change or take
 * away. Signed in only: the picture lives on your profile, which friends see.
 */
export function ProfileSection() {
  const apply = useApply();
  const account = useSyncState((state) => state.account);
  const me = useStoreState((state) =>
    account ? state.workspace?.entities.users.find((user) => user.id === account.id) : undefined,
  );
  const [editing, setEditing] = useState(false);
  if (!account || !me) return null;
  const name = me.displayName || (account.authMode === 'local' ? account.username : '');
  return (
    <Section title={t('profile.section')}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 1, flexWrap: 'wrap' }}>
        <Avatar name={name} color={me.avatarColor ?? NO_COLOR} photo={me.photo} size={64} />
        <Box sx={{ flex: '1 1 10rem', minWidth: 0 }}>
          <Typography sx={{ fontWeight: 600 }} noWrap>
            {name}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {t('profile.photoHint')}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button variant="outlined" size="small" onClick={() => setEditing(true)}>
            {me.photo ? t('photo.change') : t('photo.choose')}
          </Button>
          {me.photo && (
            <Button
              size="small"
              color="error"
              onClick={() =>
                apply((ctx, ws) => setProfilePhoto(ctx, ws, ''), t('undo.photoRemoved'))
              }
            >
              {t('photo.remove')}
            </Button>
          )}
        </Box>
      </Box>
      {editing && (
        <PhotoDialog
          name={name}
          color={me.avatarColor ?? NO_COLOR}
          photo={me.photo || undefined}
          onClose={() => setEditing(false)}
        />
      )}
    </Section>
  );
}
