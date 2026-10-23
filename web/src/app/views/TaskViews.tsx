import { pinnedFirst } from '../../core/tasks.ts';
import { groupClosed } from './closedGroups.ts';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import DeleteForeverOutlined from '@mui/icons-material/DeleteForeverOutlined';
import RestoreRounded from '@mui/icons-material/RestoreRounded';
import {
  Box,
  Button,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Tooltip,
  Typography,
} from '@mui/material';
import { useState } from 'react';
import { getEntity } from '../../core/collections.ts';
import { localTimeZone } from '../../core/dates.ts';
import { inboxList } from '../../core/lists.ts';
import {
  completedOn,
  completedTasks,
  todayGroups,
  trashedTasks,
  upcomingTasks,
} from '../../core/queries.ts';
import { ALL_TASKS } from '../../core/filters.ts';
import { restoreTask } from '../../core/tasks.ts';
import { emptyTrash, purgeTask } from '../../core/trash.ts';
import type { Task } from '../../core/types.ts';
import { ConfirmDialog } from '../lists/ListDialog.tsx';
import { formatDay } from '../format.ts';
import { useNow, useToday } from '../hooks/useToday.ts';
import { t } from '../i18n/i18n.ts';
import { Page } from '../layout/Page.tsx';
import { listName } from '../lists/listName.ts';
import { useApply, useStoreState, useWorkspace } from '../store/hooks.ts';
import { AddTaskInput } from '../tasks/AddTaskInput.tsx';
import { TaskRows } from '../tasks/TaskRow.tsx';
import { TaskTree } from '../tasks/TaskTree.tsx';
import { EmptyState } from './EmptyState.tsx';
import { GroupSection } from './GroupSection.tsx';
import { dayTitle, hasOwnDate, weekdayName } from './dayLabels.ts';
import { CompletedGroup, DateGroupedTasks, PinnedGroup, PostponeButton } from './groups.tsx';

/** Overdue (with Postpone) and today's groups, shared by Today and Next 7 days. */
/** Overdue and today, without the pinned tasks (they head the view, in Pinned). */
function OverdueAndToday({ today }: { today: string }) {
  const workspace = useWorkspace();
  const all = todayGroups(workspace, today);
  const groups = { overdue: pinnedFirst(all.overdue).rest, today: pinnedFirst(all.today).rest };
  return (
    <>
      {groups.overdue.length > 0 && (
        <GroupSection
          title={t('group.overdue')}
          count={groups.overdue.length}
          actions={<PostponeButton tasks={groups.overdue} today={today} />}
        >
          <TaskTree tasks={groups.overdue} showList ownPlace={hasOwnDate} />
        </GroupSection>
      )}
      {groups.today.length > 0 && (
        <GroupSection
          title={t('group.todayWithDay', { weekday: weekdayName(today) })}
          count={groups.today.length}
        >
          <TaskTree tasks={groups.today} showList ownPlace={hasOwnDate} />
        </GroupSection>
      )}
    </>
  );
}

function AddForToday({ today }: { today: string }) {
  const workspace = useWorkspace();
  return (
    <AddTaskInput
      defaults={{
        listId: inboxList(workspace).id,
        schedule: { start: today, end: null, allDay: true, timeZone: localTimeZone() },
      }}
    />
  );
}

/** Today: a focused copy of Next 7 days with only overdue, today and what got done today. */
export function TodayView() {
  const workspace = useWorkspace();
  const today = useToday();
  const groups = todayGroups(workspace, today);
  const done = completedOn(workspace, today, localTimeZone());
  const empty = groups.overdue.length === 0 && groups.today.length === 0 && done.length === 0;
  return (
    <Page title={t('nav.today')}>
      <AddForToday today={today} />
      {empty && <EmptyState title={t('empty.today')} hint={t('empty.today.hint')} />}
      <PinnedGroup tasks={pinnedFirst([...groups.overdue, ...groups.today]).pinned} showList />
      <OverdueAndToday today={today} />
      <CompletedGroup tasks={done} showList />
    </Page>
  );
}

/** Next 7 days: overdue and today first, then one group per day. */
export function UpcomingView() {
  const workspace = useWorkspace();
  const today = useToday();
  const groups = upcomingTasks(workspace, today);
  const current = todayGroups(workspace, today);
  const empty = groups.length === 0 && current.overdue.length === 0 && current.today.length === 0;
  return (
    <Page title={t('nav.upcoming')}>
      <AddForToday today={today} />
      {empty && <EmptyState title={t('upcoming.empty')} />}
      <PinnedGroup
        tasks={
          pinnedFirst([
            ...current.overdue,
            ...current.today,
            ...groups.flatMap((group) => group.tasks),
          ]).pinned
        }
        showList
      />
      <OverdueAndToday today={today} />
      {groups.map((group) => {
        const tasks = pinnedFirst(group.tasks).rest;
        return (
          tasks.length > 0 && (
            <GroupSection key={group.date} title={dayTitle(group.date, today)} count={tasks.length}>
              <TaskTree tasks={tasks} showList ownPlace={hasOwnDate} />
            </GroupSection>
          )
        );
      })}
    </Page>
  );
}

