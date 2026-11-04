import KeyRounded from '@mui/icons-material/KeyRounded';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
} from '@mui/material';
import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { messageOf } from '../../core/errors.ts';
import type { PasskeyInfo, PasskeyList } from '../../ports/sync.ts';
import { t } from '../i18n/i18n.ts';
import { PasswordField } from '../layout/PasswordField.tsx';
import { ProblemAlert } from '../layout/ProblemAlert.tsx';
import { nativeShell } from '../native/shell.ts';
import { useSyncState } from '../sync/syncContext.ts';
import { cancelled, createPasskey, passkeysWork } from '../sync/webauthn.ts';
import { Section, SettingRow } from './settingsLayout.tsx';

function day(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function hintOf(passkey: PasskeyInfo): string {
  const parts = [t('settings.passkeys.added', { date: day(passkey.createdAt) })];
  if (passkey.lastUsedAt)
    parts.push(t('settings.passkeys.used', { date: day(passkey.lastUsedAt) }));
  if (passkey.synced) parts.push(t('settings.passkeys.synced'));
  return parts.join(' · ');
}

/**
 * Passkeys on this account (PL-123): add, rename and remove them, and do without the password once
 * there is one. In the Android app, adding goes through a browser tab (the WebView has no
 * WebAuthn) and comes back to `/settings?link=passkey_added`.
 */
export function PasskeysSection() {
  const transport = useSyncState((state) => state.transport);
  const hasAccounts = useSyncState(
    (state) => state.phase === 'ready' && state.account?.authMode === 'local',
  );
  const api = hasAccounts ? transport.account : undefined;
  const [list, setList] = useState<PasskeyList | null>(null);
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<PasskeyInfo | null>(null);
  const [removingPassword, setRemovingPassword] = useState(false);
  const [params] = useSearchParams();
  const [added, setAdded] = useState(() => params.get('link') === 'passkey_added');
  const native = nativeShell() !== null;

  useEffect(() => {
    if (!api?.passkeys) return;
    let live = true;
    api.passkeys().then(
      (answer) => live && setList(answer),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [api, version]);

  if (!api?.passkeys || !list) return null;
  if (!list.available && list.passkeys.length === 0) return null;
  const canAdd = list.available && (native || passkeysWork());

  const add = async () => {
    if (!api.passkeyOptions || !api.addPasskey) return;
    setBusy(true);
    setProblem(null);
    setAdded(false);
    try {
      const started = await api.passkeyOptions();
      const credential = await createPasskey(started.options);
      const result = await api.addPasskey(started.ceremony, credential, '');
      if (result === 'invalid') setProblem(t('settings.passkeys.invalid'));
      else {
        setAdded(true);
        setRenaming(result);
      }
      setVersion((each) => each + 1);
    } catch (error) {
      if (!cancelled(error)) setProblem(messageOf(error));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (passkey: PasskeyInfo) => {
    if (!api.removePasskey) return;
    setProblem(null);
    if ((await api.removePasskey(passkey.id)) === 'last-way-in') {
      setProblem(t('settings.signIn.lastWayIn'));
    }
    setVersion((each) => each + 1);
  };

  const addButton = canAdd && (
    <Button
      size="small"
      variant="outlined"
      startIcon={<KeyRounded />}
      disabled={busy}
      {...(native ? { href: '/auth/oidc/passkey/link' } : { onClick: () => void add() })}
    >
      {t('settings.passkeys.add')}
    </Button>
  );

  return (
    <Section title={t('settings.passkeys')} hint={t('settings.passkeys.hint')} action={addButton}>
      {added && (
        <Alert severity="success" variant="outlined" sx={{ mb: 1 }} onClose={() => setAdded(false)}>
          {t('settings.passkeys.done')}
        </Alert>
      )}
      <ProblemAlert problem={problem} sx={{ mb: 1 }} />
      {list.passkeys.length === 0 && (
        <SettingRow label={t('settings.passkeys.none')} hint={t('settings.passkeys.noneHint')} />
      )}
      {list.passkeys.map((passkey) => (
        <SettingRow key={passkey.id} label={passkey.name} hint={hintOf(passkey)}>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button
              size="small"
              aria-label={t('settings.passkeys.renameNamed', { name: passkey.name })}
              onClick={() => setRenaming(passkey)}
            >
              {t('settings.passkeys.rename')}
            </Button>
            <Button
              size="small"
              aria-label={t('settings.passkeys.removeNamed', { name: passkey.name })}
              onClick={() => void remove(passkey)}
            >
              {t('settings.passkeys.remove')}
            </Button>
          </Box>
        </SettingRow>
      ))}
      {list.password && list.passkeys.length > 0 && api.removePassword && (
        <SettingRow
          label={t('settings.passkeys.password')}
          hint={t('settings.passkeys.passwordHint')}
        >
          <Button size="small" onClick={() => setRemovingPassword(true)}>
            {t('settings.passkeys.removePassword')}
          </Button>
        </SettingRow>
      )}
      {renaming && (
        <RenameDialog
          passkey={renaming}
          onClose={() => setRenaming(null)}
          onSave={async (name) => {
            await api.renamePasskey?.(renaming.id, name);
            setRenaming(null);
            setVersion((each) => each + 1);
          }}
        />
      )}
      {removingPassword && (
        <RemovePasswordDialog
          onClose={() => setRemovingPassword(false)}
          onRemove={async (current) => (await api.removePassword?.(current)) ?? 'ok'}
          onDone={() => {
            setRemovingPassword(false);
            setVersion((each) => each + 1);
          }}
        />
      )}
    </Section>
  );
}

function RenameDialog({
  passkey,
  onClose,
  onSave,
}: {
  passkey: PasskeyInfo;
  onClose: () => void;
  onSave: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(passkey.name);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void onSave(name.trim());
  };
  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <Box component="form" onSubmit={submit}>
        <DialogTitle>{t('settings.passkeys.nameTitle')}</DialogTitle>
        <DialogContent sx={{ pt: '8px !important' }}>
          <TextField
            label={t('settings.passkeys.name')}
            placeholder={t('settings.passkeys.namePlaceholder')}
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoFocus
            fullWidth
            slotProps={{ htmlInput: { maxLength: 60 } }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>{t('settings.email.cancel')}</Button>
          <Button type="submit" variant="contained" disableElevation>
            {t('settings.email.save')}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}

function RemovePasswordDialog({
  onClose,
  onRemove,
  onDone,
}: {
  onClose: () => void;
  onRemove: (current: string) => Promise<'ok' | 'wrong-password' | 'last-way-in'>;
  onDone: () => void;
}) {
  const [current, setCurrent] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      const answer = await onRemove(current);
      if (answer === 'ok') onDone();
      else
        setProblem(
          t(
            answer === 'wrong-password'
              ? 'settings.passkeys.wrongPassword'
              : 'settings.signIn.lastWayIn',
          ),
        );
    } catch (error) {
      setProblem(messageOf(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <Box component="form" onSubmit={(event) => void submit(event)}>
        <DialogTitle>{t('settings.passkeys.removePasswordTitle')}</DialogTitle>
        <DialogContent sx={{ display: 'grid', gap: 2, pt: '8px !important' }}>
          {t('settings.passkeys.removePasswordText')}
          <PasswordField
            label={t('settings.passkeys.currentPassword')}
            value={current}
            onChange={(event) => setCurrent(event.target.value)}
            autoComplete="current-password"
            autoFocus
            required
          />
          <ProblemAlert problem={problem} />
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>{t('settings.email.cancel')}</Button>
          <Button type="submit" variant="contained" color="error" disableElevation disabled={busy}>
            {t('settings.passkeys.removePassword')}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}
