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
import { hasOwnDate, weekdayName } from './dayLabels.ts';
import {
  CompletedGroup,
  FilteredTasks,
  GroupedTasks,
  PinnedGroup,
  PostponeButton,
} from './groups.tsx';
import { SortGroupButton } from './SortGroupButton.tsx';
import { AgendaView } from './AgendaView.tsx';
import { useListView } from '../lists/listGrouping.ts';
import { sortTasks, VIEW_GROUPINGS, type ListSort } from '../../core/listView.ts';

/** Overdue and today, without the pinned tasks (they head the view, in Pinned). */
function OverdueAndToday({ today, sort }: { today: string; sort: ListSort }) {
  const workspace = useWorkspace();
  const all = todayGroups(workspace, today);
  const groups = {
    overdue: ordered(pinnedFirst(all.overdue).rest, sort),
    today: ordered(pinnedFirst(all.today).rest, sort),
  };
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

/** Within a date group: as is, or in the order the person picked. */
function ordered(tasks: Task[], sort: ListSort): Task[] {
  return sort === 'manual' ? tasks : sortTasks(tasks, sort);
}

/** Today: a focused copy of Next 7 days with only overdue, today and what got done today. */
export function TodayView() {
  const workspace = useWorkspace();
  const today = useToday();
  const view = useListView('view:today');
  const groups = todayGroups(workspace, today);
  const done = completedOn(workspace, today, localTimeZone());
  const empty = groups.overdue.length === 0 && groups.today.length === 0 && done.length === 0;
  return (
    <Page
      title={t('nav.today')}
      actions={<SortGroupButton view={view} groupings={VIEW_GROUPINGS} />}
    >
      <AddForToday today={today} />
      {view.grouping === 'date' ? (
        <>
          {empty && <EmptyState title={t('empty.today')} hint={t('empty.today.hint')} />}
          <PinnedGroup tasks={pinnedFirst([...groups.overdue, ...groups.today]).pinned} showList />
          <OverdueAndToday today={today} sort={view.sort} />
          <CompletedGroup tasks={done} showList />
        </>
      ) : (
        <GroupedTasks
          tasks={[...groups.overdue, ...groups.today]}
          closed={done}
          grouping={view.grouping}
          sort={view.sort}
          showList
          emptyTitle={t('empty.today')}
        />
      )}
    </Page>
  );
}

/**
 * Upcoming (spec: PL-091): by date it is the agenda, a week strip over every coming day; other
 * groupings show the next 7 days' tasks in those groups.
 */
export function UpcomingView() {
  const workspace = useWorkspace();
  const today = useToday();
  const view = useListView('view:upcoming');
  const actions = <SortGroupButton view={view} groupings={VIEW_GROUPINGS} />;
  if (view.grouping === 'date') return <AgendaView sort={view.sort} actions={actions} />;
  const groups = upcomingTasks(workspace, today);
  const current = todayGroups(workspace, today);
  return (
    <Page title={t('nav.upcoming')} actions={actions}>
      <AddForToday today={today} />
      <GroupedTasks
        tasks={[...current.overdue, ...current.today, ...groups.flatMap((group) => group.tasks)]}
        closed={[]}
        grouping={view.grouping}
        sort={view.sort}
        showList
        emptyTitle={t('upcoming.empty')}
      />
    </Page>
  );
}

/** All: no filter at all. Every open task in date groups, then Completed. */
export function AllView() {
  const workspace = useWorkspace();
  const view = useListView('view:all');
  return (
    <Page title={t('nav.all')} actions={<SortGroupButton view={view} groupings={VIEW_GROUPINGS} />}>
      <AddTaskInput defaults={{ listId: inboxList(workspace).id }} />
      <FilteredTasks filter={ALL_TASKS} view={view} showList emptyTitle={t('all.empty')} />
    </Page>
  );
}

/** Open tasks assigned to me, directly or through a group (servers only). */
export function AssignedView() {
  const me = useStoreState((state) => state.context().userId);
  const view = useListView('view:assigned');
  return (
    <Page
      title={t('nav.assigned')}
      actions={<SortGroupButton view={view} groupings={VIEW_GROUPINGS} />}
    >
      <FilteredTasks
        filter={{ assignedTo: me }}
        view={view}
        showList
        emptyTitle={t('assigned.empty')}
      />
    </Page>
  );
}

/** Open tasks others shared with me: their lists, or assigned to me from lists I cannot see. */
export function SharedView() {
  const me = useStoreState((state) => state.context().userId);
  const view = useListView('view:shared');
  return (
    <Page
      title={t('nav.shared')}
      actions={<SortGroupButton view={view} groupings={VIEW_GROUPINGS} />}
    >
      <FilteredTasks
        filter={{ sharedWith: me }}
        view={view}
        showList
        emptyTitle={t('shared.empty')}
      />
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
