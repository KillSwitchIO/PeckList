import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  MenuItem,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { useState, type FormEvent } from 'react';
import type { AdminApi, AdminGroup, AdminUser } from '../../ports/admin.ts';
import { t } from '../i18n/i18n.ts';
import { ProblemAlert } from '../layout/ProblemAlert.tsx';
import { CloseIcon, PlusIcon } from '../icons/icons.tsx';
import { ConfirmDialog } from './AdminDialogs.tsx';
import { refusalText, useLoaded } from './useAdmin.ts';

/** Why someone is in a group, as the admin reads it. */
function sourceText(sources: string[]): string {
  return sources
    .map((source) =>
      source === 'manual'
        ? t('admin.groups.byHand')
        : t('admin.groups.fromProvider', { provider: source.replace(/^oidc:/, '') }),
    )
    .join(' · ');
}

/** New group, or one opened from the list: name, sharing, members. */
function GroupDialog({
  api,
  group,
  users,
  open,
  onClose,
  onChanged,
}: {
  api: AdminApi;
  group: AdminGroup | null;
  users: AdminUser[];
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [name, setName] = useState(group?.name ?? '');
  const [offered, setOffered] = useState(group?.offeredForSharing ?? false);
  const [problem, setProblem] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    const result = group
      ? await api.updateGroup(group.id, { name: name.trim(), offeredForSharing: offered })
      : await api.addGroup(name.trim(), offered);
    if (!result.ok) {
      setProblem(refusalText(result.reason));
      return;
    }
    onChanged();
    onClose();
  };
  const nameOf = (id: string) => users.find((user) => user.id === id)?.username ?? id;
  const outside = users.filter(
    (user) => !group?.members.some((member) => member.accountId === user.id),
  );
  const member = async (accountId: string, joined: boolean) => {
    if (!group) return;
    await api.setMember(group.id, accountId, joined);
    onChanged();
  };
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <Box component="form" onSubmit={(event) => void save(event)}>
        <DialogTitle>{group ? group.name : t('admin.groups.new')}</DialogTitle>
        <DialogContent sx={{ display: 'grid', gap: 2, pt: '8px !important' }}>
          <TextField
            label={t('admin.groups.name')}
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoFocus={!group}
            required
          />
          <FormControlLabel
            control={
              <Switch checked={offered} onChange={(event) => setOffered(event.target.checked)} />
            }
            label={t('admin.groups.offered')}
          />
          <ProblemAlert problem={problem} />
          {group && (
            <Box>
              <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 0.5 }}>
                {t('admin.groups.members')}
              </Typography>
              {group.members.map((each) => (
                <Box key={each.accountId} sx={{ display: 'flex', alignItems: 'center', py: 0.5 }}>
                  <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                    <Typography noWrap>{nameOf(each.accountId)}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {sourceText(each.sources)}
                    </Typography>
                  </Box>
                  {each.sources.includes('manual') && (
                    <IconButton
                      size="small"
                      aria-label={t('admin.groups.remove', { name: nameOf(each.accountId) })}
                      onClick={() => void member(each.accountId, false)}
                    >
                      <CloseIcon fontSize="small" />
                    </IconButton>
                  )}
                </Box>
              ))}
              {outside.length > 0 && (
                <TextField
                  select
                  size="small"
                  fullWidth
                  label={t('admin.groups.addMember')}
                  value=""
                  onChange={(event) => void member(event.target.value, true)}
                  sx={{ mt: 1 }}
                >
                  {outside.map((user) => (
                    <MenuItem key={user.id} value={user.id}>
                      {user.username}
                    </MenuItem>
                  ))}
                </TextField>
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          {group && (
            <Button color="error" onClick={() => setDeleting(true)} sx={{ mr: 'auto' }}>
              {t('admin.groups.delete')}
            </Button>
          )}
          <Button onClick={onClose}>{t('admin.cancel')}</Button>
          <Button type="submit" variant="contained" disableElevation>
            {t('admin.save')}
          </Button>
        </DialogActions>
      </Box>
      <ConfirmDialog
        confirm={
          deleting && group
            ? {
                title: t('admin.groups.deleteTitle', { name: group.name }),
                text: t('admin.groups.deleteText'),
                action: t('admin.groups.delete'),
                run: () =>
                  void api.deleteGroup(group.id).then(() => {
                    onChanged();
                    onClose();
                  }),
              }
            : null
        }
        onClose={() => setDeleting(false)}
      />
    </Dialog>
  );
}

/** Admin > Groups: server groups (spec: Roles and server groups). */
export function GroupsTab({ api }: { api: AdminApi }) {
  const { data: groups, reload } = useLoaded(api.groups);
  const { data: users } = useLoaded(api.users);
  // The open group's id ('new' for a new one); the dialog reads the group fresh from the list.
  const [open, setOpen] = useState<string | null>(null);
  const current = groups?.find((group) => group.id === open) ?? null;
  return (
    <Box sx={{ maxWidth: 720 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
        <Typography variant="body2" color="text.secondary">
          {t('admin.groups.hint')}
        </Typography>
        <Button startIcon={<PlusIcon />} onClick={() => setOpen('new')} sx={{ flexShrink: 0 }}>
          {t('admin.groups.new')}
        </Button>
      </Box>
      <Box role="list" aria-label={t('admin.tab.groups')}>
        {(groups ?? []).map((group) => (
          <Box
            key={group.id}
            role="listitem"
            component="button"
            type="button"
            onClick={() => setOpen(group.id)}
            sx={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              border: 0,
              background: 'none',
              color: 'inherit',
              font: 'inherit',
              cursor: 'pointer',
              mx: -1,
              px: 1,
              py: 1,
              borderRadius: 2,
              '&:hover': { bgcolor: 'action.hover' },
            }}
          >
            <Typography>{group.name}</Typography>
            <Typography variant="caption" color="text.secondary">
              {[
                group.members.length === 1
                  ? t('admin.groups.countOne')
                  : t('admin.groups.count', { count: group.members.length }),
                ...(group.offeredForSharing ? [t('admin.groups.offeredShort')] : []),
              ].join(' · ')}
            </Typography>
          </Box>
        ))}
        {groups?.length === 0 && (
          <Typography color="text.secondary">{t('admin.groups.none')}</Typography>
        )}
      </Box>
      {open !== null && (
        <GroupDialog
          key={open}
          api={api}
          group={current}
          users={users ?? []}
          open
          onClose={() => setOpen(null)}
          onChanged={reload}
        />
      )}
    </Box>
  );
}
