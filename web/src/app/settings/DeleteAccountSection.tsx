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
import { isPlayBuild, PLAY_API, useShellInfo } from '../native/shell.ts';
import { leaveFor, rememberProvider } from '../sync/signInWith.ts';
import { useSyncState } from '../sync/syncContext.ts';
import { freshSignInUrl, rememberDeleted } from './deleteAccount.ts';
import { Section, SettingRow } from './settingsLayout.tsx';

/** A way to sign in again before deleting, for an account without a password to type. */
interface WayBack {
  label: string;
  url: string;
}

const BLOCKED = {
  last_super_admin: 'deleteAccount.lastSuperAdmin',
  not_while_impersonating: 'deleteAccount.viewingAs',
  no_sign_in: 'deleteAccount.noSignIn',
} as const;

/**
 * Settings > Account > Delete my account (the Play account deletion policy): the same delete as an
 * admin's, with the server's grace period and an admin's restore, asked for with fresh proof that
 * it is the person (their password, or a sign-in in the last 10 minutes). Afterwards they are
 * signed out, and the sign-in page says what happened. Not on servers too old to offer it.
 *
 * 0.12.1 shows it in the Google Play build only (Play's account deletion policy), so browsers, the
 * PWA and the foss app stay exactly as in 0.12.0; everyone gets it from 0.13.0.
 */
export function DeleteAccountSection() {
  const { shell, info } = useShellInfo();
  const play = isPlayBuild(info);
  const api = useSyncState((state) =>
    state.phase === 'ready' && state.account?.authMode === 'local'
      ? state.transport.account
      : undefined,
  );
  const signOut = useSyncState((state) => state.signOut);
  const [params, setParams] = useSearchParams();
  const [offered, setOffered] = useState<AccountDeletion | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!play || !api?.deletion) return;
    let live = true;
    api.deletion().then(
      (answer) => {
        if (!live) return;
        setOffered(answer);
        // Back from signing in again: straight on with it.
        if (answer && params.get('delete') === '1') setOpen(true);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
    // Asked once per visit; the dialog asks again when it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, play]);

  if (!play || !api?.deletion || !api.deleteAccount || !offered) return null;
  // The Android app needs a shell that takes a fresh sign-in through to its browser tab.
  const appCanSignIn = !shell || (info !== null && info.api >= PLAY_API);
  return (
    <Section title={t('deleteAccount.title')}>
      <SettingRow label={t('deleteAccount.title')} hint={t('deleteAccount.hint')}>
        <Button variant="outlined" color="error" onClick={() => setOpen(true)}>
          {t('deleteAccount.open')}
        </Button>
      </SettingRow>
      {open && (
        <DeleteDialog
          appCanSignIn={appCanSignIn}
          returned={params.get('delete') === '1'}
          onClose={() => {
            setOpen(false);
            if (params.has('delete')) {
              params.delete('delete');
              setParams(params, { replace: true });
            }
          }}
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
      const [methods, keys] = await Promise.all([
        api?.signInMethods().catch(() => null),
        api?.passkeys?.().catch(() => null),
      ]);
      if (!live) return;
      const seen = new Set<string>();
      const found: WayBack[] = [];
      for (const each of methods?.identities ?? []) {
        if (seen.has(each.provider)) continue;
        seen.add(each.provider);
        found.push({
          label: t('deleteAccount.signInWith', { name: each.displayName }),
          url: freshSignInUrl(each.provider),
        });
      }
      if ((keys?.passkeys.length ?? 0) > 0) {
        found.push({ label: t('deleteAccount.signInPasskey'), url: freshSignInUrl('passkey') });
      }
      setWays(found);
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
            <SignInAgain ways={ways} appCanSignIn={appCanSignIn} returned={returned} />
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

/** For an account without a password: a real sign-in first, which comes back to this dialog. */
function SignInAgain({
  ways,
  appCanSignIn,
  returned,
}: {
  ways: WayBack[] | null;
  appCanSignIn: boolean;
  returned: boolean;
}) {
  if (!appCanSignIn) {
    return (
      <Alert severity="info" variant="outlined">
        {t('deleteAccount.useBrowser')}
      </Alert>
    );
  }
  if (ways === null) return null;
  if (ways.length === 0) {
    return (
      <Alert severity="info" variant="outlined">
        {t('deleteAccount.noWayBack')}
      </Alert>
    );
  }
  return (
    <Box sx={{ display: 'grid', gap: 1 }}>
      {/* Back from it and still not recent: the provider let them in without asking again. */}
      {returned && (
        <Alert severity="warning" variant="outlined">
          {t('deleteAccount.stillNotRecent')}
        </Alert>
      )}
      <DialogContentText>{t('deleteAccount.signInAgain')}</DialogContentText>
      {ways.map((way) => (
        <Button key={way.url} variant="outlined" onClick={() => leaveFor(way.url)}>
          {way.label}
        </Button>
      ))}
    </Box>
  );
}
