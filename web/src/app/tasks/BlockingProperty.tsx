import AddRounded from '@mui/icons-material/AddRounded';
import CheckCircleRounded from '@mui/icons-material/CheckCircleRounded';
import CloseRounded from '@mui/icons-material/CloseRounded';
import HourglassEmptyRounded from '@mui/icons-material/HourglassEmptyRounded';
import LinkRounded from '@mui/icons-material/LinkRounded';
import RadioButtonUncheckedRounded from '@mui/icons-material/RadioButtonUncheckedRounded';
import VisibilityOffOutlined from '@mui/icons-material/VisibilityOffOutlined';
import {
  Box,
  Button,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Tooltip,
  Typography,
} from '@mui/material';
import { useState, type ReactNode } from 'react';
import {
  addBlocker,
  blockedByTask,
  blockersOf,
  removeBlocker,
  warns,
  wouldLoop,
} from '../../core/blocking.ts';
import { getEntity } from '../../core/collections.ts';
import { localTimeZone } from '../../core/dates.ts';
import { ALL_TASKS, filterTasks } from '../../core/filters.ts';
import { canEditTask } from '../../core/sharing.ts';
import { ancestors } from '../../core/tasks.ts';
import type { Id, Task } from '../../core/types.ts';
import { useToday } from '../hooks/useToday.ts';
import { t } from '../i18n/i18n.ts';
import { listName } from '../lists/listName.ts';
import { useApply, useStoreState, useWorkspace } from '../store/hooks.ts';
import { MAX_RESULTS, PickerDialog } from './PickerDialog.tsx';
import { PropertyRow, PropertySheet } from './PropertyRow.tsx';
import { useCanEditTask } from './readOnly.ts';
import { useTaskSelection } from './selection.ts';
import { summary, titleOf } from './blockingText.ts';

/** Pick a task for `task` to wait on (the task menu's "Blocked by...", and the row's Add). */
export function BlockedByDialog({ task, onClose }: { task: Task; onClose: () => void }) {
  const workspace = useWorkspace();
  const apply = useApply();
  const today = useToday();
  // Any task I can see: the link is written on this task, not on the one it waits on.
  const candidates = filterTasks(workspace, ALL_TASKS, today).filter(
    (other) => task.blockedBy[other.id]?.in !== true && !wouldLoop(workspace, task.id, other.id),
  );
  const choose = (blocker: Task) => {
    apply(
      (ctx, ws) => addBlocker(ctx, ws, task.id, blocker.id),
      t('undo.blocked', { title: titleOf(blocker) }),
    );
    onClose();
  };
  return (
    <PickerDialog
      title={t('blocking.pickTitle', { title: titleOf(task) })}
      searchLabel={t('blocking.search')}
      emptyText={t('blocking.none')}
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
          ...ancestors(workspace, other.id).map(titleOf),
        ]
          .filter(Boolean)
          .join(' › ');
        return (
          <ListItemText
            primary={titleOf(other)}
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

/** One linked task in a row's sheet: opens it, and takes the link off when that is allowed. */
function LinkLine({
  icon,
  primary,
  secondary,
  onOpen,
  removeLabel,
  onRemove,
}: {
  icon: ReactNode;
  primary: string;
  secondary?: string | undefined;
  onOpen?: (() => void) | undefined;
  removeLabel: string;
  onRemove?: (() => void) | undefined;
}) {
  const text = (
    <ListItemText
      primary={primary}
      secondary={secondary}
      slotProps={{
        primary: { noWrap: true },
        secondary: { noWrap: true, sx: { color: 'warning.main' } },
      }}
    />
  );
  return (
    <ListItem
      disablePadding
      secondaryAction={
        onRemove && (
          <Tooltip title={removeLabel}>
            <IconButton edge="end" size="small" aria-label={removeLabel} onClick={onRemove}>
              <CloseRounded fontSize="small" />
            </IconButton>
          </Tooltip>
        )
      }
    >
      {onOpen ? (
        <ListItemButton onClick={onOpen} sx={{ gap: 1.25, borderRadius: 2, pr: 6 }}>
          <Box sx={{ display: 'flex', color: 'text.secondary' }}>{icon}</Box>
          {text}
        </ListItemButton>
      ) : (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, px: 2, py: 0.5, pr: 6 }}>
          <Box sx={{ display: 'flex', color: 'text.secondary' }}>{icon}</Box>
          {text}
        </Box>
      )}
    </ListItem>
  );
}

const statusIcon = (task: Task) =>
  task.status === 'open' ? (
    <RadioButtonUncheckedRounded sx={{ fontSize: 16 }} />
  ) : (
    <CheckCircleRounded sx={{ fontSize: 16 }} />
  );

/**
 * The details' "Blocked by" and "Blocks" rows (spec: PL-055), each shown only when there is a
 * link: the first one is made from the task menu's "Blocked by...", or on the timeline.
 */
