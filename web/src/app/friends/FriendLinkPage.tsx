import { Alert, Box, Button, CircularProgress, Paper, Typography } from '@mui/material';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import type { ProfilePreview } from '../../ports/sync.ts';
import { t } from '../i18n/i18n.ts';
import { Page } from '../layout/Page.tsx';
import { useSyncState } from '../sync/syncContext.ts';
import { Avatar } from './Avatar.tsx';

/**
 * `/f/<code>`: the confirmation screen a friend link opens (spec: Sharing & Permissions). It shows
 * who sent it before anything happens; Accept makes you friends at once.
 */
export function FriendLinkPage() {
  const { code = '' } = useParams();
  const navigate = useNavigate();
  const phase = useSyncState((state) => state.phase);
  const friends = useSyncState((state) => state.transport.friends);
  const syncNow = useSyncState((state) => state.syncNow);
  const [preview, setPreview] = useState<ProfilePreview | null | undefined>(undefined);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (phase !== 'ready' || !friends) return;
    let live = true;
    void friends
      .preview(code)
      .then((found) => live && setPreview(found))
      .catch(() => live && setPreview(null));
    return () => {
      live = false;
    };
  }, [code, friends, phase]);

  const toFriends = () => void navigate('/friends');

  let body: React.ReactNode;
  if (phase !== 'ready' || !friends) {
    body = <Typography color="text.secondary">{t('friends.needsServer')}</Typography>;
  } else if (preview === undefined) {
    body = <CircularProgress aria-label={t('status.loading')} />;
  } else if (preview === null) {
    body = (
      <Alert severity="warning" variant="outlined">
        {t('friendLink.gone')}
      </Alert>
    );
  } else {
    const since = new Date(preview.memberSince).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
    });
    body = (
      <Paper variant="outlined" sx={{ p: 3, borderRadius: 3, maxWidth: 420 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
          <Avatar name={preview.displayName} color={preview.avatarColor} size={48} />
          <Box>
            <Typography variant="h6" component="p">
              {preview.self
                ? preview.displayName
                : t('friendLink.wants', { name: preview.displayName })}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t('friendLink.handle')}: {preview.handle} · {t('friendLink.since')} {since}
            </Typography>
          </Box>
        </Box>
        {preview.self ? (
          <Typography color="text.secondary">{t('friendLink.self')}</Typography>
        ) : done || preview.friendship === 'accepted' ? (
          <Box sx={{ display: 'grid', gap: 2 }}>
            <Typography>
              {done
                ? t('friendLink.done', { name: preview.displayName })
                : t('friendLink.already', { name: preview.displayName })}
            </Typography>
            <Button variant="outlined" onClick={toFriends} sx={{ justifySelf: 'start' }}>
              {t('friendLink.toFriends')}
            </Button>
          </Box>
        ) : (
          <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
            <Button onClick={toFriends}>{t('friendLink.decline')}</Button>
            <Button
              variant="contained"
              disableElevation
              onClick={() =>
                void friends.accept(code).then((id) => {
                  if (id) {
                    setDone(true);
                    void syncNow();
                  } else {
                    setPreview(null);
                  }
                })
              }
            >
              {t('friendLink.accept')}
            </Button>
          </Box>
        )}
      </Paper>
    );
  }
  return <Page title={t('friendLink.title')}>{body}</Page>;
}
