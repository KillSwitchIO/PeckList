import { Button, Snackbar } from '@mui/material';
import { useEffect, useRef, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { t } from '../i18n/i18n.ts';
import { useSyncState } from '../sync/syncContext.ts';

/** How often an open app asks for a new version (a PWA left open for days never reloads). */
const CHECK_EVERY_MS = 60 * 60 * 1000;

/**
 * Offers the new version when the service worker has one. Also the path for "Update app" on newer
 * data files, and for a server that moved to newer data than this app knows: then syncing has
 * stopped, so it says so plainly, looks for the new version at once, and reloads into it.
 */
export function UpdatePrompt() {
  const registration = useRef<ServiceWorkerRegistration | null>(null);
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, found) {
      if (!found) return;
      registration.current = found;
      setInterval(() => void found.update().catch(() => undefined), CHECK_EVERY_MS);
    },
  });
  const tooOld = useSyncState((state) => state.status === 'app-update');
  const [laterTooOld, setLaterTooOld] = useState(false);

  // The server is ahead: fetch the new version now rather than at the next hourly check.
  useEffect(() => {
    if (tooOld) void registration.current?.update().catch(() => undefined);
  }, [tooOld]);

  const close = () => {
    setNeedRefresh(false);
    setOfflineReady(false);
    if (tooOld) setLaterTooOld(true);
  };
  const behind = tooOld && !laterTooOld;
  const update = () => {
    // No new service worker to switch to (not installed yet, or none): a plain reload fetches it.
    if (needRefresh) void updateServiceWorker(true);
    else window.location.reload();
  };

  return (
    <Snackbar
      open={needRefresh || offlineReady || behind}
      onClose={(_, reason) => {
        // Syncing has stopped: a stray tap elsewhere should not hide that.
        if (behind && reason === 'clickaway') return;
        close();
      }}
      message={
        behind
          ? t('sync.appUpdate')
          : needRefresh
            ? t('pwa.updateAvailable')
            : t('pwa.offlineReady')
      }
      action={
        needRefresh || behind ? (
          <>
            {behind && (
              <Button size="small" color="inherit" onClick={close}>
                {t('pwa.later')}
              </Button>
            )}
            <Button color="primary" variant="contained" size="small" onClick={update}>
              {t('pwa.reload')}
            </Button>
          </>
        ) : (
          <Button size="small" onClick={close}>
            {t('common.dismiss')}
          </Button>
        )
      }
    />
  );
}
