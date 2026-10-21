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
import {
  ancestors,
  canNestUnder,
  deleteTask,
  detachTask,
  nestUnder,
  PROGRESS_STEPS,
  setTaskProgress,
  setTaskStatus,
} from '../../core/tasks.ts';
import type { Task } from '../../core/types.ts';
import { useToday } from '../hooks/useToday.ts';
import { t } from '../i18n/i18n.ts';
import { listName } from '../lists/listName.ts';
import { useApply, useWorkspace } from '../store/hooks.ts';
import {
  CheckIcon,
  ChevronLeftIcon,
  ProgressIcon,
  ReopenIcon,
  WontDoIcon,
} from '../icons/icons.tsx';
import { ProgressRing } from './ProgressRing.tsx';
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
 * Actions on one task: from a row's right-click (or long-press), the details title's right-click
 * (or long-press) and the details' actions button.
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
  // The menu swaps to a list of progress steps, then back.
  const [view, setView] = useState<'main' | 'progress'>('main');
  const closeMenu = () => {
    onClose();
    setView('main');
  };
  const run = (action: () => void) => () => {
    closeMenu();
    action();
  };
  const placement =
    anchor && 'position' in anchor
      ? { anchorReference: 'anchorPosition' as const, anchorPosition: anchor.position }
      : { anchorEl: anchor?.element ?? null };
  return (
    <>
      <Menu
        open={anchor !== null && view === 'progress'}
        onClose={closeMenu}
        {...placement}
        slotProps={{ paper: { sx: { minWidth: 200 } } }}
      >
        <MenuItem onClick={() => setView('main')} sx={{ color: 'text.secondary' }}>
          <ListItemIcon>
            <ChevronLeftIcon fontSize="small" />
          </ListItemIcon>
          {t('task.progress')}
        </MenuItem>
        {PROGRESS_STEPS.map((step) => (
          <MenuItem
            key={step}
            selected={step === task.progress}
            onClick={run(() => apply((ctx, ws) => setTaskProgress(ctx, ws, task.id, step)))}
          >
            <ListItemIcon>
              <ProgressRing value={step} size={16} decorative />
            </ListItemIcon>
            <ListItemText>
              {step === 0 ? t('task.progressNone') : t('task.progressValue', { percent: step })}
            </ListItemText>
            {step === task.progress && (
              <CheckIcon fontSize="small" sx={{ ml: 2, color: 'primary.main' }} />
            )}
          </MenuItem>
        ))}
      </Menu>
      <Menu open={anchor !== null && view === 'main'} onClose={closeMenu} {...placement}>
        {showOpen && (
          <MenuItem onClick={run(() => open(task.id))}>
            <ListItemIcon>
              <OpenInNewRounded fontSize="small" />
            </ListItemIcon>
            {t('task.openAction')}
          </MenuItem>
        )}
        {task.status === 'open' ? (
          <MenuItem
            onClick={run(() =>
              apply((ctx, ws) => setTaskStatus(ctx, ws, task.id, 'wontdo'), t('undo.wontDo')),
            )}
          >
            <ListItemIcon>
              <WontDoIcon fontSize="small" />
            </ListItemIcon>
            {t('task.markWontDo')}
          </MenuItem>
        ) : (
          <MenuItem
            onClick={run(() =>
              apply((ctx, ws) => setTaskStatus(ctx, ws, task.id, 'open'), t('undo.reopened')),
            )}
          >
            <ListItemIcon>
              <ReopenIcon fontSize="small" />
            </ListItemIcon>
            {t('task.reopenAction')}
          </MenuItem>
        )}
        <MenuItem onClick={() => setView('progress')}>
          <ListItemIcon>
            <ProgressIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t('task.progress')}</ListItemText>
          <Typography variant="body2" color="text.secondary" sx={{ ml: 2 }}>
            {task.progress ? t('task.progressValue', { percent: task.progress }) : ''}
          </Typography>
        </MenuItem>
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
