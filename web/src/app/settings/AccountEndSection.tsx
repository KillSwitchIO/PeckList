import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
} from '@mui/material';
import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { messageOf } from '../../core/errors.ts';
import type { AccountDeletion } from '../../ports/sync.ts';
import { t } from '../i18n/i18n.ts';
import { PasswordField } from '../layout/PasswordField.tsx';
import { ProblemAlert } from '../layout/ProblemAlert.tsx';
import { PLAY_API, useShellInfo } from '../native/shell.ts';
import { lockedProblem } from '../sync/passwordChange.ts';
import { rememberProvider } from '../sync/signInWith.ts';
import { useSyncState } from '../sync/syncContext.ts';
import {
  rememberDeleted,
  useAccountApi,
  useStartOverOffer,
  waysBack,
  type WayBack,
} from './deleteAccount.ts';
import { Section, SettingRow } from './settingsLayout.tsx';
import { SignInAgain, type SignInAgainText } from './SignInAgain.tsx';
import { StartOverDialog } from './StartOverDialog.tsx';

const BLOCKED = {
  last_super_admin: 'deleteAccount.lastSuperAdmin',
  not_while_impersonating: 'deleteAccount.viewingAs',
  no_sign_in: 'deleteAccount.noSignIn',
} as const;

const SIGN_IN_TEXT: SignInAgainText = {
  signInAgain: 'deleteAccount.signInAgain',
  stillNotRecent: 'deleteAccount.stillNotRecent',
  useBrowser: 'deleteAccount.useBrowser',
  noWayBack: 'deleteAccount.noWayBack',
};

/** Which dialog is open: they come back to it from a fresh sign-in (`?delete=1`, `?startover=1`). */
type Open = 'delete' | 'startover' | null;

/**
 * Settings > Account, last: "Start over or delete your account" (PL-147), in every frontend.
 *
 * - Start over erases the person's own tasks, lists, tags and comments and keeps the account.
 * - Delete my account (the Play account deletion policy) is the same delete as an admin's, with
 *   the server's grace period and an admin's restore. Afterwards they are signed out, and the
 *   sign-in page says what happened.
 *
 * Both ask for fresh proof that it is the person: their password, or a sign-in in the last 10
 * minutes. Each shows only on a server that offers it.
 */
