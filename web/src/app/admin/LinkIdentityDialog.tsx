import { MenuItem, TextField } from '@mui/material';
import { useState } from 'react';
import type { AdminApi, AdminUser, PendingSignIn } from '../../ports/admin.ts';
import { t } from '../i18n/i18n.ts';
import { ActionDialog } from './AdminDialogs.tsx';
import { useLoaded } from './useAdmin.ts';

/**
 * Attach a provider account to someone by hand (spec: Linking): to a person, by the provider and
 * the account's subject; or a waiting sign-in, to the person it belongs to.
 */
export function LinkIdentityDialog({
  api,
  user,
  waiting,
  onClose,
  onLinked,
}: {
  api: AdminApi;
  /** Linking to this person: choose the provider and subject. */
  user?: AdminUser;
  /** Linking this waiting sign-in: choose the person. */
  waiting?: PendingSignIn;
  onClose: () => void;
  onLinked: (username: string) => void;
}) {
  const providers = useLoaded(api.providers);
  const users = useLoaded(api.users);
  const [provider, setProvider] = useState(waiting?.provider ?? '');
  const [subject, setSubject] = useState(waiting?.subject ?? '');
  const [person, setPerson] = useState(user?.id ?? '');
  const chosen = provider || providers.data?.[0]?.name || '';
  const target = user ?? (users.data ?? []).find((each) => each.id === person);

  return (
    <ActionDialog
      title={
        user
          ? t('admin.link.titleUser', { name: user.username })
          : t('admin.link.titleWaiting', { name: waiting?.username ?? '' })
      }
      text={user ? t('admin.link.textUser') : t('admin.link.textWaiting')}
      action={t('admin.link.link')}
      ready={!!target && !!chosen && subject.trim().length > 0}
      run={() => api.linkIdentity(target!.id, chosen, subject.trim())}
      onDone={() => onLinked(target!.username)}
      onClose={onClose}
    >
      {user ? (
        <>
          <TextField
            select
            label={t('admin.link.provider')}
            value={chosen}
            onChange={(event) => setProvider(event.target.value)}
          >
            {(providers.data ?? []).map((each) => (
              <MenuItem key={each.name} value={each.name}>
                {each.displayName}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label={t('admin.link.subject')}
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            helperText={t('admin.link.subjectHint')}
            slotProps={{ htmlInput: { spellCheck: false } }}
          />
        </>
      ) : (
        <TextField
          select
          label={t('admin.link.person')}
          value={person}
          onChange={(event) => setPerson(event.target.value)}
        >
          {(users.data ?? [])
            .filter((each) => !each.deletedAt)
            .map((each) => (
              <MenuItem key={each.id} value={each.id}>
                {each.username}
              </MenuItem>
            ))}
        </TextField>
      )}
    </ActionDialog>
  );
}
