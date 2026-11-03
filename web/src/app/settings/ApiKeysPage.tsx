import AddRounded from '@mui/icons-material/AddRounded';
import ContentCopyRounded from '@mui/icons-material/ContentCopyRounded';
import KeyRounded from '@mui/icons-material/KeyRounded';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useCallback, useEffect, useState } from 'react';
import { addDays, localDayOf, localTimeZone } from '../../core/dates.ts';
import type { ApiKeyInfo, ApiScope } from '../../ports/sync.ts';
import { formatDay } from '../format.ts';
import { useToday } from '../hooks/useToday.ts';
import { t } from '../i18n/i18n.ts';
import { DeleteIcon } from '../icons/icons.tsx';
import { Page } from '../layout/Page.tsx';
import { ConfirmDialog } from '../lists/ListDialog.tsx';
import { useSyncState } from '../sync/syncContext.ts';
import { EmptyState } from '../views/EmptyState.tsx';
import { Section } from './settingsLayout.tsx';

/** The permissions offered, in order; `admin` only to admins. */
const SCOPES: ApiScope[] = [
  'tasks:read',
  'tasks:write',
  'files:read',
  'files:write',
  'notifications',
  'admin',
];

/** Writing brings reading with it, as the server has it. */
const NEEDS: Partial<Record<ApiScope, ApiScope>> = {
  'tasks:write': 'tasks:read',
  'files:write': 'files:read',
};

const EXPIRY_CHOICES = ['never', '7', '30', '90', '365', 'date'] as const;
type Expiry = (typeof EXPIRY_CHOICES)[number];

/** The end of a local day, as an instant. */
function endOf(day: string): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d, 23, 59, 59).toISOString();
}

