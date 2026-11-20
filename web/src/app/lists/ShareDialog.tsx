import {
  Autocomplete,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  List as MuiList,
  ListItem,
  ListItemText,
  MenuItem,
  TextField,
  Tooltip,
  Typography,
  createFilterOptions,
} from '@mui/material';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { activeGroupsOf } from '../../core/groups.ts';
import {
  describePrincipal,
  friendsOf,
  listMembersOf,
  listOwner,
  makePrivate,
  nameOf,
  removeMember,
  roleOn,
  shareList,
  type Role,
} from '../../core/sharing.ts';
import type { List } from '../../core/types.ts';
import { Avatar } from '../friends/Avatar.tsx';
import { t } from '../i18n/i18n.ts';
import { CloseIcon } from '../icons/icons.tsx';
import { useApply, useStoreState, useWorkspace } from '../store/hooks.ts';
import { useSyncState } from '../sync/syncContext.ts';
import { ConfirmDialog } from './ListDialog.tsx';
import { listName } from './listName.ts';

const ROLES: Role[] = ['editor', 'viewer', 'owner'];

interface Choice {
  principal: string;
  name: string;
  /** A friend's username, which the box also matches on. */
  handle?: string;
}

// The friend box matches what is typed anywhere in a name or a username, ignoring case. Only
// the part of a username before its server counts, or one letter would match every friend.
const matchChoices = createFilterOptions<Choice>({
  stringify: (choice) => `${choice.name} ${choice.handle?.split('@')[0] ?? ''}`,
});

/**
 * Who a list is shared with (spec: Sharing & Permissions, Lists). Its owner adds friends in a
 * role, changes roles, removes people or makes it private again; anyone else may leave.
 */