export function BlockingProperty({ task }: { task: Task }) {
  const workspace = useWorkspace();
  const apply = useApply();
  const { open } = useTaskSelection();
  const me = useStoreState((state) => state.context().userId);
  const canEdit = useCanEditTask(task);
  const zone = localTimeZone();
  const [blockedAnchor, setBlockedAnchor] = useState<HTMLElement | null>(null);
  const [blocksAnchor, setBlocksAnchor] = useState<HTMLElement | null>(null);
  const [picking, setPicking] = useState(false);
  const { shown, hidden } = blockersOf(workspace, task);
  const blocks = blockedByTask(workspace, task);
  const late = shown.filter((blocker) => warns(task, blocker, zone));
  // The last link removed takes its row away, and the sheet goes with it (an Undo brings the row
  // back, not a sheet anchored to the row that went).
  if (blockedAnchor && shown.length === 0 && hidden.length === 0) setBlockedAnchor(null);
  if (blocksAnchor && blocks.length === 0) setBlocksAnchor(null);
  const opening = (id: Id) => () => {
    setBlockedAnchor(null);
    setBlocksAnchor(null);
    open(id);
  };
  const unlink = (blockedId: Id, blockerId: Id, title: string) => () =>
    apply(
      (ctx, ws) => removeBlocker(ctx, ws, blockedId, blockerId),
      t('undo.unblocked', { title }),
    );
  const blockedBySummary = summary(shown.map(titleOf), hidden.length);
  const blocksSummary = summary(blocks.map(titleOf), 0);

  return (
    <>
      {(shown.length > 0 || hidden.length > 0) && (
        <PropertyRow
          label={t('blocking.blockedBy')}
          icon={<HourglassEmptyRounded fontSize="small" />}
          iconColor={late.length > 0 ? 'warning.main' : 'text.secondary'}
          ariaValue={
            late[0]
              ? `${blockedBySummary}. ${t('blocking.startsTooSoon', { title: titleOf(late[0]) })}`
              : blockedBySummary
          }
          onClick={setBlockedAnchor}
        >
          <Typography noWrap>{blockedBySummary}</Typography>
        </PropertyRow>
      )}
      {blocks.length > 0 && (
        <PropertyRow
          label={t('blocking.blocks')}
          icon={<LinkRounded fontSize="small" />}
          ariaValue={blocksSummary}
          onClick={setBlocksAnchor}
        >
          <Typography noWrap>{blocksSummary}</Typography>
        </PropertyRow>
      )}

      <PropertySheet
        label={t('blocking.blockedBy')}
        anchor={blockedAnchor}
        onClose={() => setBlockedAnchor(null)}
      >
        <Box sx={{ width: { xs: '100%', sm: 320 }, py: 1 }}>
          <List dense disablePadding>
            {shown.map((blocker) => (
              <LinkLine
                key={blocker.id}
                icon={statusIcon(blocker)}
                primary={titleOf(blocker)}
                secondary={
                  late.includes(blocker)
                    ? t('blocking.startsTooSoon', { title: titleOf(blocker) })
                    : undefined
                }
                onOpen={opening(blocker.id)}
                removeLabel={t('blocking.remove', { title: titleOf(blocker) })}
                onRemove={canEdit ? unlink(task.id, blocker.id, titleOf(blocker)) : undefined}
              />
            ))}
            {hidden.length > 0 && (
              <LinkLine
                icon={<VisibilityOffOutlined sx={{ fontSize: 16 }} />}
                primary={t('blocking.hidden', { count: hidden.length })}
                removeLabel={t('blocking.removeHidden', { count: hidden.length })}
                onRemove={
                  canEdit
                    ? () =>
                        apply(
                          (ctx, ws) =>
                            hidden.reduce((next, id) => removeBlocker(ctx, next, task.id, id), ws),
                          t('undo.unblockedHidden', { count: hidden.length }),
                        )
                    : undefined
                }
              />
            )}
          </List>
          {canEdit && (
            <Button
              startIcon={<AddRounded />}
              onClick={() => {
                setBlockedAnchor(null);
                setPicking(true);
              }}
              sx={{ mx: 1, mt: 0.5 }}
            >
              {t('blocking.add')}
            </Button>
          )}
        </Box>
      </PropertySheet>

      <PropertySheet
        label={t('blocking.blocks')}
        anchor={blocksAnchor}
        onClose={() => setBlocksAnchor(null)}
      >
        <Box sx={{ width: { xs: '100%', sm: 320 }, py: 1 }}>
          <List dense disablePadding>
            {blocks.map((waiting) => (
              <LinkLine
                key={waiting.id}
                icon={statusIcon(waiting)}
                primary={titleOf(waiting)}
                secondary={
                  warns(waiting, task, zone)
                    ? t('blocking.startsTooSoon', { title: titleOf(task) })
                    : undefined
                }
                onOpen={opening(waiting.id)}
                removeLabel={t('blocking.remove', { title: titleOf(waiting) })}
                // The link is written on the waiting task: only where I may change that one.
                onRemove={
                  canEditTask(workspace, me, waiting)
                    ? unlink(waiting.id, task.id, titleOf(waiting))
                    : undefined
                }
              />
            ))}
          </List>
        </Box>
      </PropertySheet>

      {picking && <BlockedByDialog task={task} onClose={() => setPicking(false)} />}
    </>
  );
}
