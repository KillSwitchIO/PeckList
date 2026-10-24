import CloseRounded from '@mui/icons-material/CloseRounded';
import TaskAltRounded from '@mui/icons-material/TaskAltRounded';
import { Alert, Box, ButtonBase, IconButton, Paper, Tooltip, Typography } from '@mui/material';
import { useNavigate } from 'react-router';
import { removeMember, setAssignee } from '../../core/sharing.ts';
import { sharingOverview } from '../../core/sharingOverview.ts';
import { t } from '../i18n/i18n.ts';
import { ListMark } from '../lists/ListMark.tsx';
import { listName } from '../lists/listName.ts';
import { useApply, useStoreState, useWorkspace } from '../store/hooks.ts';
import { useTaskSelection } from '../tasks/selection.ts';
import { Avatar } from './Avatar.tsx';

/** One shared thing: what it is (a link), and a button to stop sharing it. */
function Item({
  icon,
  label,
  detail,
  open,
  stopLabel,
  onStop,
}: {
  icon: React.ReactNode;
  label: string;
  detail?: string;
  open: () => void;
  stopLabel: string;
  onStop: () => void;
}) {
  return (
    <Box component="li" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
      <ButtonBase
        onClick={open}
        sx={{
          flexGrow: 1,
          minWidth: 0,
          justifyContent: 'flex-start',
          gap: 1,
          px: 1,
          py: 0.75,
          borderRadius: 1,
          textAlign: 'left',
          '&:hover': { bgcolor: 'action.hover' },
        }}
      >
        {icon}
        <Typography noWrap sx={{ minWidth: 0 }}>
          {label}
        </Typography>
        {detail && (
          <Typography variant="body2" color="text.secondary" sx={{ flexShrink: 0 }}>
            {detail}
          </Typography>
        )}
      </ButtonBase>
      <Tooltip title={stopLabel}>
        <IconButton size="small" aria-label={stopLabel} onClick={onStop}>
          <CloseRounded fontSize="small" />
        </IconButton>
      </Tooltip>
    </Box>
  );
}

/**
 * Everything I share (spec: PL-087), by person and then by group: my shared lists with their
 * role, and tasks shared only by assignment. Each opens the list or task; the cross stops sharing
 * it with that person or group (undo brings it back).
 */
export function WhatYouShare() {
  const workspace = useWorkspace();
  const me = useStoreState((state) => state.context().userId);
  const apply = useApply();
  const navigate = useNavigate();
  const { open } = useTaskSelection();
  const overview = sharingOverview(workspace, me);
  return (
    <Box component="section" aria-label={t('whatYouShare.title')}>
      <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
        {t('whatYouShare.title')}
      </Typography>
      {overview.length === 0 ? (
        <Alert severity="info" variant="outlined">
          {t('whatYouShare.none')}
        </Alert>
      ) : (
        <Box sx={{ display: 'grid', gap: 1.5 }}>
          {overview.map((shared) => (
            <Paper
              key={shared.principal}
              variant="outlined"
              component="section"
              aria-label={shared.who.name}
              sx={{ p: 1.5, borderRadius: 3 }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, mb: 0.5 }}>
                <Avatar name={shared.who.name} color={shared.who.color} />
                <Typography sx={{ fontWeight: 600 }}>{shared.who.name}</Typography>
                {shared.principal.startsWith('group:') && (
                  <Typography variant="body2" color="text.secondary">
                    {t('share.group')}
                  </Typography>
                )}
              </Box>
              <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
                {shared.lists.map(({ list, member }) => {
                  const name = listName(list, workspace);
                  return (
                    <Item
                      key={member.id}
                      icon={<ListMark list={list} />}
                      label={name}
                      detail={t(`share.role.${member.role}`)}
                      open={() => void navigate(`/lists/${list.id}`)}
                      stopLabel={t('whatYouShare.stopList', { list: name, name: shared.who.name })}
                      onStop={() =>
                        apply(
                          (ctx, ws) => removeMember(ctx, ws, member.id),
                          t('undo.stoppedSharing'),
                        )
                      }
                    />
                  );
                })}
                {shared.tasks.map((task) => {
                  const title = task.title || t('task.untitled');
                  return (
                    <Item
                      key={task.id}
                      icon={<TaskAltRounded fontSize="small" sx={{ color: 'text.secondary' }} />}
                      label={title}
                      detail={t('whatYouShare.assigned')}
                      open={() => open(task.id)}
                      stopLabel={t('whatYouShare.stopTask', { task: title, name: shared.who.name })}
                      onStop={() =>
                        apply(
                          (ctx, ws) => setAssignee(ctx, ws, task.id, shared.principal, false),
                          t('undo.stoppedSharing'),
                        )
                      }
                    />
                  );
                })}
              </Box>
            </Paper>
          ))}
        </Box>
      )}
    </Box>
  );
}
