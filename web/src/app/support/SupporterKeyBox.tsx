import { Alert, Box, Button, TextField, Typography } from '@mui/material';
import { useState, type FormEvent } from 'react';
import { messageOf } from '../../core/errors.ts';
import type { SupporterRefusal } from '../../ports/sync.ts';
import { t } from '../i18n/i18n.ts';

/**
 * The box a supporter key is pasted into, for a person (Settings) or the server (Admin). The
 * refusals are said the way the person can act on them; the other kind of key names where it goes.
 */
export function SupporterKeyBox({
  wrongKind,
  onEnter,
}: {
  /** What to say when the other kind of key is pasted. */
  wrongKind: string;
  /** Enter the key: nothing back when it was taken, else why not. */
  onEnter: (key: string) => Promise<SupporterRefusal | null>;
}) {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft.trim()) return;
    setBusy(true);
    setProblem(null);
    try {
      const refused = await onEnter(draft.trim());
      if (refused === 'not-a-key') setProblem(t('support.key.notAKey'));
      else if (refused === 'not-genuine') setProblem(t('support.key.notGenuine'));
      else if (refused === 'wrong-kind') setProblem(wrongKind);
      else setDraft('');
    } catch (error) {
      setProblem(messageOf(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box component="form" onSubmit={submit} noValidate>
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
        <TextField
          size="small"
          fullWidth
          label={t('support.key.label')}
          placeholder="PECKLIST-..."
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          autoComplete="off"
          spellCheck={false}
          slotProps={{
            htmlInput: { 'aria-describedby': problem ? 'supporter-key-problem' : undefined },
          }}
        />
        <Button type="submit" variant="contained" disabled={busy || !draft.trim()}>
          {t('support.key.enter')}
        </Button>
      </Box>
      {problem && (
        <Alert id="supporter-key-problem" severity="warning" sx={{ mt: 1 }}>
          {problem}
        </Alert>
      )}
    </Box>
  );
}

/** The thank-you a key earns, with its date, and a quiet way to take the key back off. */
export function SupporterThanks({
  text,
  removeLabel,
  onRemove,
}: {
  text: string;
  removeLabel?: string | undefined;
  onRemove?: (() => Promise<void>) | undefined;
}) {
  const [problem, setProblem] = useState<string | null>(null);
  const remove = async () => {
    if (!onRemove) return;
    setProblem(null);
    try {
      await onRemove();
    } catch (error) {
      setProblem(messageOf(error));
    }
  };
  return (
    <Box>
      <Typography variant="body2">{text}</Typography>
      {onRemove && removeLabel && (
        <Button size="small" color="inherit" onClick={() => void remove()} sx={{ mt: 0.5, ml: -1 }}>
          {removeLabel}
        </Button>
      )}
      {problem && (
        <Alert severity="warning" sx={{ mt: 1 }}>
          {problem}
        </Alert>
      )}
    </Box>
  );
}
