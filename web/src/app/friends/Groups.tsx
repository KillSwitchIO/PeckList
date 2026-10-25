import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  MenuItem,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useState } from 'react';
import {
  acceptGroupInvite,
  createGroup,
  groupMembersOf,
  groupsOf,
  inviteToGroup,
  isServerGroup,
  memberName,
  removeFromGroup,
  transferGroup,
  updateGroup,
  type GroupView,
} from '../../core/groups.ts';
import { COLOR_FAMILIES } from '../../core/palette.ts';
import { friendsOf, nameOf } from '../../core/sharing.ts';
import type { GroupMember } from '../../core/types.ts';
import { t } from '../i18n/i18n.ts';
import { CloseIcon } from '../icons/icons.tsx';
import { ConfirmDialog, NameDialog } from '../lists/ListDialog.tsx';
import { useApply, useStoreState, useWorkspace } from '../store/hooks.ts';
import { useSyncState } from '../sync/syncContext.ts';
import { Avatar } from './Avatar.tsx';

const GROUP_COLORS = COLOR_FAMILIES[0]!.colors.map((color) => color.hex);

/** Change and send it now: the people concerned should not wait for the next sync. */
function useChange() {
  const apply = useApply();
  const syncNow = useSyncState((state) => state.syncNow);
  return (operation: Parameters<typeof apply>[0]) => {
    apply(operation);
    void syncNow();
  };
}

/**
 * Groups (spec: Sharing & Permissions, Groups): named sets of people to share lists with and
 * assign tasks to. Invites wait here to be accepted; a group opens to manage its members.
 */
