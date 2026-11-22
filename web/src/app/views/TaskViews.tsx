import { pinnedFirst } from '../../core/tasks.ts';
import { groupDeleted } from './closedGroups.ts';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import { Box, Button, Typography } from '@mui/material';
import { useState } from 'react';
import { localTimeZone } from '../../core/dates.ts';
import { findInbox } from '../../core/lists.ts';
import {
  completedOn,
  todayGroups,
  trashedTasks,
  undatedPinned,
  upcomingTasks,
} from '../../core/queries.ts';
import { ALL_TASKS } from '../../core/filters.ts';
import { restoreTask } from '../../core/tasks.ts';
import { purgeDaysOf } from '../../core/settings.ts';
import { emptyTrash, mayErase, purgeTask } from '../../core/trash.ts';
import type { Task, WorkspaceFile } from '../../core/types.ts';
import { ConfirmDialog } from '../lists/ListDialog.tsx';
import { purgePeriod } from '../settings/purgePeriod.ts';
import { useNow, useToday } from '../hooks/useToday.ts';
import { t } from '../i18n/i18n.ts';
import { Page } from '../layout/Page.tsx';
import { useApply, useStoreState, useWorkspace } from '../store/hooks.ts';
import { AddTaskInput, AddToInbox } from '../tasks/AddTaskInput.tsx';
import { TaskTree } from '../tasks/TaskTree.tsx';
import { useNoteEmpty } from './emptyMarkPlays.ts';
import { EmptyState } from './EmptyState.tsx';
import { GroupSection } from './GroupSection.tsx';
import { TrashRow } from './TrashRow.tsx';
import { hasOwnDate, weekdayName } from './dayLabels.ts';
import {
  CompletedGroup,
  FilteredTasks,
  GroupedTasks,
  PinnedGroup,
  PostponeButton,
} from './groups.tsx';
import { SortGroupButton } from './SortGroupButton.tsx';
import { useRowDensity } from './useRowDensity.ts';
import { CompactRowsContext } from '../layout/rowLayout.ts';
import { AgendaView } from './AgendaView.tsx';
import { TaskDragProvider } from '../tasks/drag/TaskDrag.tsx';
import { useNarrowed } from './useNarrowed.tsx';
import { useListView, type ListViewSettings } from '../lists/listGrouping.ts';
import { inOrder, orderTasks, VIEW_GROUPINGS } from '../../core/listView.ts';

/** Overdue and today, without the pinned tasks (they head the view, in Pinned). */
function OverdueAndToday({
  today,
  view,
  source,
}: {
  today: string;
  view: ListViewSettings;
  /** The tasks to draw from (narrowed by the view's filter) */
  source: WorkspaceFile;
}) {
  const all = todayGroups(source, today);
  const groups = {
    overdue: orderTasks(pinnedFirst(all.overdue).rest, view.sort, view.sortReversed),
    today: orderTasks(pinnedFirst(all.today).rest, view.sort, view.sortReversed),
  };
  const overdue = groups.overdue.length > 0 && (
    <GroupSection
      key="overdue"
      groupKey="overdue"
      title={t('group.overdue')}
      count={groups.overdue.length}
      actions={<PostponeButton tasks={groups.overdue} today={today} />}
    >
      <TaskTree tasks={groups.overdue} showList ownPlace={hasOwnDate} dragZone={{ group: null }} />
    </GroupSection>
  );
  const todays = groups.today.length > 0 && (
    <GroupSection
      key="today"
      groupKey="today"
      title={t('group.todayWithDay', { weekday: weekdayName(today) })}
      count={groups.today.length}
    >
      <TaskTree
        tasks={groups.today}
        showList
        ownPlace={hasOwnDate}
        dragZone={{ group: { kind: 'date', value: today } }}
      />
    </GroupSection>
  );
  return <TaskDragProvider>{inOrder([overdue, todays], view.groupReversed)}</TaskDragProvider>;
}

function AddForToday({ today }: { today: string }) {
  const workspace = useWorkspace();
  const inbox = findInbox(workspace);
  if (!inbox) return null;
  return (
    <AddTaskInput
      defaults={{
        listId: inbox.id,
        schedule: { start: today, end: null, allDay: true, timeZone: localTimeZone() },
      }}
    />
  );
}

/** Today: a focused copy of Next 7 days with only overdue, today and what got done today. */
export function TodayView() {
  const today = useToday();
  const view = useListView('view:today');
  // Row size: Today's own for now (settings.compactViews), built to widen to other views.
  const density = useRowDensity('view:today');
  const { workspace, button } = useNarrowed('today');
  const groups = todayGroups(workspace, today);
  // Pinned tasks with no date have no day to sit in, so they show in Pinned only.
  const undated = undatedPinned(workspace, today);
  const done = completedOn(workspace, today, localTimeZone());
  // All pecked out once nothing is open or overdue, whatever got done today (R-FB-135). Pinned
  // undated tasks aren't today's work, so they don't count against it.
  const empty = groups.overdue.length === 0 && groups.today.length === 0;
  useNoteEmpty(empty);
  return (
    <Page
      title={t('nav.today')}
      actions={
        <>
          {button}
          <SortGroupButton view={view} groupings={VIEW_GROUPINGS} density={density} />
        </>
      }
    >
      <AddForToday today={today} />
      <CompactRowsContext.Provider value={density.value === 'compact'}>
        {view.grouping === 'date' ? (
          <>
            {empty && <EmptyState title={t('empty.today')} hint={t('empty.today.hint')} />}
            <PinnedGroup
              tasks={pinnedFirst([...groups.overdue, ...groups.today, ...undated]).pinned}
              showList
            />
            <OverdueAndToday today={today} view={view} source={workspace} />
            <CompletedGroup tasks={done} showList />
          </>
        ) : (
          <GroupedTasks
            tasks={[...groups.overdue, ...groups.today]}
            closed={done}
            grouping={view.grouping}
            sort={view.sort}
            reversed={view.sortReversed}
            groupsReversed={view.groupReversed}
            showList
            emptyTitle={t('empty.today')}
            emptyWithClosed
            pinnedOnly={undated}
          />
        )}
      </CompactRowsContext.Provider>
    </Page>
  );
}