export function ShareDialog({ list, onClose }: { list: List; onClose: () => void }) {
  const workspace = useWorkspace();
  const apply = useApply();
  const navigate = useNavigate();
  const syncNow = useSyncState((state) => state.syncNow);
  const me = useStoreState((state) => state.context().userId);
  const [adding, setAdding] = useState('');
  const [typed, setTyped] = useState('');
  const [role, setRole] = useState<Role>('editor');
  const [confirm, setConfirm] = useState<'private' | 'leave' | null>(null);

  const owner = roleOn(workspace, me, list.id) === 'owner';
  const users = new Map(workspace.entities.users.map((user) => [user.id, user]));
  const members = listMembersOf(workspace, list.id);
  const memberPrincipals = new Set(members.map((member) => member.principal));
  // Friends and my groups not on the list yet, as principals.
  const friends = friendsOf(workspace, me).filter(
    (friend) =>
      friend.state === 'accepted' &&
      !memberPrincipals.has(`user:${friend.userId}`) &&
      friend.userId !== listOwner(list),
  );
  const groups = activeGroupsOf(workspace, me).filter(
    (group) => !memberPrincipals.has(`group:${group.id}`),
  );
  const choices: Choice[] = [
    ...friends.map((friend) => ({
      principal: `user:${friend.userId}`,
      name: nameOf(friend.user, friend.userId),
      ...(friend.user?.handle ? { handle: friend.user.handle } : {}),
    })),
    ...groups.map((group) => ({
      principal: `group:${group.id}`,
      name: t('share.groupOption', { name: group.name }),
    })),
  ];
  const mine = members.find((member) => member.principal === `user:${me}`);
  const name = listName(list, workspace);
  const change = (operation: Parameters<typeof apply>[0]) => {
    apply(operation);
    void syncNow();
  };

  const person = (userId: string) => {
    const user = users.get(userId);
    const label = nameOf(user, userId);
    return {
      label: userId === me ? t('share.you', { name: label }) : label,
      plain: label,
      color: user?.avatarColor ?? '#B8BCC4',
      photo: user?.photo,
      detail: user?.handle,
    };
  };
  const principal = (value: string) => {
    if (value.startsWith('user:')) return person(value.slice(5));
    const shown = describePrincipal(workspace, value);
    return {
      label: shown.name,
      plain: shown.name,
      color: shown.color,
      photo: undefined as string | undefined,
      detail: t('share.group'),
    };
  };
  const creator = person(listOwner(list));

  return (
    <>
      <Dialog open onClose={onClose} fullWidth maxWidth="xs">
        <DialogTitle>{t('share.title', { name })}</DialogTitle>
        <DialogContent>
          <MuiList dense disablePadding aria-label={t('share.title', { name })}>
            <ListItem disableGutters>
              <Box sx={{ mr: 1.5 }}>
                <Avatar name={creator.plain} color={creator.color} photo={creator.photo} />
              </Box>
              <ListItemText
                primary={creator.label}
                secondary={creator.detail}
                slotProps={{ secondary: { noWrap: true } }}
                sx={{ minWidth: 0 }}
              />
              <Typography variant="body2" color="text.secondary" sx={{ flexShrink: 0, ml: 1 }}>
                {t('share.owner')}
              </Typography>
            </ListItem>
            {members.map((member) => {
              const shown = principal(member.principal);
              return (
                <ListItem key={member.id} disableGutters>
                  <Box sx={{ mr: 1.5 }}>
                    <Avatar name={shown.plain} color={shown.color} photo={shown.photo} />
                  </Box>
                  <ListItemText
                    primary={shown.label}
                    secondary={shown.detail}
                    slotProps={{ secondary: { noWrap: true } }}
                    sx={{ minWidth: 0 }}
                  />
                  {owner ? (
                    <Box
                      sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0, ml: 1 }}
                    >
                      <TextField
                        select
                        size="small"
                        variant="standard"
                        value={member.role}
                        onChange={(event) =>
                          change((ctx, ws) =>
                            shareList(
                              ctx,
                              ws,
                              list.id,
                              member.principal,
                              event.target.value as Role,
                            ),
                          )
                        }
                        slotProps={{
                          htmlInput: { 'aria-label': t('share.roleOf', { name: shown.plain }) },
                        }}
                      >
                        {ROLES.map((each) => (
                          <MenuItem key={each} value={each}>
                            {t(`share.role.${each}`)}
                          </MenuItem>
                        ))}
                      </TextField>
                      <Tooltip title={t('share.remove', { name: shown.plain })}>
                        <IconButton
                          size="small"
                          aria-label={t('share.remove', { name: shown.plain })}
                          onClick={() => change((ctx, ws) => removeMember(ctx, ws, member.id))}
                        >
                          <CloseIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Box>
                  ) : (
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{ flexShrink: 0, ml: 1 }}
                    >
                      {t(`share.role.${member.role}`)}
                    </Typography>
                  )}
                </ListItem>
              );
            })}
          </MuiList>
          {members.length === 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              {t('share.private')}
            </Typography>
          )}

          {owner && (
            <>
              <Divider sx={{ my: 2 }} />
              {choices.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  {friendsOf(workspace, me).some((friend) => friend.state === 'accepted')
                    ? t('share.allIn')
                    : t('share.noFriends')}
                </Typography>
              ) : (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'flex-end' }}>
                  {/* Type to narrow by name or username. */}
                  <Autocomplete
                    size="small"
                    autoHighlight
                    options={choices}
                    value={choices.find((choice) => choice.principal === adding) ?? null}
                    inputValue={typed}
                    onInputChange={(_, next) => setTyped(next)}
                    onChange={(_, next) => setAdding(next?.principal ?? '')}
                    getOptionLabel={(choice) => choice.name}
                    // Two friends may share a name, so options are keyed by who they are.
                    getOptionKey={(choice) => choice.principal}
                    isOptionEqualToValue={(one, other) => one.principal === other.principal}
                    renderOption={({ key, ...props }, choice) => (
                      <li key={key} {...props}>
                        <ListItemText
                          primary={choice.name}
                          // The username tells same-named friends apart, as on the Friends page.
                          secondary={
                            choice.handle &&
                            choice.handle.toLowerCase() !== choice.name.toLowerCase()
                              ? choice.handle
                              : undefined
                          }
                          sx={{ my: 0 }}
                        />
                      </li>
                    )}
                    filterOptions={matchChoices}
                    noOptionsText={t('share.noMatch')}
                    sx={{ flex: '1 1 12rem' }}
                    renderInput={(params) => <TextField {...params} label={t('share.add')} />}
                  />
                  <TextField
                    select
                    size="small"
                    value={role}
                    onChange={(event) => setRole(event.target.value as Role)}
                    slotProps={{
                      htmlInput: { 'aria-label': t('share.roleOf', { name: t('share.add') }) },
                    }}
                  >
                    {ROLES.map((each) => (
                      <MenuItem key={each} value={each}>
                        {t(`share.role.${each}`)}
                      </MenuItem>
                    ))}
                  </TextField>
                  <Button
                    variant="contained"
                    disableElevation
                    disabled={adding === ''}
                    onClick={() => {
                      change((ctx, ws) => shareList(ctx, ws, list.id, adding, role));
                      setAdding('');
                      setTyped('');
                    }}
                  >
                    {t('share.addButton')}
                  </Button>
                </Box>
              )}
            </>
          )}
          {!owner && mine?.role === 'viewer' && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              {t('share.viewerNote')}
            </Typography>
          )}
        </DialogContent>
        <DialogActions sx={{ justifyContent: 'space-between' }}>
          {owner && members.length > 0 ? (
            <Button color="error" onClick={() => setConfirm('private')}>
              {t('share.makePrivate')}
            </Button>
          ) : !owner && mine ? (
            <Button color="error" onClick={() => setConfirm('leave')}>
              {t('share.leave')}
            </Button>
          ) : (
            <span />
          )}
          <Button onClick={onClose}>{t('common.done')}</Button>
        </DialogActions>
      </Dialog>
      {confirm === 'private' && (
        <ConfirmDialog
          open
          message={t('share.makePrivateConfirm', { name })}
          confirmLabel={t('share.makePrivate')}
          onClose={() => setConfirm(null)}
          onConfirm={() => {
            change((ctx, ws) => makePrivate(ctx, ws, list.id));
            setConfirm(null);
          }}
        />
      )}
      {confirm === 'leave' && mine && (
        <ConfirmDialog
          open
          message={t('share.leaveConfirm', { name })}
          confirmLabel={t('share.leave')}
          onClose={() => setConfirm(null)}
          onConfirm={() => {
            change((ctx, ws) => removeMember(ctx, ws, mine.id));
            setConfirm(null);
            onClose();
            void navigate('/inbox');
          }}
        />
      )}
    </>
  );
}
