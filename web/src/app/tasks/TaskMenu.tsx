import { isPinned, setPinned } from '../../core/tasks.ts';
import { PinIcon, PinOffIcon } from '../icons/icons.tsx';
import AccountTreeOutlined from '@mui/icons-material/AccountTreeOutlined';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import DriveFileMoveOutlined from '@mui/icons-material/DriveFileMoveOutlined';
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
  Slider,
  Typography,
  Divider,
} from '@mui/material';
import { useState, type ReactNode } from 'react';
import { getEntity } from '../../core/collections.ts';
import { ALL_TASKS, filterTasks } from '../../core/filters.ts';
import {
  ancestors,
  canNestUnder,
  detachTask,
  nestUnder,
  setCompletedAt,
  setTaskProgress,
  setTaskStatus,
  moveTask,
} from '../../core/tasks.ts';
import { visibleLists } from '../../core/lists.ts';
import { canEditList } from '../../core/sharing.ts';
import type { Task } from '../../core/types.ts';
import { useToday } from '../hooks/useToday.ts';
import { t } from '../i18n/i18n.ts';
import { listName } from '../lists/listName.ts';
import { ListMark } from '../lists/ListMark.tsx';
import { useApply, useStoreState, useWorkspace } from '../store/hooks.ts';
import { useReadOnly } from './readOnly.ts';
import { localTimeZone } from '../../core/dates.ts';
import { DatePickerPanel } from '../dates/DatePickerPanel.tsx';
import { CalendarCheckIcon, ReopenIcon, WontDoIcon } from '../icons/icons.tsx';
import { completionInstant } from './completion.ts';
import { ProgressRing } from './ProgressRing.tsx';
import { deleteAsking } from '../repeat/repeatActions.ts';
import { useTaskSelection } from './selection.ts';

const MAX_RESULTS = 50;

