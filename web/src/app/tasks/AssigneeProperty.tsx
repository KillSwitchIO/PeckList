import {
  Box,
  Button,
  InputBase,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Typography,
} from '@mui/material';
import { useState } from 'react';
import {
  assigneeCandidates,
  assigneesOf,
  canClaim,
  claimTask,
  describePrincipal,
  inviteAndAssign,
  setAssignee,
  type Assignee,
} from '../../core/sharing.ts';
import type { Task } from '../../core/types.ts';
import { Avatar } from '../friends/Avatar.tsx';
import { AvatarStack } from '../friends/AvatarStack.tsx';
import { t } from '../i18n/i18n.ts';
import { AssignedIcon, CheckIcon, PlusIcon } from '../icons/icons.tsx';
import { useApply, useStoreState, useWorkspace } from '../store/hooks.ts';
import { useSyncState } from '../sync/syncContext.ts';
import { PropertyRow, PropertySheet } from './PropertyRow.tsx';
import { useReadOnly } from './readOnly.ts';

/**
 * The "Assigned" row in task details (spec: Sharing & Permissions, Assignment): who the task is
 * for, picked from me, my friends and the people on its list. Only with a server that has accounts.
 */
export function AssigneeProperty({ task }: { task: Task }) {
  const workspace = useWorkspace();
  const apply = useApply();
  const me = useStoreState((state) => state.context().userId);
  const syncNow = useSyncState((state) => state.syncNow);
  const friendsApi = useSyncState((state) => state.transport.friends);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [query, setQuery] = useState('');
  const [lookup, setLookup] = useState<'idle' | 'looking' | 'missing'>('idle');
  const readOnly = useReadOnly();

  const assigned = assigneesOf(task).map((principal) => describePrincipal(workspace, principal));
  const label = (each: Pick<Assignee, 'principal' | 'name' | 'pending'>) =>
    each.principal === `user:${me}`
      ? t('assignee.me')
      : each.pending
        ? t('assignee.invitedName', { name: each.name })
        : each.name;
  const display =
    assigned.length === 0
      ? t('assignee.none')
      : assigned.length === 1
        ? label(assigned[0]!)
        : t('assignee.and', {
            first: label(assigned[0]!),
            count: assigned.length - 1,
          });
  const chosen = new Set(assigned.map((each) => each.principal));
  const candidates = anchor ? assigneeCandidates(workspace, me, task) : [];
  // Typing narrows the choices; a name nobody here matches can be invited (exact username).
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? candidates.filter(
        (each) =>
          each.name.toLowerCase().includes(needle) ||
          (each.user?.handle ?? '').toLowerCase().includes(needle),
      )
    : candidates;
  const exact = candidates.some(
    (each) =>
      each.name.toLowerCase() === needle || (each.user?.handle ?? '').toLowerCase() === needle,
  );
  const canInvite = friendsApi !== undefined && needle !== '' && !exact;
  const close = () => {
    setAnchor(null);
    setQuery('');
    setLookup('idle');
  };
  const toggle = (principal: string, on: boolean) => {
    apply((ctx, ws) => setAssignee(ctx, ws, task.id, principal, !on));
    void syncNow();
  };
  const invite = async () => {
    if (!friendsApi) return;
    setLookup('looking');
    const found = await friendsApi.lookup(query.trim()).catch(() => null);
    if (!found) {
      setLookup('missing');
      return;
    }
    apply((ctx, ws) => inviteAndAssign(ctx, ws, task.id, found.userId));
    void syncNow();
    setQuery('');
    setLookup('idle');
  };
  const claimable = !readOnly && canClaim(workspace, me, task);

  return (
    <>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <PropertyRow
            label={t('assignee.label')}
            icon={<AssignedIcon fontSize="small" />}
            ariaValue={display}
            onClick={setAnchor}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
              {assigned.length > 0 && <AvatarStack people={assigned} size={22} />}
              <Typography
                noWrap
                sx={{ color: assigned.length > 0 ? 'text.primary' : 'text.disabled' }}
              >
                {display}
              </Typography>
            </Box>
          </PropertyRow>
        </Box>
        {/* A group chore: whoever takes it puts their name on it. */}
        {claimable && (
          <Button
            size="small"
            onClick={() => {
              apply((ctx, ws) => claimTask(ctx, ws, task.id));
              void syncNow();
            }}
          >
            {t('assignee.dibs')}
          </Button>
        )}
      </Box>
      <PropertySheet label={t('assignee.title')} anchor={anchor} onClose={close}>
        <Box sx={{ width: { xs: '100%', sm: 300 }, py: 1 }}>
          <InputBase
            autoFocus
            fullWidth
            value={query}
            placeholder={t('assignee.search')}
            onChange={(event) => {
              setQuery(event.target.value);
              setLookup('idle');
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              const only = shown.length === 1 ? shown[0] : undefined;
              if (only) toggle(only.principal, chosen.has(only.principal));
              else if (canInvite) void invite();
            }}
            inputProps={{ 'aria-label': t('assignee.search') }}
            sx={{ px: 2, pb: 1, mb: 0.5, borderBottom: 1, borderColor: 'divider' }}
          />
          <List dense disablePadding aria-label={t('assignee.title')}>
            {shown.map((each) => {
              const on = chosen.has(each.principal);
              return (
                <ListItemButton
                  key={each.principal}
                  role="menuitemcheckbox"
                  aria-checked={on}
                  onClick={() => toggle(each.principal, on)}
                  // A group's members sit under it: assign the group, or one of them.
                  sx={{ pl: each.depth === 1 && !needle ? 5 : 2 }}
                >
                  <ListItemIcon sx={{ minWidth: each.depth === 1 ? 34 : 40 }}>
                    <Avatar
                      name={each.name}
                      color={each.color}
                      photo={each.user?.photo}
                      size={each.depth === 1 ? 24 : 28}
                    />
                  </ListItemIcon>
                  <ListItemText
                    primary={label(each)}
                    secondary={
                      each.principal.startsWith('group:')
                        ? t('assignee.groupHint')
                        : each.pending
                          ? t('assignee.invitedHint')
                          : each.user?.handle
                    }
                  />
                  <CheckIcon
                    fontSize="small"
                    color="primary"
                    sx={{ visibility: on ? 'visible' : 'hidden' }}
                  />
                </ListItemButton>
              );
            })}
            {canInvite && (
              <ListItemButton
                disabled={lookup === 'looking'}
                onClick={() => void invite()}
                sx={{ pl: 2 }}
              >
                <ListItemIcon sx={{ minWidth: 40, pl: 0.5 }}>
                  <PlusIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText
                  primary={t('assignee.invite', { name: query.trim() })}
                  secondary={
                    lookup === 'missing' ? t('friends.notFound') : t('assignee.inviteHint')
                  }
                  slotProps={{
                    secondary: { color: lookup === 'missing' ? 'error' : 'text.secondary' },
                  }}
                />
              </ListItemButton>
            )}
          </List>
          {candidates.length === 1 && !needle && (
            <Typography variant="body2" color="text.secondary" sx={{ px: 2, pt: 1 }}>
              {t('assignee.needsFriends')}
            </Typography>
          )}
        </Box>
      </PropertySheet>
    </>
  );
}
