import CheckRounded from '@mui/icons-material/CheckRounded';
import CloseRounded from '@mui/icons-material/CloseRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import DriveFileMoveOutlined from '@mui/icons-material/DriveFileMoveOutlined';
import LocalOfferOutlined from '@mui/icons-material/LocalOfferOutlined';
import {
  Box,
  Button,
  ButtonBase,
  Dialog,
  DialogTitle,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Paper,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import { useState, type ReactNode } from 'react';
import {
  completeTasks,
  dateTasks,
  deleteTasks,
  moveTasks,
  prioritizeTasks,
  toggleTagOnTasks,
  togglePinOnTasks,
} from '../../core/bulk.ts';
import { localTimeZone } from '../../core/dates.ts';
import { visibleLists } from '../../core/lists.ts';
import { canEditList } from '../../core/sharing.ts';
import { visibleTags } from '../../core/tags.ts';
import type { Priority } from '../../core/types.ts';
import { DatePickerPanel } from '../dates/DatePickerPanel.tsx';
import { useToday } from '../hooks/useToday.ts';
import { t } from '../i18n/i18n.ts';
import { CalendarIcon, FlagIcon, PinIcon } from '../icons/icons.tsx';
import { listName } from '../lists/listName.ts';
import { useApply, useStoreState, useWorkspace } from '../store/hooks.ts';
import { useBulkSelect } from './bulkSelect.ts';
import { PropertySheet } from './PropertyRow.tsx';

const PRIORITIES: Priority[] = [3, 2, 1, 0];
const PRIORITY_KEY = { 0: 'none', 1: 'low', 2: 'medium', 3: 'high' } as const;

/**
 * The actions for the picked tasks (spec: R-FB-55), in place of the bottom tabs on a phone and
 * floating at the bottom elsewhere, like TickTick's: complete, date, move, tag, priority, pin and
 * delete. Each acts on every picked task, can be undone, and ends picking.
 */
export function BulkBar({ phone }: { phone: boolean }) {
  const bulk = useBulkSelect();
  const workspace = useWorkspace();
  const apply = useApply();
  const today = useToday();
  const theme = useTheme();
  const me = useStoreState((state) => state.context().userId);
  const [dateAnchor, setDateAnchor] = useState<HTMLElement | null>(null);
  const [tagAnchor, setTagAnchor] = useState<HTMLElement | null>(null);
  const [priorityAnchor, setPriorityAnchor] = useState<HTMLElement | null>(null);
  const [moving, setMoving] = useState(false);
  if (!bulk?.selecting) return null;
  const live = new Set(
    workspace.entities.tasks.filter((task) => !task.deletedAt).map((task) => task.id),
  );
  const ids = [...bulk.picked].filter((id) => live.has(id));
  const none = ids.length === 0;
  // Everything the page shows (R-FB-124): Select all, then Deselect all once it is all picked.
  const onPage = [...bulk.rows].filter((id) => live.has(id));
  const allPicked = onPage.length > 0 && onPage.every((id) => bulk.picked.has(id));
  const changed = t('bulk.changed', { count: ids.length });
  const run = (change: Parameters<typeof apply>[0], undo: string) => {
    apply(change, undo);
    bulk.stop();
  };

  const action = (
    label: string,
    icon: ReactNode,
    onClick: (anchor: HTMLElement) => void,
    color?: string,
  ) => (
    <Tooltip title={label} disableInteractive>
      <span>
        <ButtonBase
          aria-label={label}
          disabled={none}
          onClick={(event) => onClick(event.currentTarget)}
          sx={{
            flexDirection: 'column',
            gap: 0.25,
            minWidth: 44,
            px: 0.5,
            py: 0.5,
            borderRadius: 1.5,
            fontSize: 11,
            color: none ? 'text.disabled' : (color ?? 'text.primary'),
            '&:hover': { bgcolor: 'action.hover' },
          }}
        >
          {icon}
          {phone && label}
        </ButtonBase>
      </span>
    </Tooltip>
  );

  const lists = visibleLists(workspace).filter((list) => canEditList(workspace, me, list.id));
  const tags = visibleTags(workspace);

  return (
    <>
      <Paper
        role="toolbar"
        aria-label={t('bulk.bar')}
        elevation={phone ? 0 : 8}
        square={phone}
        sx={{
          position: 'fixed',
          zIndex: theme.zIndex.appBar + 1,
          ...(phone
            ? {
                left: 0,
                right: 0,
                bottom: 0,
                pb: 'env(safe-area-inset-bottom)',
                borderTop: 1,
                borderColor: 'divider',
              }
            : { left: '50%', transform: 'translateX(-50%)', bottom: 20, borderRadius: 3 }),
          px: 1,
          py: 0.5,
          display: 'flex',
          flexDirection: phone ? 'column' : 'row',
          alignItems: phone ? 'stretch' : 'center',
          gap: phone ? 0 : 1,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 0.5 }}>
          <Tooltip title={t('bulk.stop')}>
            <IconButton size="small" aria-label={t('bulk.stop')} onClick={bulk.stop}>
              <CloseRounded fontSize="small" />
            </IconButton>
          </Tooltip>
          <Typography variant="body2" sx={{ fontWeight: 600, whiteSpace: 'nowrap', pr: 1 }}>
            {t('bulk.count', { count: ids.length })}
          </Typography>
          {onPage.length > 0 && (
            <Button
              size="small"
              onClick={() => bulk.toggle(onPage, !allPicked)}
              sx={{ whiteSpace: 'nowrap', ...(phone ? { ml: 'auto' } : {}) }}
            >
              {allPicked ? t('bulk.deselectAll') : t('bulk.selectAll')}
            </Button>
          )}
        </Box>
        <Box
          sx={{
            display: 'flex',
            justifyContent: phone ? 'space-around' : 'flex-start',
            gap: phone ? 0 : 0.5,
          }}
        >
          {action(t('bulk.complete'), <CheckRounded />, () =>
            run((ctx, ws) => completeTasks(ctx, ws, ids), changed),
          )}
          {action(t('bulk.date'), <CalendarIcon />, setDateAnchor)}
          {action(t('bulk.move'), <DriveFileMoveOutlined />, () => setMoving(true))}
          {action(t('bulk.tag'), <LocalOfferOutlined />, setTagAnchor)}
          {action(t('bulk.priority'), <FlagIcon />, setPriorityAnchor)}
          {action(t('bulk.pin'), <PinIcon />, () =>
            run((ctx, ws) => togglePinOnTasks(ctx, ws, ids), changed),
          )}
          {action(
            t('bulk.delete'),
            <DeleteOutlineRounded />,
            () => run((ctx, ws) => deleteTasks(ctx, ws, ids), changed),
            'error.main',
          )}
        </Box>
      </Paper>

      <PropertySheet label={t('bulk.date')} anchor={dateAnchor} onClose={() => setDateAnchor(null)}>
        {dateAnchor && (
          <DatePickerPanel
            value={null}
            today={today}
            onApply={(value) => {
              setDateAnchor(null);
              run(
                (ctx, ws) => dateTasks(ctx, ws, ids, value?.date ?? null, localTimeZone()),
                changed,
              );
            }}
            onCancel={() => setDateAnchor(null)}
          />
        )}
      </PropertySheet>

      <Menu anchorEl={tagAnchor} open={tagAnchor !== null} onClose={() => setTagAnchor(null)}>
        {tags.length === 0 && <MenuItem disabled>{t('bulk.noTags')}</MenuItem>}
        {tags.map((tag) => (
          <MenuItem
            key={tag.id}
            onClick={() => {
              setTagAnchor(null);
              run((ctx, ws) => toggleTagOnTasks(ctx, ws, ids, tag.id), changed);
            }}
          >
            <ListItemIcon>
              <Box
                sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: tag.color, ml: 0.5 }}
              />
            </ListItemIcon>
            {tag.name}
          </MenuItem>
        ))}
      </Menu>

      <Menu
        anchorEl={priorityAnchor}
        open={priorityAnchor !== null}
        onClose={() => setPriorityAnchor(null)}
      >
        {PRIORITIES.map((priority) => (
          <MenuItem
            key={priority}
            onClick={() => {
              setPriorityAnchor(null);
              run((ctx, ws) => prioritizeTasks(ctx, ws, ids, priority), changed);
            }}
          >
            <ListItemIcon>
              <FlagIcon
                filled={priority > 0}
                fontSize="small"
                sx={{ color: theme.punchlist.priority[PRIORITY_KEY[priority]].on }}
              />
            </ListItemIcon>
            {t(`priority.${priority}`)}
          </MenuItem>
        ))}
      </Menu>

      <Dialog open={moving} onClose={() => setMoving(false)} fullWidth maxWidth="xs">
        <DialogTitle sx={{ pb: 1 }}>{t('bulk.moveTitle', { count: ids.length })}</DialogTitle>
        <List sx={{ pt: 0, maxHeight: '60dvh', overflowY: 'auto' }}>
          {lists.map((list) => (
            <ListItemButton
              key={list.id}
              onClick={() => {
                setMoving(false);
                const name = listName(list, workspace);
                run(
                  (ctx, ws) => moveTasks(ctx, ws, ids, list.id),
                  t('undo.movedTo', { list: name }),
                );
              }}
            >
              <ListItemIcon sx={{ minWidth: 28 }}>
                <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: list.color }} />
              </ListItemIcon>
              <ListItemText primary={listName(list, workspace)} />
            </ListItemButton>
          ))}
        </List>
      </Dialog>
    </>
  );
}
