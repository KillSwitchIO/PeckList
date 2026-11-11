// The bar along the bottom of task details: the list on the left, priority on the
// right. Both open upward, TickTick style, so the details above stay compact.

import {
  Box,
  ButtonBase,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Tooltip,
  useTheme,
} from '@mui/material';
import { useState } from 'react';
import { getEntity } from '../../core/collections.ts';
import { visibleLists } from '../../core/lists.ts';
import { moveTask, updateTask } from '../../core/tasks.ts';
import type { List, Priority, Task } from '../../core/types.ts';
import { t } from '../i18n/i18n.ts';
import { CheckIcon, ChevronUpIcon, FlagIcon, TrayIcon } from '../icons/icons.tsx';
import { listName } from '../lists/listName.ts';
import { ListMark as ListIconOrDot } from '../lists/ListMark.tsx';
import { canMoveTask } from '../../core/sharing.ts';
import { useApply, useStoreState, useWorkspace } from '../store/hooks.ts';
import { useReadOnly } from './readOnly.ts';
import { TaskTagPills } from '../tags/TaskTags.tsx';

const PRIORITIES: Priority[] = [3, 2, 1, 0];
const PRIORITY_KEY = { 0: 'none', 1: 'low', 2: 'medium', 3: 'high' } as const;

// Open upward from the button.
const UPWARD = {
  anchorOrigin: { vertical: 'top', horizontal: 'left' },
  transformOrigin: { vertical: 'bottom', horizontal: 'left' },
} as const;

export function DetailFooter({ task }: { task: Task }) {
  return (
    <Box
      component="footer"
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        px: 1,
        py: 0.5,
        borderTop: 1,
        borderColor: 'divider',
        flexShrink: 0,
      }}
    >
      {/* List and tags take the room; priority sits on the right. */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, flexGrow: 1, mr: 2 }}>
        <ListPicker task={task} />
        <TaskTagPills task={task} />
      </Box>
      <PriorityPicker task={task} />
    </Box>
  );
}

function Check({ on }: { on: boolean }) {
  return on ? <CheckIcon fontSize="small" sx={{ ml: 2, color: 'primary.main' }} /> : null;
}

/** A list's icon or color dot; the Mess Drawer has no color and shows its tray instead. */
function ListMark({ list }: { list: List }) {
  return list.isInbox ? (
    <TrayIcon sx={{ fontSize: 16, flexShrink: 0 }} />
  ) : (
    <ListIconOrDot list={list} sx={{ mx: list.icon ? 0 : '3px' }} />
  );
}

function ListPicker({ task }: { task: Task }) {
  const workspace = useWorkspace();
  const apply = useApply();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const me = useStoreState((state) => state.context().userId);
  // Assigned on a list I can't edit: the task stays in its list, so there is nothing to pick.
  const readOnly = useReadOnly() || !canMoveTask(workspace, me, task);
  const lists = visibleLists(workspace);
  const list = lists.find((each) => each.id === task.listId);
  const current = list ? listName(list, workspace) : '';
  const move = (listId: string) => {
    setAnchor(null);
    if (listId !== task.listId) apply((ctx, ws) => moveTask(ctx, ws, task.id, { listId }));
  };

  // Assigned from a list this device does not have: it stays where its owner put it.
  if (!getEntity(workspace, 'lists', task.listId)) {
    return (
      <Box
        component="span"
        aria-label={t('task.listValue', { list: t('task.otherList') })}
        sx={{ px: 1, py: 0.75, typography: 'body2', color: 'text.secondary' }}
      >
        {t('task.otherList')}
      </Box>
    );
  }

  return (
    <>
      <ButtonBase
        aria-label={t('task.listValue', { list: current })}
        aria-haspopup="menu"
        disabled={readOnly}
        onClick={(event) => setAnchor(event.currentTarget)}
        sx={{
          gap: 1,
          px: 1,
          py: 0.75,
          borderRadius: 1,
          minWidth: 0,
          typography: 'body2',
          color: 'text.secondary',
          '&:hover': { bgcolor: 'action.hover', color: 'text.primary' },
        }}
      >
        {list && <ListMark list={list} />}
        <Box
          component="span"
          sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >
          {current}
        </Box>
        {!readOnly && <ChevronUpIcon sx={{ fontSize: 16 }} />}
      </ButtonBase>
      <Menu
        anchorEl={anchor}
        open={anchor !== null}
        onClose={() => setAnchor(null)}
        {...UPWARD}
        slotProps={{ paper: { sx: { maxHeight: 420, minWidth: 220 } } }}
      >
        {lists.map((each) => (
          <MenuItem key={each.id} selected={each.id === task.listId} onClick={() => move(each.id)}>
            <ListItemIcon>
              <ListMark list={each} />
            </ListItemIcon>
            <ListItemText>{listName(each, workspace)}</ListItemText>
            <Check on={each.id === task.listId} />
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}

function PriorityPicker({ task }: { task: Task }) {
  const theme = useTheme();
  const apply = useApply();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const readOnly = useReadOnly();
  const color = (priority: Priority) =>
    priority === 0
      ? theme.palette.text.secondary
      : theme.pecklist.priority[PRIORITY_KEY[priority]].fill;
  const name = t('task.priorityValue', { priority: t(`priority.${task.priority}`) });

  return (
    <>
      <Tooltip title={name} describeChild>
        <IconButton
          aria-label={name}
          aria-haspopup="menu"
          disabled={readOnly}
          onClick={(event) => setAnchor(event.currentTarget)}
          sx={{ color: color(task.priority), '&.Mui-disabled': { color: color(task.priority) } }}
        >
          <FlagIcon fontSize="small" filled={task.priority !== 0} />
        </IconButton>
      </Tooltip>
      <Menu
        anchorEl={anchor}
        open={anchor !== null}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
        transformOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        slotProps={{ paper: { sx: { minWidth: 180 } } }}
      >
        {PRIORITIES.map((priority) => (
          <MenuItem
            key={priority}
            selected={priority === task.priority}
            onClick={() => {
              setAnchor(null);
              if (priority !== task.priority) {
                apply((ctx, ws) => updateTask(ctx, ws, task.id, { priority }));
              }
            }}
          >
            <ListItemIcon sx={{ color: color(priority) }}>
              <FlagIcon fontSize="small" filled={priority !== 0} />
            </ListItemIcon>
            <ListItemText>{t(`priority.${priority}`)}</ListItemText>
            <Check on={priority === task.priority} />
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}
