import AccountTreeOutlined from '@mui/icons-material/AccountTreeOutlined';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import LinkOffRounded from '@mui/icons-material/LinkOffRounded';
import OpenInNewRounded from '@mui/icons-material/OpenInNewRounded';
import SearchRounded from '@mui/icons-material/SearchRounded';
import {
  Box,
  Dialog,
  DialogContent,
  DialogTitle,
  InputBase,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Typography,
} from '@mui/material';
import { useState } from 'react';
import { getEntity } from '../../core/collections.ts';
import { ALL_TASKS, filterTasks } from '../../core/filters.ts';
import { ancestors, canNestUnder, deleteTask, detachTask, nestUnder } from '../../core/tasks.ts';
import type { Task } from '../../core/types.ts';
import { useToday } from '../hooks/useToday.ts';
import { t } from '../i18n/i18n.ts';
import { listName } from '../lists/listName.ts';
import { useApply, useWorkspace } from '../store/hooks.ts';
import { useTaskSelection } from './selection.ts';

const MAX_RESULTS = 50;

/** Pick the task that `task` should become a subtask of. */
function NestUnderDialog({ task, onClose }: { task: Task; onClose: () => void }) {
  const workspace = useWorkspace();
  const apply = useApply();
  const today = useToday();
  const [query, setQuery] = useState('');
  const wanted = query.trim().toLowerCase();
  const candidates = filterTasks(workspace, ALL_TASKS, today)
    .filter((other) => canNestUnder(workspace, task.id, other.id))
    .filter((other) => !wanted || other.title.toLowerCase().includes(wanted))
    .slice(0, MAX_RESULTS);
  const title = task.title || t('task.untitled');

  const choose = (parent: Task) => {
    apply(
      (ctx, ws) => nestUnder(ctx, ws, task.id, parent.id),
      t('undo.nested', { title: parent.title || t('task.untitled') }),
    );
    onClose();
  };

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle sx={{ pb: 1 }}>{t('task.nestUnderTitle', { title })}</DialogTitle>
      <DialogContent sx={{ px: 1, pb: 1 }}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            mx: 1,
            mb: 1,
            px: 1.5,
            py: 0.5,
            borderRadius: 2,
            bgcolor: 'action.hover',
            color: 'text.secondary',
          }}
        >
          <SearchRounded fontSize="small" />
          <InputBase
            autoFocus
            fullWidth
            value={query}
            placeholder={t('task.nestSearch')}
            inputProps={{ 'aria-label': t('task.nestSearch') }}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && candidates[0]) {
                event.preventDefault();
                choose(candidates[0]);
              }
            }}
            sx={{ color: 'text.primary' }}
          />
        </Box>
        {candidates.length === 0 ? (
          <Typography color="text.secondary" sx={{ px: 2, py: 1 }}>
            {t('task.nestNone')}
          </Typography>
        ) : (
          <List dense sx={{ maxHeight: 360, overflowY: 'auto' }}>
            {candidates.map((other) => {
              const list = getEntity(workspace, 'lists', other.listId);
              const where = [
                list ? listName(list) : null,
                ...ancestors(workspace, other.id).map((item) => item.title || t('task.untitled')),
              ]
                .filter(Boolean)
                .join(' › ');
              return (
                <ListItemButton
                  key={other.id}
                  onClick={() => choose(other)}
                  sx={{ borderRadius: 2 }}
                >
                  <ListItemText
                    primary={other.title || t('task.untitled')}
                    secondary={where}
                    slotProps={{ primary: { noWrap: true }, secondary: { noWrap: true } }}
                  />
                </ListItemButton>
              );
            })}
          </List>
        )}
      </DialogContent>
    </Dialog>
  );
}

export type TaskMenuAnchor = { element: HTMLElement } | { position: { top: number; left: number } };

/**
 * Actions on one task: from a row's right-click and the details' actions button.
 * (Long-press on touch comes with drag and drop, PL-014.)
 */
export function TaskMenu({
  task,
  anchor,
  onClose,
  showOpen = false,
}: {
  task: Task;
  anchor: TaskMenuAnchor | null;
  onClose: () => void;
  /** Offer "Open" (rows; the details panel is already open) */
  showOpen?: boolean;
}) {
  const apply = useApply();
  const { selectedId, open, close } = useTaskSelection();
  const [nesting, setNesting] = useState(false);
  const run = (action: () => void) => () => {
    onClose();
    action();
  };
  const placement =
    anchor && 'position' in anchor
      ? { anchorReference: 'anchorPosition' as const, anchorPosition: anchor.position }
      : { anchorEl: anchor?.element ?? null };
  return (
    <>
      <Menu open={anchor !== null} onClose={onClose} {...placement}>
        {showOpen && (
          <MenuItem onClick={run(() => open(task.id))}>
            <ListItemIcon>
              <OpenInNewRounded fontSize="small" />
            </ListItemIcon>
            {t('task.openAction')}
          </MenuItem>
        )}
        <MenuItem onClick={run(() => setNesting(true))}>
          <ListItemIcon>
            <AccountTreeOutlined fontSize="small" />
          </ListItemIcon>
          {t('task.nestUnder')}
        </MenuItem>
        {task.parentId && (
          <MenuItem
            onClick={run(() =>
              apply((ctx, ws) => detachTask(ctx, ws, task.id), t('undo.detached')),
            )}
          >
            <ListItemIcon>
              <LinkOffRounded fontSize="small" />
            </ListItemIcon>
            {t('task.detach')}
          </MenuItem>
        )}
        <MenuItem
          onClick={run(() => {
            apply((ctx, ws) => deleteTask(ctx, ws, task.id), t('undo.deleted'));
            if (selectedId === task.id) close();
          })}
        >
          <ListItemIcon>
            <DeleteOutlineRounded fontSize="small" />
          </ListItemIcon>
          {t('task.delete')}
        </MenuItem>
      </Menu>
      {nesting && <NestUnderDialog task={task} onClose={() => setNesting(false)} />}
    </>
  );
}
