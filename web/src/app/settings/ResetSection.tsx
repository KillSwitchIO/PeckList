import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControlLabel,
} from '@mui/material';
import { useMemo, useState } from 'react';
import { replaceable, trashMine } from '../../core/interchange/apply.ts';
import { emptyTrash } from '../../core/trash.ts';
import { t } from '../i18n/i18n.ts';
import { useWorkspaceStore } from '../store/hooks.ts';
import { Section } from './settingsLayout.tsx';

/**
 * Settings > Start over, last on the page: every list, task and tag that is mine goes to the Trash
 * at once (lists others share with me stay), as one undo; or, ticked, the Trash is emptied too,
 * which cannot be undone.
 */
export function ResetSection() {
  const store = useWorkspaceStore();
  const [open, setOpen] = useState(false);
  const [purge, setPurge] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const workspace = store.getState().workspace;
  const counts = useMemo(() => {
    if (!workspace || !open) return { lists: 0, tasks: 0, tags: 0 };
    const found = replaceable(workspace, store.getState().context().userId);
    return { lists: found.lists.length, tasks: found.tasks.length, tags: found.tags.length };
  }, [workspace, store, open]);

  const close = () => {
    setOpen(false);
    setPurge(false);
  };

  const reset = () => {
    if (purge) {
      // Emptying the Trash cannot be undone, so neither can this.
      store.getState().apply((ctx, ws) => emptyTrash(ctx, trashMine(ctx, ws).workspace));
    } else {
      store.getState().apply((ctx, ws) => trashMine(ctx, ws).workspace, t('undo.startedOver'));
    }
    setNotice(t(purge ? 'settings.reset.donePurged' : 'settings.reset.done', counts));
    close();
  };

  return (
    <Section title={t('settings.reset')} hint={t('settings.reset.hint')}>
      <Button variant="outlined" color="error" onClick={() => setOpen(true)}>
        {t('settings.reset.action')}
      </Button>
      {notice && (
        <Alert
          severity="success"
          variant="outlined"
          sx={{ mt: 1.5 }}
          onClose={() => setNotice(null)}
        >
          {notice}
        </Alert>
      )}
      <Dialog open={open} onClose={close} maxWidth="xs" fullWidth>
        <DialogTitle>{t('settings.reset.title')}</DialogTitle>
        <DialogContent>
          <DialogContentText>{t('settings.reset.confirm', counts)}</DialogContentText>
          <FormControlLabel
            sx={{ mt: 1.5 }}
            control={
              <Checkbox checked={purge} onChange={(event) => setPurge(event.target.checked)} />
            }
            label={t('settings.reset.purge')}
          />
          {purge && (
            <Alert severity="error" variant="outlined" sx={{ mt: 1 }}>
              {t('settings.reset.purgeWarning')}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={close}>{t('common.cancel')}</Button>
          <Button variant="contained" color="error" disableElevation onClick={reset}>
            {t(purge ? 'settings.reset.goPurge' : 'settings.reset.go')}
          </Button>
        </DialogActions>
      </Dialog>
    </Section>
  );
}
