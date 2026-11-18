import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  TextField,
} from '@mui/material';
import { useEffect, useState, type FormEvent } from 'react';
import { messageOf } from '../../core/errors.ts';
import type { StartOverInfo } from '../../ports/sync.ts';
import { t } from '../i18n/i18n.ts';
import { PasswordField } from '../layout/PasswordField.tsx';
import { ProblemAlert } from '../layout/ProblemAlert.tsx';
import { useWorkspaceStore } from '../store/hooks.ts';
import { lockedProblem } from '../sync/passwordChange.ts';
import { useSyncState } from '../sync/syncContext.ts';
import { waysBack, type WayBack } from './deleteAccount.ts';
import { downloadWorkspace } from './exportFile.ts';
import { SignInAgain, type SignInAgainText } from './SignInAgain.tsx';

const BLOCKED = {
  not_while_impersonating: 'startOver.viewingAs',
  no_sign_in: 'startOver.noSignIn',
} as const;

const SIGN_IN_TEXT: SignInAgainText = {
  signInAgain: 'startOver.signInAgain',
  stillNotRecent: 'startOver.stillNotRecent',
  useBrowser: 'startOver.useBrowser',
  noWayBack: 'startOver.noWayBack',
};

/**
 * Start over (PL-147): erase this account's own tasks, lists, tags and comments and keep the
 * account. Asks for the same proof as Delete my account, offers a download first, and is final once
 * "start over" is typed. Afterwards this device syncs at once, and starts over like the others.
 */
export function StartOverDialog({
  appCanSignIn,
  returned,
  onClose,
  onDone,
}: {
  appCanSignIn: boolean;
  /** Just back from signing in again for this. */
  returned: boolean;
  onClose: () => void;
  onDone: (handedOn: number) => void;
}) {
  const api = useSyncState((state) => state.transport.account);
  const syncNow = useSyncState((state) => state.syncNow);
  const store = useWorkspaceStore();
  const [info, setInfo] = useState<StartOverInfo | null>(null);
  const [ways, setWays] = useState<WayBack[] | null>(null);
  const [password, setPassword] = useState('');
  const [typed, setTyped] = useState('');
  const [exported, setExported] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [needSignIn, setNeedSignIn] = useState(false);
  const [busy, setBusy] = useState(false);

  // Asked afresh on opening: the sign-in may have just become recent, or stopped being.
  useEffect(() => {
    let live = true;
    void (async () => {
      const answer = await api?.startOverInfo?.();
      if (!live || !answer) return;
      setInfo(answer);
      if (answer.proof !== 'sign-in' || answer.blocked) return;
      setNeedSignIn(!answer.signedInRecently);
      const found = await waysBack(api, 'startover');
      if (live) setWays(found);
    })().catch(() => undefined);
    return () => {
      live = false;
    };
  }, [api]);

  const phrase = t('startOver.phrase');
  const blocked = info?.blocked ?? null;
  const signInFirst = info?.proof === 'sign-in' && needSignIn;
  const canStart = info !== null && !blocked && !signInFirst;
  const confirmed = typed.trim().toLowerCase() === phrase;

  const download = () => {
    const workspace = store.getState().workspace;
    if (!workspace) return;
    downloadWorkspace(workspace);
    setExported(true);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!info || !api?.startOver || !confirmed) return;
    setBusy(true);
    setProblem(null);
    try {
      const outcome = await api.startOver(info.proof === 'password' ? password : undefined);
      if (outcome.kind === 'started-over') {
        // The server has a new epoch for this account: this sync finds it and starts over.
        await syncNow().catch(() => undefined);
        onDone(outcome.handedOn);
        return;
      }
      if (outcome.kind === 'wrong-password') setProblem(t('deleteAccount.wrongPassword'));
      else if (outcome.kind === 'locked') setProblem(lockedProblem(outcome.until));
      else if (outcome.kind === 'sign-in-again') setNeedSignIn(true);
      else if (outcome.kind === 'too-many') setProblem(t('deleteAccount.tooMany'));
      else {
        // Refused from here, or the account is gone: the server says which.
        const now = await api.startOverInfo?.();
        if (now) setInfo(now);
        else setProblem(t('startOver.noWayBack'));
      }
    } catch (error) {
      setProblem(messageOf(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="xs" fullWidth>
      <Box component="form" onSubmit={(event) => void submit(event)}>
        <DialogTitle>{t('startOver.dialog')}</DialogTitle>
        <DialogContent sx={{ display: 'grid', gap: 2 }}>
          {blocked ? (
            <Alert severity="info" variant="outlined">
              {t(BLOCKED[blocked])}
            </Alert>
          ) : (
            info && (
              <>
                <DialogContentText>{t('startOver.what')}</DialogContentText>
                <DialogContentText>{t('startOver.shared')}</DialogContentText>
                <Box sx={{ display: 'grid', gap: 1, justifyItems: 'start' }}>
                  <DialogContentText>{t('startOver.exportHint')}</DialogContentText>
                  <Button variant="outlined" onClick={download}>
                    {exported ? t('startOver.exported') : t('startOver.export')}
                  </Button>
                </Box>
              </>
            )
          )}
          {canStart && info.proof === 'password' && (
            <PasswordField
              label={t('deleteAccount.password')}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          )}
          {canStart && (
            <TextField
              label={t('startOver.type', { phrase: `"${phrase}"` })}
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
              slotProps={{ htmlInput: { autoCapitalize: 'none', spellCheck: false } }}
              required
            />
          )}
          {!blocked && signInFirst && (
            <SignInAgain
              ways={ways}
              appCanSignIn={appCanSignIn}
              returned={returned}
              text={SIGN_IN_TEXT}
            />
          )}
          <ProblemAlert problem={problem} />
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          {canStart && (
            <Button
              type="submit"
              color="error"
              variant="contained"
              disableElevation
              disabled={busy || !confirmed || (info.proof === 'password' && password === '')}
            >
              {busy ? t('startOver.working') : t('startOver.confirm')}
            </Button>
          )}
        </DialogActions>
      </Box>
    </Dialog>
  );
}
