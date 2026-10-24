import { Button, Snackbar, useTheme } from '@mui/material';
import { t } from '../i18n/i18n.ts';
import { noticeText } from './syncNotice.ts';
import { useSyncState } from './syncContext.ts';

/**
 * Says when the server undid this device's changes (it may not make them any more) or took a
 * shared list away (spec: Sharing, revocation). Stays until dismissed: the person should know.
 */
export function SyncNoticeToast() {
  const notice = useSyncState((state) => state.notice);
  const dismiss = useSyncState((state) => state.dismissNotice);
  const theme = useTheme();
  const actionColor =
    theme.palette.mode === 'light' ? theme.punchlist.accentContainer : theme.punchlist.accent.on;
  return (
    <Snackbar
      open={notice !== null}
      onClose={(_, reason) => {
        if (reason !== 'clickaway') dismiss();
      }}
      message={notice ? noticeText(notice) : ''}
      // At the top: clear of the undo toast and the phone's + button at the bottom.
      anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      action={
        <Button size="small" sx={{ color: actionColor }} onClick={dismiss}>
          {t('common.ok')}
        </Button>
      }
    />
  );
}
