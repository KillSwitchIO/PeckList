import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  MenuItem,
  TextField,
} from '@mui/material';
import { useState } from 'react';
import type { AdminApi, AdminResult, OidcOverview } from '../../ports/admin.ts';
import { t } from '../i18n/i18n.ts';
import { refusalText } from './useAdmin.ts';

type Accounts = OidcOverview['accounts'];

function AccountPicker({
  accounts,
  value,
  onChange,
  label,
  exclude,
}: {
  accounts: Accounts;
  value: string;
  onChange: (id: string) => void;
  label: string;
  exclude?: string;
}) {
  return (
    <TextField
      select
      label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      {accounts
        .filter((each) => each.id !== exclude)
        .map((each) => (
          <MenuItem key={each.id} value={each.id}>
            {each.username}
          </MenuItem>
        ))}
    </TextField>
  );
}

/** One dialog's shell: title, text, fields, a refusal, and the action. */
function OidcDialog<T>({
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
  ready: boolean;
  run: () => Promise<AdminResult<T>>;
  onDone: (value: T) => void;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
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
      <DialogTitle>{title}</DialogTitle>
      <DialogContent sx={{ display: 'grid', gap: 2 }}>
        <DialogContentText>{text}</DialogContentText>
        {children}
        {problem && (
          <Alert severity="error" variant="outlined">
            {problem}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('admin.cancel')}</Button>
        <Button
          variant="contained"
          disableElevation
          disabled={!ready || busy}
          onClick={() => void submit()}
        >
          {action}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** Map a provider username to an account (spec: Linking, user mapping). */
export function MapDialog({
  api,
  overview,
  account,
  onClose,
  onDone,
}: {
  api: AdminApi;
  overview: OidcOverview;
  /** Mapping onto this account: it starts chosen. */
  account?: string | undefined;
  onClose: () => void;
  onDone: () => void;
}) {
  const [provider, setProvider] = useState(overview.providers[0]?.name ?? '');
  const [username, setUsername] = useState('');
  const [target, setTarget] = useState(account ?? '');
  return (
    <OidcDialog
      title={t('admin.map.title')}
      text={t('admin.map.text')}
      action={t('admin.map.save')}
      ready={provider !== '' && username.trim() !== '' && target !== ''}
      run={() => api.saveMapping(provider, username.trim(), target)}
      onDone={onDone}
      onClose={onClose}
    >
      {overview.providers.length > 1 && (
        <TextField
          select
          label={t('admin.link.provider')}
          value={provider}
          onChange={(event) => setProvider(event.target.value)}
        >
          {overview.providers.map((each) => (
            <MenuItem key={each.name} value={each.name}>
              {each.displayName}
            </MenuItem>
          ))}
        </TextField>
      )}
      <TextField
        label={t('admin.map.providerUsername')}
        value={username}
        onChange={(event) => setUsername(event.target.value)}
        slotProps={{ htmlInput: { spellCheck: false, autoCapitalize: 'none' } }}
        autoFocus
      />
      <AccountPicker
        accounts={overview.accounts}
        value={target}
        onChange={setTarget}
        label={t('admin.map.account')}
      />
    </OidcDialog>
  );
}

/** Remap: a linked provider account signs into another account from now on. */
export function MoveDialog({
  api,
  overview,
  move,
  onClose,
  onDone,
}: {
  api: AdminApi;
  overview: OidcOverview;
  move: {
    provider: string;
    subject: string;
    label: string;
    from: { id: string; username: string };
  };
  onClose: () => void;
  onDone: (stranded: string[]) => void;
}) {
  const [target, setTarget] = useState('');
  return (
    <OidcDialog
      title={t('admin.move.title', { identity: move.label })}
      text={t('admin.move.text', { name: move.from.username })}
      action={t('admin.signIn.move')}
      ready={target !== ''}
      run={() => api.moveIdentity(move.provider, move.subject, target)}
      onDone={(value) => onDone(value.stranded)}
      onClose={onClose}
    >
      <AccountPicker
        accounts={overview.accounts}
        value={target}
        onChange={setTarget}
        label={t('admin.map.account')}
        exclude={move.from.id}
      />
    </OidcDialog>
  );
}
