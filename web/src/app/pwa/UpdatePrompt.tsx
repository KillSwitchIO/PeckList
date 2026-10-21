import { Button, Snackbar } from '@mui/material';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { t } from '../i18n/i18n.ts';

/** Offers the new version when the service worker has one. Also the path for "Update app" on newer data files. */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW();

  const close = () => {
    setNeedRefresh(false);
    setOfflineReady(false);
  };

  return (
    <Snackbar
      open={needRefresh || offlineReady}
      onClose={close}
      message={needRefresh ? t('pwa.updateAvailable') : t('pwa.offlineReady')}
      action={
        needRefresh ? (
          <Button
            color="primary"
            variant="contained"
            size="small"
            onClick={() => void updateServiceWorker(true)}
          >
            {t('pwa.reload')}
          </Button>
        ) : (
          <Button size="small" onClick={close}>
            {t('common.dismiss')}
          </Button>
        )
      }
    />
  );
}
