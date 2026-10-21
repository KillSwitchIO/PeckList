import { Button, Snackbar, useTheme } from '@mui/material';
import { t } from '../i18n/i18n.ts';
import { useStoreState } from '../store/hooks.ts';

export function UndoToast({ bottomOffset = 0 }: { bottomOffset?: number }) {
  const entry = useStoreState((state) => state.lastUndoable);
  const undo = useStoreState((state) => state.undo);
  const dismiss = useStoreState((state) => state.dismissUndo);
  const theme = useTheme();
  // Snackbars invert the surface (dark in light mode, light in dark mode).
  const actionColor =
    theme.palette.mode === 'light' ? theme.punchlist.accentContainer : theme.punchlist.accent.on;
  return (
    <Snackbar
      key={entry?.id}
      open={entry !== null}
      autoHideDuration={6000}
      onClose={(_, reason) => {
        if (reason !== 'clickaway') dismiss();
      }}
      message={entry?.label}
      sx={{ bottom: { xs: 16 + bottomOffset } }}
      action={
        <Button size="small" sx={{ color: actionColor }} onClick={() => entry && undo(entry.id)}>
          {t('common.undo')}
        </Button>
      }
    />
  );
}