export function AccountEndSection() {
  const api = useAccountApi();
  const signOut = useSyncState((state) => state.signOut);
  const { shell, info } = useShellInfo();
  const [params, setParams] = useSearchParams();
  const [deletion, setDeletion] = useState<AccountDeletion | null>(null);
  const startOver = useStartOverOffer(api);
  const [open, setOpen] = useState<Open>(null);
  const [done, setDone] = useState<{ handedOn: number } | null>(null);

  useEffect(() => {
    if (!api?.deletion) return;
    let live = true;
    api.deletion().then(
      (answer) => {
        if (!live) return;
        setDeletion(answer);
        // Back from signing in again: straight on with it.
        if (answer && params.get('delete') === '1') setOpen('delete');
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
    // Asked once per visit; the dialog asks again when it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  // Back from signing in again for Start over: straight on with it (closing drops the `?startover=1`).
  const showing: Open = open ?? (startOver && params.get('startover') === '1' ? 'startover' : null);

  const offersDelete = Boolean(api?.deletion && api.deleteAccount && deletion);
  const offersStartOver = Boolean(api?.startOver && startOver);
  if (!offersDelete && !offersStartOver) return null;
  // The Android app needs a shell that takes a fresh sign-in through to its browser tab.
  const appCanSignIn = !shell || (info !== null && info.api >= PLAY_API);
  const close = () => {
    setOpen(null);
    if (params.has('delete') || params.has('startover')) {
      params.delete('delete');
      params.delete('startover');
      setParams(params, { replace: true });
    }
  };

  return (
    <Section title={t('accountEnd.title')}>
      {offersStartOver && (
        <SettingRow label={t('startOver.title')} hint={t('startOver.hint')}>
          <Button
            variant="outlined"
            color="error"
            onClick={() => {
              setDone(null);
              setOpen('startover');
            }}
          >
            {t('startOver.open')}
          </Button>
        </SettingRow>
      )}
      {done && (
        <Alert severity="success" variant="outlined" sx={{ my: 1.5 }} onClose={() => setDone(null)}>
          {t('startOver.done')}
          {done.handedOn === 1 && ` ${t('startOver.handedOne')}`}
          {done.handedOn > 1 && ` ${t('startOver.handedMany', { count: done.handedOn })}`}
        </Alert>
      )}
      {offersDelete && (
        <SettingRow label={t('deleteAccount.title')} hint={t('deleteAccount.hint')}>
          <Button variant="outlined" color="error" onClick={() => setOpen('delete')}>
            {t('deleteAccount.open')}
          </Button>
        </SettingRow>
      )}
      {showing === 'startover' && (
        <StartOverDialog
          appCanSignIn={appCanSignIn}
          returned={params.get('startover') === '1'}
          onClose={close}
          onDone={(handedOn) => {
            close();
            setDone({ handedOn });
          }}
        />
      )}
      {showing === 'delete' && (
        <DeleteDialog
          appCanSignIn={appCanSignIn}
          returned={params.get('delete') === '1'}
          onClose={close}
          onDeleted={async (removedAt, graceDays) => {
            // Never straight back through the provider of an account that is gone.
            rememberProvider(null);
            rememberDeleted(removedAt, graceDays);
            // The server has ended the session already; this forgets the device's copy.
            await signOut({ discard: true });
          }}
        />
      )}
    </Section>
  );
}

function DeleteDialog({
  appCanSignIn,
  returned,
  onClose,
  onDeleted,
}: {
  appCanSignIn: boolean;
  /** Just back from signing in again for this. */
  returned: boolean;
  onClose: () => void;
  onDeleted: (removedAt: string, graceDays: number) => Promise<void>;
}) {
  const api = useSyncState((state) => state.transport.account);
  const [deletion, setDeletion] = useState<AccountDeletion | null>(null);
  const [ways, setWays] = useState<WayBack[] | null>(null);
  const [password, setPassword] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [needSignIn, setNeedSignIn] = useState(false);
  const [busy, setBusy] = useState(false);

  // Asked afresh on opening: the sign-in may have just become recent, or stopped being.
  useEffect(() => {
    let live = true;
    void (async () => {
      const answer = await api?.deletion?.();
      if (!live || !answer) return;
      setDeletion(answer);
      if (answer.proof !== 'sign-in' || answer.blocked) return;
      setNeedSignIn(!answer.signedInRecently);
      const found = await waysBack(api, 'delete');
      if (live) setWays(found);
    })().catch(() => undefined);
    return () => {
      live = false;
    };
  }, [api]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!deletion || !api?.deleteAccount) return;
    setBusy(true);
    setProblem(null);
    try {
      const outcome = await api.deleteAccount(deletion.proof === 'password' ? password : undefined);
      if (outcome.kind === 'deleted' || outcome.kind === 'gone') {
        await onDeleted(outcome.kind === 'deleted' ? outcome.removedAt : '', deletion.graceDays);
        return;
      }
      if (outcome.kind === 'wrong-password') setProblem(t('deleteAccount.wrongPassword'));
      else if (outcome.kind === 'locked') setProblem(lockedProblem(outcome.until));
      else if (outcome.kind === 'sign-in-again') setNeedSignIn(true);
      else if (outcome.kind === 'last-super-admin')
        setDeletion({ ...deletion, blocked: 'last_super_admin' });
      else if (outcome.kind === 'too-many') setProblem(t('deleteAccount.tooMany'));
      else {
        // Refused from here (viewing as someone, no sign-in): the server says which.
        const now = await api.deletion?.();
        if (now) setDeletion(now);
      }
    } catch (error) {
      setProblem(messageOf(error));
    } finally {
      setBusy(false);
    }
  };

  const blocked = deletion?.blocked ?? null;
  const signInFirst = deletion?.proof === 'sign-in' && needSignIn;
  const canDelete = deletion !== null && !blocked && !signInFirst;
  const what =
    deletion === null
      ? null
      : deletion.graceDays === 0
        ? t('deleteAccount.whatNow')
        : deletion.graceDays === 1
          ? t('deleteAccount.whatGraceOne')
          : t('deleteAccount.whatGrace', { days: deletion.graceDays });

  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="xs" fullWidth>
      <Box component="form" onSubmit={(event) => void submit(event)}>
        <DialogTitle>{t('deleteAccount.dialog')}</DialogTitle>
        <DialogContent sx={{ display: 'grid', gap: 2 }}>
          {blocked ? (
            <Alert severity="info" variant="outlined">
              {t(BLOCKED[blocked])}
            </Alert>
          ) : (
            what && (
              <>
                <DialogContentText>{what}</DialogContentText>
                <DialogContentText>{t('deleteAccount.shared')}</DialogContentText>
              </>
            )
          )}
          {canDelete && deletion.proof === 'password' && (
            <PasswordField
              label={t('deleteAccount.password')}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
              autoFocus
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
          {canDelete && (
            <Button
              type="submit"
              color="error"
              variant="contained"
              disableElevation
              disabled={busy || (deletion.proof === 'password' && password === '')}
            >
              {busy ? t('deleteAccount.deleting') : t('deleteAccount.confirm')}
            </Button>
          )}
        </DialogActions>
      </Box>
    </Dialog>
  );
}
