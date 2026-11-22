import DeleteForeverOutlined from '@mui/icons-material/DeleteForeverOutlined';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import RestoreRounded from '@mui/icons-material/RestoreRounded';
import { Box, IconButton, Tooltip, Typography, useMediaQuery, useTheme } from '@mui/material';
import { getEntity } from '../../core/collections.ts';
import type { Task } from '../../core/types.ts';
import { formatDay } from '../format.ts';
import { useToday } from '../hooks/useToday.ts';
import { t } from '../i18n/i18n.ts';
import { listName } from '../lists/listName.ts';
import { useWorkspace } from '../store/hooks.ts';

/**
 * A deleted task in the Trash, laid out like a task row in the other views (TaskRow): the same
 * height, spacing, divider and list stripe, a trash mark where the checkbox sits, its list and
 * when it was deleted where a row's details and date go, then Restore and Delete forever. Phones
 * put the list and day on a line under the title, as their task rows do.
 */
export function TrashRow({
  task,
  onRestore,
  onErase,
}: {
  task: Task;
  onRestore: () => void;
  /** Absent when this person may not erase it (a list someone else owns). */
  onErase?: () => void;
}) {
  const workspace = useWorkspace();
  const today = useToday();
  const theme = useTheme();
  const twoLine = useMediaQuery(theme.breakpoints.down('sm'), { noSsr: true });
  const list = getEntity(workspace, 'lists', task.listId);
  const title = task.title || t('task.untitled');
  const where = list ? listName(list, workspace) : null;
  const deleted = t('trash.deletedOn', { date: formatDay(task.deletedAt!.slice(0, 10), today) });

  const actions = (
    <Box sx={{ display: 'flex', alignItems: 'center', flexShrink: 0, pr: 0.5 }}>
      <Tooltip title={t('task.restore')}>
        <IconButton
          size="small"
          aria-label={t('task.restore')}
          onClick={onRestore}
          sx={{ color: 'text.secondary' }}
        >
          <RestoreRounded fontSize="small" />
        </IconButton>
      </Tooltip>
      {onErase && (
        <Tooltip title={t('trash.deleteForever')}>
          <IconButton
            size="small"
            aria-label={t('trash.deleteForeverOf', { title })}
            onClick={onErase}
            sx={{ color: 'text.secondary' }}
          >
            <DeleteForeverOutlined fontSize="small" />
          </IconButton>
        </Tooltip>
      )}
    </Box>
  );

  return (
    <Box
      sx={{
        position: 'relative',
        display: 'flex',
        alignItems: twoLine ? 'flex-start' : 'center',
        minHeight: 40,
        pl: '4px',
        borderBottom: 1,
        borderColor: 'divider',
        '&:hover': { bgcolor: 'action.hover' },
        // The list's color as a thin stripe on the left edge, as on a task row.
        '&::before': {
          content: '""',
          position: 'absolute',
          left: 0,
          top: 4,
          bottom: 4,
          width: 3,
          borderRadius: 2,
          bgcolor: list && !list.isInbox ? list.color : 'transparent',
        },
      }}
    >
      {/* Where a task row's checkbox sits, the same size, so the titles line up. */}
      <Box
        aria-hidden
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 30,
          height: 30,
          flexShrink: 0,
          mt: twoLine ? 0.5 : 0,
          color: 'text.disabled',
        }}
      >
        <DeleteOutlineRounded sx={{ fontSize: 18 }} />
      </Box>
      {twoLine ? (
        <Box sx={{ flexGrow: 1, minWidth: 0, py: 1, pr: 0.5 }}>
          <Typography
            sx={{
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              overflowWrap: 'anywhere',
            }}
          >
            {title}
          </Typography>
          <Box
            sx={{
              display: 'flex',
              flexWrap: 'wrap',
              columnGap: 1.25,
              mt: 0.25,
              typography: 'body2',
              fontSize: '0.8125rem',
              color: 'text.secondary',
            }}
          >
            {where && <Box component="span">{where}</Box>}
            <Box component="span">{deleted}</Box>
          </Box>
        </Box>
      ) : (
        <Box
          sx={{
            flexGrow: 1,
            minWidth: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 1.5,
            py: 1,
            pr: 1.5,
          }}
        >
          <Typography noWrap title={title} sx={{ flexGrow: 1, minWidth: 0 }}>
            {title}
          </Typography>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1.25,
              flexShrink: 0,
              typography: 'body2',
              color: 'text.secondary',
            }}
          >
            {/* A long list name gives way to the title rather than pushing it out. */}
            {where && (
              <Box
                component="span"
                title={where}
                sx={{
                  maxWidth: 160,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {where}
              </Box>
            )}
            <Box component="span">{deleted}</Box>
          </Box>
        </Box>
      )}
      {twoLine ? <Box sx={{ alignSelf: 'center' }}>{actions}</Box> : actions}
    </Box>
  );
}