/** Pick one thing out of a searched list: a search box, the matches, and Enter takes the first. */
function PickerDialog<T>({
  title,
  searchLabel,
  emptyText,
  listLabel,
  matching,
  keyOf,
  render,
  onPick,
  onClose,
}: {
  title: string;
  searchLabel: string;
  emptyText: string;
  listLabel?: string;
  /** The candidates for what was typed (trimmed, lowercase; empty for all). */
  matching: (wanted: string) => T[];
  keyOf: (item: T) => string;
  render: (item: T) => ReactNode;
  onPick: (item: T) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const found = matching(query.trim().toLowerCase());
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle sx={{ pb: 1 }}>{title}</DialogTitle>
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
            placeholder={searchLabel}
            inputProps={{ 'aria-label': searchLabel }}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && found[0]) {
                event.preventDefault();
                onPick(found[0]);
              }
            }}
            sx={{ color: 'text.primary' }}
          />
        </Box>
        {found.length === 0 ? (
          <Typography color="text.secondary" sx={{ px: 2, py: 1 }}>
            {emptyText}
          </Typography>
        ) : (
          <List dense sx={{ maxHeight: 360, overflowY: 'auto' }} aria-label={listLabel}>
            {found.map((item) => (
              <ListItemButton
                key={keyOf(item)}
                onClick={() => onPick(item)}
                sx={{ borderRadius: 2 }}
              >
                {render(item)}
              </ListItemButton>
            ))}
          </List>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Pick the task that `task` should become a subtask of. */
function NestUnderDialog({ task, onClose }: { task: Task; onClose: () => void }) {
  const workspace = useWorkspace();
  const apply = useApply();
  const today = useToday();
  const candidates = filterTasks(workspace, ALL_TASKS, today).filter((other) =>
    canNestUnder(workspace, task.id, other.id),
  );
  const choose = (parent: Task) => {
    apply(
      (ctx, ws) => nestUnder(ctx, ws, task.id, parent.id),
      t('undo.nested', { title: parent.title || t('task.untitled') }),
    );
    onClose();
  };
  return (
    <PickerDialog
      title={t('task.nestUnderTitle', { title: task.title || t('task.untitled') })}
      searchLabel={t('task.nestSearch')}
      emptyText={t('task.nestNone')}
      matching={(wanted) =>
        candidates
          .filter((other) => !wanted || other.title.toLowerCase().includes(wanted))
          .slice(0, MAX_RESULTS)
      }
      keyOf={(other) => other.id}
      render={(other) => {
        const list = getEntity(workspace, 'lists', other.listId);
        const where = [
          list ? listName(list, workspace) : null,
          ...ancestors(workspace, other.id).map((item) => item.title || t('task.untitled')),
        ]
          .filter(Boolean)
          .join(' › ');
        return (
          <ListItemText
            primary={other.title || t('task.untitled')}
            secondary={where}
            slotProps={{ primary: { noWrap: true }, secondary: { noWrap: true } }}
          />
        );
      }}
      onPick={choose}
      onClose={onClose}
    />
  );
}

/** Pick a list to move a task (and its subtasks) to; only lists I may add to are offered. */
export function MoveToListDialog({ task, onClose }: { task: Task; onClose: () => void }) {
  const workspace = useWorkspace();
  const apply = useApply();
  const me = useStoreState((state) => state.context().userId);
  const lists = visibleLists(workspace).filter(
    (list) => list.id !== task.listId && canEditList(workspace, me, list.id),
  );
  const choose = (list: (typeof lists)[number]) => {
    const name = listName(list, workspace);
    apply(
      (ctx, ws) => moveTask(ctx, ws, task.id, { listId: list.id, parentId: null }),
      t('undo.movedTo', { list: name }),
    );
    onClose();
  };
  return (
    <PickerDialog
      title={t('task.moveToTitle', { title: task.title || t('task.untitled') })}
      searchLabel={t('task.moveSearch')}
      emptyText={t('task.moveNone')}
      listLabel={t('task.moveTo')}
      matching={(wanted) =>
        lists.filter((list) => !wanted || listName(list, workspace).toLowerCase().includes(wanted))
      }
      keyOf={(list) => list.id}
      render={(list) => (
        <>
          <ListMark list={list} sx={{ mr: 1.5 }} />
          <ListItemText
            primary={listName(list, workspace)}
            slotProps={{ primary: { noWrap: true } }}
          />
        </>
      )}
      onPick={choose}
      onClose={onClose}
    />
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
  const { selectedId, on, open, close } = useTaskSelection();
  const [nesting, setNesting] = useState(false);
  const [moving, setMoving] = useState(false);
  const today = useToday();
  const [completing, setCompleting] = useState(false);
  // The slider moves the ring as it is dragged and saves when let go.
  const [draft, setDraft] = useState(task.progress);
  const [synced, setSynced] = useState(task.progress);
  if (task.progress !== synced) {
    setSynced(task.progress);
    setDraft(task.progress);
  }
  const readOnly = useReadOnly();
  const closeMenu = onClose;
  const run = (action: () => void) => () => {
    closeMenu();
    action();
  };
  const placement =
    anchor && 'position' in anchor
      ? { anchorReference: 'anchorPosition' as const, anchorPosition: anchor.position }
      : { anchorEl: anchor?.element ?? null };
  // On a task I can only view, the one thing to do is open it.
  if (readOnly) {
    return (
      <Menu open={anchor !== null && showOpen} onClose={closeMenu} {...placement}>
        <MenuItem onClick={run(() => open(task.id))}>
          <ListItemIcon>
            <OpenInNewRounded fontSize="small" />
          </ListItemIcon>
          {t('task.openAction')}
        </MenuItem>
      </Menu>
    );
  }
  return (
    <>
      <Menu open={anchor !== null} onClose={closeMenu} {...placement}>
        {showOpen && (
          <MenuItem onClick={run(() => open(task.id))}>
            <ListItemIcon>
              <OpenInNewRounded fontSize="small" />
            </ListItemIcon>
            {t('task.openAction')}
          </MenuItem>
        )}
        {task.status === 'open' && (
          <MenuItem
            onClick={run(() =>
              apply(
                (ctx, ws) => setPinned(ctx, ws, task.id, !isPinned(task)),
                isPinned(task) ? t('undo.unpinned') : t('undo.pinned'),
              ),
            )}
          >
            <ListItemIcon>
              {isPinned(task) ? <PinOffIcon fontSize="small" /> : <PinIcon fontSize="small" />}
            </ListItemIcon>
            {isPinned(task) ? t('task.unpin') : t('task.pin')}
          </MenuItem>
        )}
        {task.status === 'open' && (
          <MenuItem onClick={run(() => setCompleting(true))}>
            <ListItemIcon>
              <CalendarCheckIcon fontSize="small" />
            </ListItemIcon>
            {t('task.completeOn')}
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
        <Box
          role="group"
          aria-label={t('task.progress')}
          // Arrow keys move the slider, not the menu's focus (Escape still closes the menu).
          onKeyDown={(event) => {
            if (event.key !== 'Escape' && event.key !== 'Tab') event.stopPropagation();
          }}
          sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 0.5, minWidth: 260 }}
        >
          <ProgressRing value={draft} size={20} decorative />
          <Slider
            size="small"
            value={draft}
            min={0}
            max={100}
            step={10}
            marks
            aria-label={t('task.progress')}
            getAriaValueText={(value) => t('task.progressValue', { percent: value })}
            onChange={(_, value) => setDraft(value as number)}
            onChangeCommitted={(_, value) => {
              const percent = value as number;
              if (percent !== task.progress) {
                // 100% completes the task (with undo).
                apply(
                  (ctx, ws) => setTaskProgress(ctx, ws, task.id, percent),
                  percent === 100 && task.status === 'open' ? t('undo.completed') : undefined,
                );
              }
            }}
            sx={{ flexGrow: 1 }}
          />
          <Typography variant="body2" color="text.secondary" sx={{ width: 36, textAlign: 'right' }}>
            {t('task.progressValue', { percent: draft })}
          </Typography>
        </Box>
        <Divider />
        <MenuItem onClick={run(() => setMoving(true))}>
          <ListItemIcon>
            <DriveFileMoveOutlined fontSize="small" />
          </ListItemIcon>
          {t('task.moveTo')}
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
            const opened = selectedId === task.id;
            void deleteAsking(apply, task, opened ? on : null).then((deleted) => {
              if (deleted && opened) close();
            });
          })}
        >
          <ListItemIcon>
            <DeleteOutlineRounded fontSize="small" />
          </ListItemIcon>
          {t('task.delete')}
        </MenuItem>
      </Menu>
      {nesting && <NestUnderDialog task={task} onClose={() => setNesting(false)} />}
      {moving && <MoveToListDialog task={task} onClose={() => setMoving(false)} />}
      {/* Completing on a chosen date asks for the date first. */}
      <Dialog
        open={completing}
        onClose={() => setCompleting(false)}
        slotProps={{ paper: { 'aria-label': t('task.completeOn'), sx: { borderRadius: 3 } } }}
      >
        {completing && (
          <DatePickerPanel
            value={{ date: today, time: null }}
            today={today}
            onApply={(value) => {
              setCompleting(false);
              if (!value) return;
              apply(
                (ctx, ws) =>
                  setCompletedAt(ctx, ws, task.id, completionInstant(task, value, localTimeZone())),
                t('undo.completed'),
              );
            }}
            onCancel={() => setCompleting(false)}
          />
        )}
      </Dialog>
    </>
  );
}