export function Groups({ title }: { title: string }) {
  const workspace = useWorkspace();
  const me = useStoreState((state) => state.context().userId);
  const change = useChange();
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const groups = groupsOf(workspace, me);
  const invites = groups.filter((view) => view.mine?.state === 'invited');
  const joined = groups.filter((view) => view.mine?.state !== 'invited');
  const open = joined.find((view) => view.group.id === openId);

  return (
    <Box component="section" aria-label={title}>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
        <Typography variant="subtitle2" color="text.secondary" sx={{ flexGrow: 1 }}>
          {title}
        </Typography>
        <Button size="small" onClick={() => setCreating(true)}>
          {t('group.new')}
        </Button>
      </Box>
      {invites.length > 0 && (
        <List dense disablePadding aria-label={t('group.invites')} sx={{ mb: 1 }}>
          {invites.map((view) => (
            <ListItem
              key={view.group.id}
              disableGutters
              secondaryAction={
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <Button
                    size="small"
                    onClick={() => change((ctx, ws) => removeFromGroup(ctx, ws, view.mine!.id))}
                  >
                    {t('friends.decline')}
                  </Button>
                  <Button
                    size="small"
                    variant="contained"
                    disableElevation
                    onClick={() => change((ctx, ws) => acceptGroupInvite(ctx, ws, view.mine!.id))}
                  >
                    {t('group.join')}
                  </Button>
                </Box>
              }
            >
              <Box sx={{ mr: 1.5 }}>
                <Avatar name={view.group.name} color={view.group.color} />
              </Box>
              <ListItemText
                primary={view.group.name}
                secondary={t('group.invitedBy', {
                  name: nameOf(
                    workspace.entities.users.find((user) => user.id === view.group.ownerId),
                    view.group.ownerId,
                  ),
                })}
              />
            </ListItem>
          ))}
        </List>
      )}
      {joined.length === 0 ? (
        <Alert severity="info" variant="outlined">
          {t('group.none')}
        </Alert>
      ) : (
        <List dense disablePadding>
          {joined.map((view, index) => {
            const active = view.members.filter((member) => member.state === 'active').length;
            return (
              <Box key={view.group.id}>
                {index > 0 && <Divider component="li" />}
                <ListItemButton
                  sx={{ px: 0, borderRadius: 1 }}
                  onClick={() => setOpenId(view.group.id)}
                >
                  <Box sx={{ mr: 1.5 }}>
                    <Avatar name={view.group.name} color={view.group.color} />
                  </Box>
                  <ListItemText
                    primary={view.group.name}
                    secondary={[
                      isServerGroup(view.group) ? t('group.server') : null,
                      active === 1
                        ? t('group.oneMember')
                        : Math.max(active, 1) === 1
                          ? t('group.membersOne')
                          : t('group.members', { count: active }),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  />
                </ListItemButton>
              </Box>
            );
          })}
        </List>
      )}
      {creating && (
        <NameDialog
          open
          title={t('group.new')}
          label={t('group.name')}
          submitLabel={t('common.create')}
          onClose={() => setCreating(false)}
          onSubmit={(name) => {
            let id = '';
            change((ctx, ws) => {
              const color = GROUP_COLORS[ws.entities.groups.length % GROUP_COLORS.length]!;
              const result = createGroup(ctx, ws, { name, color });
              id = result.group.id;
              return result.workspace;
            });
            setCreating(false);
            setOpenId(id);
          }}
        />
      )}
      {open && <GroupDialog view={open} onClose={() => setOpenId(null)} />}
    </Box>
  );
}

/** One group: its members (the owner manages them), inviting friends, leaving. */
function GroupDialog({ view, onClose }: { view: GroupView; onClose: () => void }) {
  const workspace = useWorkspace();
  const me = useStoreState((state) => state.context().userId);
  const change = useChange();
  const [inviting, setInviting] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [confirm, setConfirm] = useState<'leave' | GroupMember | null>(null);
  const { group, owner } = view;
  const members = groupMembersOf(workspace, group.id);
  const inGroup = new Set(members.map((member) => member.userId));
  const friends = friendsOf(workspace, me).filter(
    (friend) => friend.state === 'accepted' && !inGroup.has(friend.userId),
  );
  const mine = members.find((member) => member.userId === me);
  const heir = members.find((member) => member.state === 'active' && member.userId !== me);
  const label = (member: GroupMember) =>
    member.userId === me
      ? t('share.you', { name: memberName(workspace, member) })
      : memberName(workspace, member);

  return (
    <>
      <Dialog open onClose={onClose} fullWidth maxWidth="xs">
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Avatar name={group.name} color={group.color} />
          <Box component="span" sx={{ flexGrow: 1 }}>
            {group.name}
          </Box>
          {owner && (
            <Button size="small" onClick={() => setRenaming(true)}>
              {t('common.rename')}
            </Button>
          )}
        </DialogTitle>
        <DialogContent>
          {isServerGroup(group) && (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
              {t('group.serverHint')}
            </Typography>
          )}
          <List dense disablePadding aria-label={t('group.membersOf', { name: group.name })}>
            {members.map((member) => {
              const name = memberName(workspace, member);
              const user = workspace.entities.users.find((each) => each.id === member.userId);
              const isOwner = member.userId === group.ownerId;
              return (
                <ListItem
                  key={member.id}
                  disableGutters
                  secondaryAction={
                    isOwner ? (
                      <Typography variant="body2" color="text.secondary">
                        {t('share.owner')}
                      </Typography>
                    ) : member.state === 'invited' ? (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <Typography variant="body2" color="text.secondary">
                          {t('group.invited')}
                        </Typography>
                        {owner && (
                          <Tooltip title={t('share.remove', { name })}>
                            <IconButton
                              size="small"
                              aria-label={t('share.remove', { name })}
                              onClick={() =>
                                change((ctx, ws) => removeFromGroup(ctx, ws, member.id))
                              }
                            >
                              <CloseIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        )}
                      </Box>
                    ) : owner ? (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <Button
                          size="small"
                          onClick={() =>
                            change((ctx, ws) => transferGroup(ctx, ws, group.id, member.userId))
                          }
                        >
                          {t('group.makeOwner')}
                        </Button>
                        <Tooltip title={t('share.remove', { name })}>
                          <IconButton
                            size="small"
                            aria-label={t('share.remove', { name })}
                            onClick={() => setConfirm(member)}
                          >
                            <CloseIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </Box>
                    ) : null
                  }
                >
                  <Box sx={{ mr: 1.5 }}>
                    <Avatar
                      name={name}
                      color={user?.avatarColor ?? '#B8BCC4'}
                      photo={user?.photo}
                    />
                  </Box>
                  <ListItemText primary={label(member)} secondary={user?.handle} />
                </ListItem>
              );
            })}
          </List>
          {owner && (
            <>
              <Divider sx={{ my: 2 }} />
              {friends.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  {friendsOf(workspace, me).some((friend) => friend.state === 'accepted')
                    ? t('group.allIn')
                    : t('group.noFriends')}
                </Typography>
              ) : (
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-end' }}>
                  <TextField
                    select
                    size="small"
                    label={t('group.invite')}
                    value={inviting}
                    onChange={(event) => setInviting(event.target.value)}
                    sx={{ flexGrow: 1 }}
                  >
                    {friends.map((friend) => (
                      <MenuItem key={friend.userId} value={friend.userId}>
                        {nameOf(friend.user, friend.userId)}
                      </MenuItem>
                    ))}
                  </TextField>
                  <Button
                    variant="contained"
                    disableElevation
                    disabled={inviting === ''}
                    onClick={() => {
                      change((ctx, ws) => inviteToGroup(ctx, ws, group.id, inviting));
                      setInviting('');
                    }}
                  >
                    {t('group.inviteButton')}
                  </Button>
                </Box>
              )}
            </>
          )}
        </DialogContent>
        <DialogActions sx={{ justifyContent: 'space-between' }}>
          {mine && !isServerGroup(group) ? (
            <Button color="error" onClick={() => setConfirm('leave')}>
              {t('group.leave')}
            </Button>
          ) : (
            <span />
          )}
          <Button onClick={onClose}>{t('common.done')}</Button>
        </DialogActions>
      </Dialog>
      {renaming && (
        <NameDialog
          open
          title={t('common.rename')}
          label={t('group.name')}
          initial={group.name}
          submitLabel={t('common.save')}
          onClose={() => setRenaming(false)}
          onSubmit={(name) => {
            change((ctx, ws) => updateGroup(ctx, ws, group.id, { name }));
            setRenaming(false);
          }}
        />
      )}
      {confirm === 'leave' && mine && (
        <ConfirmDialog
          open
          message={
            owner && heir
              ? t('group.leaveOwnerConfirm', {
                  name: group.name,
                  heir: memberName(workspace, heir),
                })
              : owner
                ? t('group.leaveLastConfirm', { name: group.name })
                : t('group.leaveConfirm', { name: group.name })
          }
          confirmLabel={t('group.leave')}
          onClose={() => setConfirm(null)}
          onConfirm={() => {
            change((ctx, ws) => removeFromGroup(ctx, ws, mine.id));
            setConfirm(null);
            onClose();
          }}
        />
      )}
      {confirm && confirm !== 'leave' && (
        <ConfirmDialog
          open
          message={t('group.removeConfirm', {
            name: memberName(workspace, confirm),
            group: group.name,
          })}
          confirmLabel={t('share.remove', { name: memberName(workspace, confirm) })}
          onClose={() => setConfirm(null)}
          onConfirm={() => {
            change((ctx, ws) => removeFromGroup(ctx, ws, confirm.id));
            setConfirm(null);
          }}
        />
      )}
    </>
  );
}
