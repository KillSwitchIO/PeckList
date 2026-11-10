import { Snackbar } from '@mui/material';
import { copyByHandText } from './copy.ts';

/** The note after a copy the browser refused: the text is selected, press Ctrl+C (or hold). */
export function CopyByHand({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Snackbar
      open={open}
      autoHideDuration={6000}
      onClose={(_, reason) => reason !== 'clickaway' && onClose()}
      message={copyByHandText()}
    />
  );
}
