import {
  Box,
  Button,
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
  setAssignee,
} from '../../core/sharing.ts';
import type { Task } from '../../core/types.ts';
import { Avatar } from '../friends/Avatar.tsx';
import { AvatarStack } from '../friends/AvatarStack.tsx';
import { t } from '../i18n/i18n.ts';
import { AssignedIcon, CheckIcon } from '../icons/icons.tsx';
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
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const readOnly = useReadOnly();

  const assigned = assigneesOf(task).map((principal) => describePrincipal(workspace, principal));
  const label = (principal: string, name: string) =>
    principal === `user:${me}` ? t('assignee.me') : name;
  const display =
    assigned.length === 0
      ? t('assignee.none')
      : assigned.length === 1
        ? label(assigned[0]!.principal, assigned[0]!.name)
        : t('assignee.and', {
            first: label(assigned[0]!.principal, assigned[0]!.name),
            count: assigned.length - 1,
          });
  const chosen = new Set(assigned.map((each) => each.principal));
  const candidates = anchor ? assigneeCandidates(workspace, me, task) : [];
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
      <PropertySheet label={t('assignee.title')} anchor={anchor} onClose={() => setAnchor(null)}>
        <Box sx={{ width: { xs: '100%', sm: 280 }, py: 1 }}>
          <Typography variant="subtitle2" color="text.secondary" sx={{ px: 2, pb: 0.5 }}>
            {t('assignee.title')}
          </Typography>
          <List dense disablePadding aria-label={t('assignee.title')}>
            {candidates.map((each) => {
              const on = chosen.has(each.principal);
              return (
                <ListItemButton
                  key={each.principal}
                  role="menuitemcheckbox"
                  aria-checked={on}
                  onClick={() => {
                    apply((ctx, ws) => setAssignee(ctx, ws, task.id, each.principal, !on));
                    void syncNow();
                  }}
                >
                  <ListItemIcon sx={{ minWidth: 40 }}>
                    <Avatar name={each.name} color={each.color} size={28} />
                  </ListItemIcon>
                  <ListItemText
                    primary={label(each.principal, each.name)}
                    secondary={each.user?.handle}
                  />
                  <CheckIcon
                    fontSize="small"
                    color="primary"
                    sx={{ visibility: on ? 'visible' : 'hidden' }}
                  />
                </ListItemButton>
              );
            })}
          </List>
          {candidates.length === 1 && (
            <Typography variant="body2" color="text.secondary" sx={{ px: 2, pt: 1 }}>
              {t('assignee.needsFriends')}
            </Typography>
          )}
        </Box>
      </PropertySheet>
    </>
  );
}
