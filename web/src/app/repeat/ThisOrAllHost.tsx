// The one dialog that asks a repeating task's question (thisOrAll.ts): just this date, or all.

import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { t } from '../i18n/i18n.ts';
import { isAsker, setAsker, type Asked } from './thisOrAll.ts';

export function ThisOrAllHost() {
  const [asked, setAsked] = useState<Asked | null>(null);
  useEffect(() => {
    setAsker(setAsked);
    return () => {
      if (isAsker(setAsked)) setAsker(null);
    };
  }, []);
  return (
    <Dialog
      open={asked !== null}
      onClose={() => asked?.answer(null)}
      fullWidth
      maxWidth="xs"
      aria-labelledby="this-or-all-title"
    >
      {asked && (
        <>
          <DialogTitle id="this-or-all-title">{asked.title}</DialogTitle>
          <DialogContent>
            <DialogContentText>{asked.message}</DialogContentText>
          </DialogContent>
          <DialogActions sx={{ flexWrap: 'wrap', gap: 1 }}>
            <Button onClick={() => asked.answer(null)}>{t('common.cancel')}</Button>
            <Button variant="outlined" onClick={() => asked.answer('all')}>
              {asked.allLabel}
            </Button>
            <Button variant="contained" autoFocus onClick={() => asked.answer('this')}>
              {asked.thisLabel}
            </Button>
          </DialogActions>
        </>
      )}
    </Dialog>
  );
}
