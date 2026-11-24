import CloseRounded from '@mui/icons-material/CloseRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import { Box, Button, IconButton, Stack, Toolbar, Typography } from '@mui/material';
import { useState } from 'react';
import { getEntity } from '../../core/collections.ts';
import { trashedSubtasksOf } from '../../core/queries.ts';
import { restoreTask } from '../../core/tasks.ts';
import { mayErase, purgeTask } from '../../core/trash.ts';
import type { Task } from '../../core/types.ts';
import { NotesEditor } from '../editor/NotesEditor.tsx';
import { formatDay } from '../format.ts';
import { useToday } from '../hooks/useToday.ts';
import { t } from '../i18n/i18n.ts';
import { ConfirmDialog } from '../lists/ListDialog.tsx';
import { listName } from '../lists/listName.ts';
import { useApply, useStoreState, useWorkspace } from '../store/hooks.ts';
import { TaskReadOnly } from './readOnly.ts';

/**
 * A task in the Trash, opened from its row (Ben, rc.3: a click opens it, as in the other views).
 * Nothing changes here while it is deleted: it shows what it holds (title, list, notes, the
 * subtasks that went with it), and Restore, which turns this into the task's usual details, or
 * Delete forever, which asks first and then closes.
 */
export function TrashedDetail({ task, onClose }: { task: Task; onClose: () => void }) {
  const workspace = useWorkspace();
  const apply = useApply();
  const today = useToday();
  const me = useStoreState((state) => state.context().userId);
  const [confirming, setConfirming] = useState(false);
  const list = getEntity(workspace, 'lists', task.listId);
  const title = task.title || t('task.untitled');
  const subtasks = trashedSubtasksOf(workspace, task);

  return (
    <TaskReadOnly value>
      <Box
        component="section"
        aria-label={t('task.details')}
        sx={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}
      >
        <Toolbar disableGutters sx={{ gap: 0.5, px: 2, flexShrink: 0 }}>
          <Box sx={{ display: 'flex', color: 'text.disabled' }} aria-hidden>
            <DeleteOutlineRounded fontSize="small" />
          </Box>
          <Typography variant="body2" color="text.secondary" sx={{ flexGrow: 1, minWidth: 0 }}>
            {t('trash.deletedOn', { date: formatDay(task.deletedAt!.slice(0, 10), today) })}
          </Typography>
          <IconButton aria-label={t('common.close')} onClick={onClose}>
            <CloseRounded />
          </IconButton>
        </Toolbar>
        <Stack spacing={2} sx={{ flexGrow: 1, minHeight: 0, overflowY: 'auto', px: 2, pb: 2 }}>
          <Box
            sx={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              columnGap: 1,
              rowGap: 1,
              p: 1.5,
              borderRadius: 1,
              bgcolor: 'action.hover',
            }}
          >
            <Typography variant="body2" sx={{ flexGrow: 1, minWidth: 160 }}>
              {t('trash.detailNotice')}
            </Typography>
            <Box sx={{ display: 'flex', gap: 1 }}>
              {mayErase(workspace, me, task) && (
                <Button size="small" color="error" onClick={() => setConfirming(true)}>
                  {t('trash.deleteForever')}
                </Button>
              )}
              <Button
                size="small"
                variant="contained"
                disableElevation
                onClick={() =>
                  apply((ctx, ws) => restoreTask(ctx, ws, task.id), t('undo.restored'))
                }
              >
                {t('task.restore')}
              </Button>
            </Box>
          </Box>
          <Box>
            <Typography
              variant="h6"
              component="h2"
              sx={{
                overflowWrap: 'anywhere',
                color: task.title ? 'text.primary' : 'text.secondary',
              }}
            >
              {title}
            </Typography>
            {list && (
              <Typography variant="body2" color="text.secondary">
                {listName(list, workspace)}
              </Typography>
            )}
          </Box>
          {task.notes && (
            <NotesEditor
              key={task.id}
              title={task.title}
              label={t('task.notes')}
              placeholder=""
              value={task.notes}
              readOnly
              onCommit={() => {}}
            />
          )}
          {subtasks.length > 0 && (
            <Box component="section" aria-label={t('task.subtasksHeading')}>
              <Typography variant="subtitle2" component="h3" sx={{ mb: 0.5 }}>
                {t('task.subtasksHeading')}
              </Typography>
              <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
                {subtasks.map((subtask) => (
                  <Box
                    component="li"
                    key={subtask.id}
                    sx={{
                      py: 0.5,
                      borderBottom: 1,
                      borderColor: 'divider',
                      overflowWrap: 'anywhere',
                      color: subtask.status === 'open' ? 'text.primary' : 'text.secondary',
                      textDecoration: subtask.status === 'open' ? 'none' : 'line-through',
                    }}
                  >
                    {subtask.title || t('task.untitled')}
                  </Box>
                ))}
              </Box>
            </Box>
          )}
        </Stack>
      </Box>
      {confirming && (
        <ConfirmDialog
          open
          message={t('trash.deleteForeverConfirm', { title })}
          confirmLabel={t('trash.deleteForever')}
          onClose={() => setConfirming(false)}
          onConfirm={() => {
            // The details close once it is gone (TaskDetail).
            apply((ctx, ws) => purgeTask(ctx, ws, task.id));
            setConfirming(false);
          }}
        />
      )}
    </TaskReadOnly>
  );
}
