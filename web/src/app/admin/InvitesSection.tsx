import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  MenuItem,
  TextField,
  Typography,
} from '@mui/material';
import { useState, type FormEvent } from 'react';
import type { AdminApi, AdminInvite, InviteList } from '../../ports/admin.ts';
import { t } from '../i18n/i18n.ts';
import { ProblemAlert } from '../layout/ProblemAlert.tsx';
import { CloseIcon } from '../icons/icons.tsx';
import { describeInvite } from './inviteText.ts';
import { refusalText } from './useAdmin.ts';

const LIFETIMES = [1, 7, 30] as const;
const USES = [1, 5, 25, null] as const;

/**
 * Make an invite link (spec: Registration, "Admin invites with expiry"). The link is shown once,
 * with Copy, by the caller.
 */
export function InviteDialog({
  api,
  open,
  registration,
  onClose,
  onCreated,
}: {
  api: AdminApi;
  open: boolean;
  registration: InviteList['registration'] | undefined;
  onClose: () => void;
  onCreated: (
    url: string,
    invite: AdminInvite,
    mailed?: { to: string; sent: boolean; problem?: string | null },
  ) => void;
}) {
  const [note, setNote] = useState('');
  const [sendTo, setSendTo] = useState('');
  const [days, setDays] = useState<number>(7);
  const [uses, setUses] = useState<number | null>(1);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const closed = registration === 'closed';
  const close = () => {
    setNote('');
    setSendTo('');
    setDays(7);
    setUses(1);
    setProblem(null);
    onClose();
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const to = sendTo.trim();
      const result = await api.createInvite({
        days,
        uses,
        note: note.trim(),
        ...(to ? { sendTo: to } : {}),
      });
      if (!result.ok) {
        setProblem(refusalText(result.reason));
        return;
      }
      close();
      onCreated(
        result.value.url,
        result.value.invite,
        to
          ? { to, sent: result.value.sent === true, problem: result.value.mailProblem ?? null }
          : undefined,
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onClose={close} maxWidth="xs" fullWidth>
      <Box component="form" onSubmit={(event) => void submit(event)}>
        <DialogTitle>{t('admin.invites.new')}</DialogTitle>
        <DialogContent sx={{ display: 'grid', gap: 2, pt: '8px !important' }}>
          {closed ? (
            <Alert severity="info" variant="outlined">
              {t('admin.invites.closed')}
            </Alert>
          ) : (
            <Typography variant="body2" color="text.secondary">
              {t(registration === 'open' ? 'admin.invites.hintOpen' : 'admin.invites.hint')}
            </Typography>
          )}
          <TextField
            label={t('admin.invites.note')}
            placeholder={t('admin.invites.notePlaceholder')}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            disabled={closed}
            autoFocus={!closed}
            slotProps={{ htmlInput: { maxLength: 100 } }}
          />
          <TextField
            type="email"
            label={t('admin.invites.sendTo')}
            helperText={t('admin.invites.sendToHint')}
            value={sendTo}
            onChange={(event) => setSendTo(event.target.value)}
            disabled={closed}
            slotProps={{ htmlInput: { maxLength: 254 } }}
          />
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
            <TextField
              select
              label={t('admin.invites.expires')}
              value={days}
              disabled={closed}
              onChange={(event) => setDays(Number(event.target.value))}
            >
              {LIFETIMES.map((each) => (
                <MenuItem key={each} value={each}>
                  {t('admin.invites.days', { count: each })}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label={t('admin.invites.uses')}
              value={uses ?? 'any'}
              disabled={closed}
              onChange={(event) =>
                setUses(event.target.value === 'any' ? null : Number(event.target.value))
              }
            >
              {USES.map((each) => (
                <MenuItem key={each ?? 'any'} value={each ?? 'any'}>
                  {each === null
                    ? t('admin.invites.anyNumber')
                    : t(each === 1 ? 'admin.invites.onePerson' : 'admin.invites.people', {
                        count: each,
                      })}
                </MenuItem>
              ))}
            </TextField>
          </Box>
          <ProblemAlert problem={problem} />
        </DialogContent>
        <DialogActions>
          <Button onClick={close}>{t('admin.cancel')}</Button>
          <Button type="submit" variant="contained" disableElevation disabled={closed || busy}>
            {t('admin.invites.create')}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}

/** Invite links that still work, under the people, each with Withdraw. Nothing when there are none. */
export function InvitesList({
  invites,
  onRevoke,
}: {
  invites: AdminInvite[];
  onRevoke: (invite: AdminInvite) => void;
}) {
  if (invites.length === 0) return null;
  return (
    <Box component="section" aria-label={t('admin.invites.title')} sx={{ mt: 3 }}>
      <Typography variant="overline" color="text.secondary">
        {t('admin.invites.title')}
      </Typography>
      <Box role="list" aria-label={t('admin.invites.title')}>
        {invites.map((invite) => {
          const name = invite.note ?? t('admin.invites.unnamed');
          return (
            <Box
              key={invite.id}
              role="listitem"
              aria-label={name}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1.5,
                mx: -1,
                px: 1,
                py: 1,
                borderRadius: 2,
                '&:hover': { bgcolor: 'action.hover' },
              }}
            >
              <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                <Typography noWrap>{name}</Typography>
                <Typography variant="caption" color="text.secondary" noWrap component="div">
                  {describeInvite(invite)}
                </Typography>
              </Box>
              <IconButton
                size="small"
                aria-label={t('admin.invites.revoke', { name })}
                title={t('admin.invites.revoke', { name })}
                onClick={() => onRevoke(invite)}
              >
                <CloseIcon fontSize="small" />
              </IconButton>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