function NewKeyDialog({
  admin,
  onClose,
  onMade,
}: {
  admin: boolean;
  onClose: () => void;
  onMade: (made: { key: ApiKeyInfo; token: string }) => void;
}) {
  const api = useSyncState((state) => state.transport.apiKeys);
  const today = useToday();
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<Set<ApiScope>>(new Set(['tasks:read']));
  const [expiry, setExpiry] = useState<Expiry>('90');
  const [date, setDate] = useState(addDays(today, 30));
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toggle = (scope: ApiScope, on: boolean) =>
    setScopes((before) => {
      const next = new Set(before);
      if (on) {
        next.add(scope);
        if (NEEDS[scope]) next.add(NEEDS[scope]);
      } else {
        next.delete(scope);
        // Reading goes, writing goes with it.
        for (const [writes, reads] of Object.entries(NEEDS)) {
          if (reads === scope) next.delete(writes as ApiScope);
        }
      }
      return next;
    });
  const expiresAt =
    expiry === 'never'
      ? null
      : expiry === 'date'
        ? endOf(date)
        : endOf(addDays(today, Number(expiry)));
  const valid = name.trim().length > 0 && scopes.size > 0 && (expiry !== 'date' || date > today);

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!api || !valid || busy) return;
          setBusy(true);
          void api
            .create({ name: name.trim(), scopes: SCOPES.filter((s) => scopes.has(s)), expiresAt })
            .then(
              (answer) => ('problem' in answer ? setProblem(answer.problem) : onMade(answer)),
              () => setProblem(t('apiKeys.failed')),
            )
            .finally(() => setBusy(false));
        }}
      >
        <DialogTitle>{t('apiKeys.new')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {problem && <Alert severity="error">{problem}</Alert>}
            <TextField
              autoFocus
              label={t('apiKeys.name')}
              placeholder={t('apiKeys.namePlaceholder')}
              value={name}
              onChange={(event) => setName(event.target.value)}
              slotProps={{ htmlInput: { maxLength: 80 } }}
            />
            <Stack direction="row" spacing={1}>
              <TextField
                select
                label={t('apiKeys.expires')}
                value={expiry}
                onChange={(event) => setExpiry(event.target.value as Expiry)}
                sx={{ flex: 1 }}
              >
                {EXPIRY_CHOICES.map((choice) => (
                  <MenuItem key={choice} value={choice}>
                    {t(`apiKeys.expiry.${choice}`)}
                  </MenuItem>
                ))}
              </TextField>
              {expiry === 'date' && (
                <TextField
                  type="date"
                  label={t('apiKeys.expiryDate')}
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                  slotProps={{
                    htmlInput: { min: addDays(today, 1) },
                    inputLabel: { shrink: true },
                  }}
                  sx={{ flex: 1 }}
                />
              )}
            </Stack>
            <Box role="group" aria-label={t('apiKeys.permissions')}>
              <Typography variant="subtitle2" color="text.secondary">
                {t('apiKeys.permissions')}
              </Typography>
              {SCOPES.filter((scope) => scope !== 'admin' || admin).map((scope) => (
                <FormControlLabel
                  key={scope}
                  sx={{ display: 'flex', alignItems: 'flex-start', mt: 0.5 }}
                  control={
                    <Checkbox
                      size="small"
                      checked={scopes.has(scope)}
                      onChange={(event) => toggle(scope, event.target.checked)}
                      sx={{ pt: 0.25 }}
                    />
                  }
                  label={
                    <Box>
                      <Typography variant="body2">{t(`apiKeys.scope.${scope}`)}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {t(`apiKeys.scopeHint.${scope}`)}
                      </Typography>
                    </Box>
                  }
                />
              ))}
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="contained" disabled={!valid || busy}>
            {t('apiKeys.create')}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

/** The token, once: copy it now. */
function TokenDialog({ token, onClose }: { token: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{t('apiKeys.madeTitle')}</DialogTitle>
      <DialogContent>
        <Alert severity="warning" sx={{ mb: 2 }}>
          {t('apiKeys.copyNow')}
        </Alert>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <TextField
            fullWidth
            value={token}
            slotProps={{
              htmlInput: {
                readOnly: true,
                'aria-label': t('apiKeys.token'),
                style: { fontFamily: 'monospace', fontSize: 13 },
              },
            }}
            onFocus={(event) => event.target.select()}
          />
          <Tooltip title={copied ? t('apiKeys.copied') : t('apiKeys.copy')}>
            <IconButton
              aria-label={t('apiKeys.copy')}
              onClick={() =>
                void navigator.clipboard?.writeText(token).then(
                  () => setCopied(true),
                  () => undefined,
                )
              }
            >
              <ContentCopyRounded />
            </IconButton>
          </Tooltip>
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
          {t('apiKeys.howToUse')}
        </Typography>
        <Box
          component="pre"
          sx={{
            mt: 1,
            p: 1,
            bgcolor: 'action.hover',
            borderRadius: 1,
            fontSize: 12,
            overflowX: 'auto',
          }}
        >
          Authorization: Bearer {token.slice(0, 12)}…
        </Box>
      </DialogContent>
      <DialogActions>
        <Button variant="contained" onClick={onClose}>
          {t('common.done')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/**
 * API keys (R-FB-157): let scripts and other apps use PeckList as you, with only what you allow,
 * for as long as you choose. Each has a name, its permissions, when it was made, when it stops
 * working and when it was last used; revoking one ends it at once.
 */
export function ApiKeysPage() {
  const api = useSyncState((state) => state.transport.apiKeys);
  const phase = useSyncState((state) => state.phase);
  const role = useSyncState((state) => state.account?.role);
  const local = useSyncState((state) => state.account?.authMode === 'local');
  const today = useToday();
  const [keys, setKeys] = useState<ApiKeyInfo[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [made, setMade] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<ApiKeyInfo | null>(null);
  const [failed, setFailed] = useState(false);
  // When the list came: what has expired is judged against it.
  const [now, setNow] = useState(0);

  const load = useCallback(() => {
    if (!api) return;
    api.list().then(
      (list) => {
        setKeys(list);
        setNow(Date.now());
        setFailed(false);
      },
      () => setFailed(true),
    );
  }, [api]);
  useEffect(() => {
    if (phase === 'ready') load();
  }, [phase, load]);

  if (!api || !local) {
    return (
      <Page title={t('apiKeys.title')}>
        <EmptyState title={t('apiKeys.needsServer')} icon={<KeyRounded />} />
      </Page>
    );
  }
  const day = (iso: string) => formatDay(localDayOf(iso, localTimeZone()), today);
  const stateOf = (key: ApiKeyInfo) =>
    key.revokedAt
      ? t('apiKeys.revokedOn', { date: day(key.revokedAt) })
      : key.expiresAt && Date.parse(key.expiresAt) <= now
        ? t('apiKeys.expiredOn', { date: day(key.expiresAt) })
        : key.expiresAt
          ? t('apiKeys.expiresOn', { date: day(key.expiresAt) })
          : t('apiKeys.neverExpires');
  const works = (key: ApiKeyInfo) =>
    !key.revokedAt && (!key.expiresAt || Date.parse(key.expiresAt) > now);

  return (
    <Page title={t('apiKeys.title')}>
      <Section
        title={t('apiKeys.title')}
        hint={t('apiKeys.hint')}
        action={
          <Button size="small" startIcon={<AddRounded />} onClick={() => setCreating(true)}>
            {t('apiKeys.new')}
          </Button>
        }
      >
        {failed && <Alert severity="error">{t('apiKeys.failed')}</Alert>}
        {keys && keys.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ px: 1, py: 1 }}>
            {t('apiKeys.none')}
          </Typography>
        )}
        <Box component="ul" aria-label={t('apiKeys.title')} sx={{ listStyle: 'none', m: 0, p: 0 }}>
          {keys?.map((key) => (
            <Box
              component="li"
              key={key.id}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                py: 1,
                px: 1,
                borderBottom: 1,
                borderColor: 'divider',
                opacity: works(key) ? 1 : 0.55,
              }}
            >
              <KeyRounded fontSize="small" sx={{ color: 'text.secondary' }} />
              <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                <Typography noWrap>{key.name}</Typography>
                <Typography variant="caption" color="text.secondary" component="div">
                  {key.scopes.map((scope) => t(`apiKeys.scope.${scope}`)).join(', ')}
                </Typography>
                <Typography variant="caption" color="text.secondary" component="div">
                  {[
                    t('apiKeys.createdOn', { date: day(key.createdAt) }),
                    stateOf(key),
                    key.lastUsedAt
                      ? t('apiKeys.lastUsed', { date: day(key.lastUsedAt) })
                      : t('apiKeys.neverUsed'),
                  ].join(' · ')}
                </Typography>
              </Box>
              {!key.revokedAt && (
                <Tooltip title={t('apiKeys.revoke')}>
                  <IconButton
                    aria-label={t('apiKeys.revokeNamed', { name: key.name })}
                    onClick={() => setRevoking(key)}
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
            </Box>
          ))}
        </Box>
      </Section>
      {creating && (
        <NewKeyDialog
          admin={role !== undefined && role !== 'user'}
          onClose={() => setCreating(false)}
          onMade={(answer) => {
            setCreating(false);
            setMade(answer.token);
            load();
          }}
        />
      )}
      {made && <TokenDialog token={made} onClose={() => setMade(null)} />}
      {revoking && (
        <ConfirmDialog
          open
          message={t('apiKeys.revokeConfirm', { name: revoking.name })}
          confirmLabel={t('apiKeys.revoke')}
          onClose={() => setRevoking(null)}
          onConfirm={() => {
            const id = revoking.id;
            setRevoking(null);
            void api.revoke(id).then(load, () => setFailed(true));
          }}
        />
      )}
    </Page>
  );
}