/** All: no filter at all. Every open task in date groups, then Completed. */
export function AllView() {
  const workspace = useWorkspace();
  return (
    <Page title={t('nav.all')}>
      <AddTaskInput defaults={{ listId: inboxList(workspace).id }} />
      <DateGroupedTasks filter={ALL_TASKS} showList emptyTitle={t('all.empty')} />
    </Page>
  );
}

/** Open tasks assigned to me, directly or through a group (servers only). */
export function AssignedView() {
  const me = useStoreState((state) => state.context().userId);
  return (
    <Page title={t('nav.assigned')}>
      <DateGroupedTasks filter={{ assignedTo: me }} showList emptyTitle={t('assigned.empty')} />
    </Page>
  );
}

/** Open tasks others shared with me: their lists, or assigned to me from lists I cannot see. */
export function SharedView() {
  const me = useStoreState((state) => state.context().userId);
  return (
    <Page title={t('nav.shared')}>
      <DateGroupedTasks filter={{ sharedWith: me }} showList emptyTitle={t('shared.empty')} />
    </Page>
  );
}

export function CompletedView() {
  const workspace = useWorkspace();
  const today = useToday();
  const tasks = completedTasks(workspace);
  return (
    <Page title={t('nav.completed')}>
      {tasks.length === 0 ? (
        <EmptyState title={t('completed.empty')} />
      ) : (
        groupClosed(tasks, today).map((group) => (
          <GroupSection
            key={group.key}
            title={group.title || t('group.noDate')}
            count={group.tasks.length}
          >
            <TaskRows tasks={group.tasks} showList />
          </GroupSection>
        ))
      )}
    </Page>
  );
}

export function TrashView() {
  const workspace = useWorkspace();
  const apply = useApply();
  const today = useToday();
  const now = useNow();
  const tasks = trashedTasks(workspace, now);
  // Deleting forever cannot be undone, so it asks first.
  const [confirm, setConfirm] = useState<'all' | Task | null>(null);
  return (
    <Page
      title={t('nav.trash')}
      {...(tasks.length > 0
        ? {
            actions: (
              <Button color="error" onClick={() => setConfirm('all')}>
                {t('trash.emptyAction')}
              </Button>
            ),
          }
        : {})}
    >
      {tasks.length === 0 ? (
        <EmptyState
          title={t('trash.empty')}
          hint={t('trash.hint')}
          icon={<DeleteOutlineRounded />}
        />
      ) : (
        <>
          <Typography color="text.secondary" sx={{ px: 1 }}>
            {t('trash.hint')}
          </Typography>
          <List>
            {tasks.map((task) => {
              const list = getEntity(workspace, 'lists', task.listId);
              return (
                <ListItem
                  key={task.id}
                  divider
                  secondaryAction={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <Button
                        size="small"
                        startIcon={<RestoreRounded />}
                        onClick={() =>
                          apply((ctx, ws) => restoreTask(ctx, ws, task.id), t('undo.restored'))
                        }
                      >
                        {t('task.restore')}
                      </Button>
                      <Tooltip title={t('trash.deleteForever')}>
                        <IconButton
                          size="small"
                          aria-label={t('trash.deleteForeverOf', {
                            title: task.title || t('task.untitled'),
                          })}
                          onClick={() => setConfirm(task)}
                        >
                          <DeleteForeverOutlined fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Box>
                  }
                >
                  <ListItemText
                    primary={task.title || t('task.untitled')}
                    secondary={[
                      list && listName(list, workspace),
                      t('trash.deletedOn', {
                        date: formatDay(task.deletedAt!.slice(0, 10), today),
                      }),
                    ]
                      .filter(Boolean)
                      .join(' . ')}
                  />
                </ListItem>
              );
            })}
          </List>
        </>
      )}
      {confirm && (
        <ConfirmDialog
          open
          message={
            confirm === 'all'
              ? t('trash.emptyConfirm')
              : t('trash.deleteForeverConfirm', { title: confirm.title || t('task.untitled') })
          }
          confirmLabel={confirm === 'all' ? t('trash.emptyAction') : t('trash.deleteForever')}
          onClose={() => setConfirm(null)}
          onConfirm={() => {
            apply((ctx, ws) =>
              confirm === 'all' ? emptyTrash(ctx, ws) : purgeTask(ctx, ws, confirm.id),
            );
            setConfirm(null);
          }}
        />
      )}
    </Page>
  );
}
