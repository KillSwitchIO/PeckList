import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
} from '@mui/material';
import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { AdminResult } from '../../ports/admin.ts';
import { copyOrSelect } from '../copy.ts';
import { CopyByHand } from '../CopyByHand.tsx';
import { t } from '../i18n/i18n.ts';
import { CopyIcon } from '../icons/icons.tsx';
import { ProblemAlert } from '../layout/ProblemAlert.tsx';
import { refusalText } from './useAdmin.ts';

/**
 * A dialog that runs one admin action: a title, a line of text, the fields, the server's refusal
 * when it has one, Cancel and the action (Enter in a field runs it too).
 */
export function ActionDialog<T>({
  title,
  text,
  action,
  ready,
  run,
  onDone,
  onClose,
  children,
}: {
  title: string;
  text: string;
  action: string;
  /** Whether the fields are filled in enough to try. */
  ready: boolean;
  run: () => Promise<AdminResult<T>>;
  onDone: (value: T) => void;
  onClose: () => void;
  children: ReactNode;
}) {
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setProblem(null);
    try {
      const result = await run();
      if (!result.ok) {
        setProblem(refusalText(result.reason));
        return;
      }
      onDone(result.value);
      onClose();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <Box component="form" onSubmit={(event) => void submit(event)}>
        <DialogTitle>{title}</DialogTitle>
        <DialogContent sx={{ display: 'grid', gap: 2 }}>
          <DialogContentText>{text}</DialogContentText>
          {children}
          <ProblemAlert problem={problem} />
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>{t('admin.cancel')}</Button>
          <Button type="submit" variant="contained" disableElevation disabled={!ready || busy}>
            {action}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}

/** A password or link shown once, with Copy (spec: Account management, "shown once"). */
export function SecretDialog({
  secret,
  onClose,
}: {
  secret: { title: string; value: string; hint: string } | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [byHand, setByHand] = useState(false);
  const field = useRef<HTMLDivElement>(null);
  const close = () => {
    setCopied(false);
    setByHand(false);
    onClose();
  };
  return (
    <Dialog open={secret !== null} onClose={close} maxWidth="xs" fullWidth>
      {secret && (
        <>
          <DialogTitle>{secret.title}</DialogTitle>
          <DialogContent>
            <Box
              ref={field}
              aria-label={secret.title}
              sx={{
                fontFamily: 'monospace',
                fontSize: '0.9375rem',
                p: 1.5,
                borderRadius: 1.5,
                bgcolor: 'action.hover',
                wordBreak: 'break-all',
                userSelect: 'all',
              }}
            >
              {secret.value}
            </Box>
            <DialogContentText variant="body2" sx={{ mt: 1.5 }}>
              {secret.hint}
            </DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button
              startIcon={<CopyIcon />}
              onClick={(event) =>
                void copyOrSelect(secret.value, field.current, event.currentTarget).then(
                  (result) => (result === 'copied' ? setCopied(true) : setByHand(true)),
                )
              }
            >
              {copied ? t('admin.copied') : t('admin.copy')}
            </Button>
            <Button variant="contained" disableElevation onClick={close}>
              {t('admin.done')}
            </Button>
          </DialogActions>
          <CopyByHand open={byHand} onClose={() => setByHand(false)} />
        </>
      )}
    </Dialog>
  );
}

/** Are you sure, for actions that sign people out or detach things. */
export function ConfirmDialog({
  confirm,
  onClose,
}: {
  confirm: { title: string; text: string; action: string; run: () => void } | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={confirm !== null} onClose={onClose} maxWidth="xs" fullWidth>
      {confirm && (
        <>
          <DialogTitle>{confirm.title}</DialogTitle>
          <DialogContent>
            <DialogContentText>{confirm.text}</DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button onClick={onClose}>{t('admin.cancel')}</Button>
            <Button
              variant="contained"
              color="error"
              disableElevation
              onClick={() => {
                confirm.run();
                onClose();
              }}
            >
              {confirm.action}
            </Button>
          </DialogActions>
        </>
      )}
    </Dialog>
  );
}