/**
 * Upcoming (spec: PL-091): by date it is the agenda, a week strip over every coming day; other
 * groupings show the next 7 days' tasks in those groups.
 */
export function UpcomingView() {
  const today = useToday();
  const view = useListView('view:upcoming');
  const { workspace, button } = useNarrowed('upcoming');
  const actions = (
    <>
      {button}
      <SortGroupButton view={view} groupings={VIEW_GROUPINGS} fixed={['date']} />
    </>
  );
  if (view.grouping === 'date') {
    return (
      <AgendaView
        sort={view.sort}
        reversed={view.sortReversed}
        actions={actions}
        source={workspace}
      />
    );
  }
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
        reversed={view.sortReversed}
        groupsReversed={view.groupReversed}
        showList
        emptyTitle={t('upcoming.empty')}
        pinnedOnly={undatedPinned(workspace, today)}
      />
    </Page>
  );
}

/** All: no filter of its own (the funnel can narrow it). Every open task in date groups, then Completed. */
export function AllView() {
  const view = useListView('view:all');
  const { workspace, button } = useNarrowed('all');
  return (
    <Page
      title={t('nav.all')}
      actions={
        <>
          {button}
          <SortGroupButton view={view} groupings={VIEW_GROUPINGS} />
        </>
      }
    >
      <AddToInbox />
      <FilteredTasks
        filter={ALL_TASKS}
        view={view}
        source={workspace}
        showList
        emptyTitle={t('all.empty')}
      />
    </Page>
  );
}

/** Open tasks assigned to me, directly or through a group (servers only). */
export function AssignedView() {
  const me = useStoreState((state) => state.context().userId);
  const view = useListView('view:assigned');
  const { workspace, button } = useNarrowed('assigned');
  return (
    <Page
      title={t('nav.assigned')}
      actions={
        <>
          {button}
          <SortGroupButton view={view} groupings={VIEW_GROUPINGS} />
        </>
      }
    >
      <FilteredTasks
        filter={{ assignedTo: me }}
        view={view}
        source={workspace}
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
  const { workspace, button } = useNarrowed('shared');
  return (
    <Page
      title={t('nav.shared')}
      actions={
        <>
          {button}
          <SortGroupButton view={view} groupings={VIEW_GROUPINGS} />
        </>
      }
    >
      <FilteredTasks
        filter={{ sharedWith: me }}
        view={view}
        source={workspace}
        showList
        emptyTitle={t('shared.empty')}
      />
    </Page>
  );
}

/** Trash rows shown at first, and added per "Show more" (an import replaced can trash thousands). */
const TRASH_PAGE = 100;

export function TrashView() {
  const workspace = useWorkspace();
  const apply = useApply();
  const today = useToday();
  const now = useNow();
  const me = useStoreState((state) => state.context().userId);
  const tasks = trashedTasks(workspace, now);
  // Only a list's owner erases its trash, so what others own stays apart: Empty trash leaves it.
  const mine = tasks.filter((task) => mayErase(workspace, me, task));
  const others = tasks.filter((task) => !mayErase(workspace, me, task));
  // Deleting forever cannot be undone, so it asks first.
  const [confirm, setConfirm] = useState<'all' | Task | null>(null);
  const [limit, setLimit] = useState(TRASH_PAGE);
  // The groups as far as the rows shown so far reach.
  const groups: { key: string; title: string; total: number; rows: typeof tasks }[] = [];
  let left = limit;
  const groupsOfAll = [
    ...groupDeleted(mine, today),
    ...(others.length > 0 ? [{ key: 'others', title: t('trash.othersLists'), tasks: others }] : []),
  ];
  for (const group of groupsOfAll) {
    if (left <= 0) break;
    const rows = group.tasks.slice(0, left);
    left -= rows.length;
    groups.push({ key: group.key, title: group.title, total: group.tasks.length, rows });
  }
  return (
    <Page
      title={t('nav.trash')}
      {...(mine.length > 0
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
          hint={t('trash.hint', { period: purgePeriod(purgeDaysOf(workspace)) })}
          icon={<DeleteOutlineRounded />}
        />
      ) : (
        <>
          <Typography color="text.secondary" sx={{ px: 1 }}>
            {t('trash.hint', { period: purgePeriod(purgeDaysOf(workspace)) })}
          </Typography>
          {groups.map((group) => (
            <GroupSection
              key={group.key}
              groupKey={`trash:${group.key}`}
              title={group.title}
              count={group.total}
            >
              {group.key === 'others' && (
                <Typography variant="caption" color="text.secondary" sx={{ px: 1 }}>
                  {t('trash.othersListsHint')}
                </Typography>
              )}
              <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
                {group.rows.map((task) => (
                  <li key={task.id}>
                    <TrashRow
                      task={task}
                      onRestore={() =>
                        apply((ctx, ws) => restoreTask(ctx, ws, task.id), t('undo.restored'))
                      }
                      {...(group.key === 'others' ? {} : { onErase: () => setConfirm(task) })}
                    />
                  </li>
                ))}
              </Box>
            </GroupSection>
          ))}
          {tasks.length > limit && (
            <Button size="small" onClick={() => setLimit((current) => current + TRASH_PAGE)}>
              {t('tasks.showMore', { count: Math.min(tasks.length - limit, TRASH_PAGE) })}
            </Button>
          )}
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
