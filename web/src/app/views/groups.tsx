import { useReveal } from './useReveal.tsx';
import { pinnedFirst } from '../../core/tasks.ts';
import { Button, ListItemText, Menu, MenuItem } from '@mui/material';
import { useState } from 'react';
import { useLongPress } from '../hooks/useLongPress.ts';
import { setHideCompleted, useHideCompleted } from './completedPrefs.ts';
import {
  groupByList,
  groupByPriority,
  groupByTag,
  inOrder,
  orderTasks,
  type ListGrouping,
  type ListSort,
} from '../../core/listView.ts';
import { getEntity } from '../../core/collections.ts';
import { listName } from '../lists/listName.ts';
import type { ListViewSettings } from '../lists/listGrouping.ts';
import {
  filterClosedTasks,
  filterTasks,
  groupByDate,
  type DateGroup,
  type TaskFilter,
} from '../../core/filters.ts';
import { rescheduleTo } from '../../core/tasks.ts';
import type { Task } from '../../core/types.ts';
import { useToday } from '../hooks/useToday.ts';
import { t } from '../i18n/i18n.ts';
import { useApply, useWorkspace } from '../store/hooks.ts';
import { TaskRows } from '../tasks/TaskRow.tsx';
import { TaskTree } from '../tasks/TaskTree.tsx';
import { dateZone, groupZone } from './dragZones.ts';
import { TaskDragProvider } from '../tasks/drag/TaskDrag.tsx';
import { dayTitle, hasOwnDate, weekdayName } from './dayLabels.ts';
import { useNoteEmpty } from './emptyMarkPlays.ts';
import { EmptyState } from './EmptyState.tsx';
import { GroupSection } from './GroupSection.tsx';

/**
 * Completed group: the whole list, drawn as it scrolls near (R-FB-94), so it reads as if all of
 * it were there from the start; no View more (R-FB-115).
 */
export function CompletedGroup({
  tasks,
  showList,
  defaultOpen = true,
}: {
  tasks: Task[];
  showList?: boolean;
  defaultOpen?: boolean;
}) {
  const reveal = useReveal(tasks.length);
  const hidden = useHideCompleted();
  // A long press (or right-click) on the header offers to hide the group (R-FB-159).
  const [menu, setMenu] = useState<{ top: number; left: number } | null>(null);
  const hold = useLongPress(setMenu);
  if (tasks.length === 0 || hidden) return null;
  return (
    <GroupSection
      groupKey="completed"
      title={t('group.completed')}
      count={tasks.length}
      defaultOpen={defaultOpen}
      headerProps={{
        ...hold,
        onContextMenu: (event) => {
          event.preventDefault();
          setMenu({ top: event.clientY, left: event.clientX });
        },
      }}
    >
      <Menu
        open={menu !== null}
        onClose={() => setMenu(null)}
        anchorReference="anchorPosition"
        {...(menu ? { anchorPosition: menu } : {})}
      >
        <MenuItem
          onClick={() => {
            setMenu(null);
            setHideCompleted(true);
          }}
        >
          <ListItemText primary={t('completed.hide')} secondary={t('completed.hideHint')} />
        </MenuItem>
      </Menu>
      <TaskRows
        tasks={tasks.slice(0, reveal.shown)}
        {...(showList === undefined ? {} : { showList })}
      />
      {reveal.spacer}
    </GroupSection>
  );
}

/** Moves every overdue task in a group to today, keeping times. */
export function PostponeButton({ tasks, today }: { tasks: Task[]; today: string }) {
  const apply = useApply();
  return (
    <Button
      size="small"
      onClick={() =>
        apply(
          (ctx, ws) =>
            rescheduleTo(
              ctx,
              ws,
              tasks.filter(hasOwnDate).map((task) => task.id),
              today,
            ),
          t('undo.postponed'),
        )
      }
    >
      {t('group.postpone')}
    </Button>
  );
}

function groupTitle(group: DateGroup, today: string): string {
  switch (group.key) {
    case 'overdue':
      return t('group.overdue');
    case 'today':
      return t('group.todayWithDay', { weekday: weekdayName(today) });
    case 'tomorrow':
      return dayTitle(group.date!, today);
    case 'week':
      return t('group.week');
    case 'later':
      return t('group.later');
    case 'none':
      return t('group.noDate');
  }
}

/** Pinned tasks, on top of a view, oldest pin first (spec: PL-089). */
export function PinnedGroup({ tasks, showList = false }: { tasks: Task[]; showList?: boolean }) {
  if (tasks.length === 0) return null;
  return (
    <GroupSection groupKey="pinned" title={t('group.pinned')} count={tasks.length}>
      {/* Dropping a task here pins it; dragging one out unpins it. */}
      <TaskTree
        tasks={tasks}
        showList={showList}
        dragZone={{ group: { kind: 'pin', value: 'pinned' } }}
      />
    </GroupSection>
  );
}

/**
 * A filter's tasks in date groups (Overdue, Today, Tomorrow, Next 7 days, Later, No date) as
 * task trees, then Completed (the last few, then View more). Pinned ones come first, in their
 * own group. Used by All, lists and tags.
 */
export function DateGroupedTasks({
  filter,
  showList = false,
  emptyTitle,
  sort = 'manual',
  reversed = false,
  groupsReversed = false,
}: {
  filter: TaskFilter;
  showList?: boolean;
  emptyTitle: string;
  /** Within each date group; `manual` keeps the usual (time, priority, then own order). */
  sort?: ListSort;
  /** The sort the other way round */
  reversed?: boolean;
  /** The date groups the other way round (No date and Later first) */
  groupsReversed?: boolean;
}) {
  const workspace = useWorkspace();
  const today = useToday();
  const { pinned, rest } = pinnedFirst(filterTasks(workspace, filter, today));
  const groups = inOrder(groupByDate(workspace, rest, today), groupsReversed);
  const closed = filterClosedTasks(workspace, filter, today);
  useNoteEmpty(groups.length === 0 && pinned.length === 0);
  return (
    <TaskDragProvider>
      {groups.length === 0 && pinned.length === 0 && closed.length === 0 && (
        <EmptyState title={emptyTitle} />
      )}
      <PinnedGroup tasks={pinned} showList={showList} />
      {groups.map((group) => (
        <GroupSection
          key={group.key}
          groupKey={group.key}
          title={groupTitle(group, today)}
          count={group.tasks.length}
          {...(group.key === 'overdue'
            ? { actions: <PostponeButton tasks={group.tasks} today={today} /> }
            : {})}
        >
          <TaskTree
            tasks={orderTasks(group.tasks, sort, reversed)}
            showList={showList}
            ownPlace={hasOwnDate}
            dragZone={dateZone(group, today)}
          />
        </GroupSection>
      ))}
      <CompletedGroup tasks={closed} showList={showList} />
    </TaskDragProvider>
  );
}

/**
 * A view's open tasks grouped another way than by date (priority, tag, list, or none: one sorted
 * run), pinned ones first, then Completed (spec: Views, sort and group options).
 */
export function GroupedTasks({
  tasks,
  closed,
  grouping,
  sort,
  reversed = false,
  groupsReversed = false,
  showList = false,
  emptyTitle,
  emptyWithClosed = false,
  pinnedOnly = [],
}: {
  tasks: readonly Task[];
  closed: Task[];
  grouping: Exclude<ListGrouping, 'date'>;
  sort: ListSort;
  reversed?: boolean;
  groupsReversed?: boolean;
  showList?: boolean;
  emptyTitle: string;
  /** Show the empty mark over closed tasks too: nothing open is enough (Today). */
  emptyWithClosed?: boolean;
  /** Pinned tasks shown in Pinned only, in no other group (undated ones in a date view) */
  pinnedOnly?: readonly Task[];
}) {
  const workspace = useWorkspace();
  const { rest } = pinnedFirst(tasks);
  const { pinned } = pinnedFirst([...tasks, ...pinnedOnly]);
  // Custom order across lists is the view's own: by start date and time, then each list's order.
  const open = orderTasks(rest, sort, reversed);
  const grouped =
    grouping === 'priority'
      ? groupByPriority(open).map((group) => ({
          ...group,
          title: group.priority ? t(`priority.${group.priority}`) : t('list.noPriority'),
        }))
      : grouping === 'tag'
        ? groupByTag(workspace, open).map((group) => ({
            ...group,
            title: group.name ?? t('list.noTags'),
          }))
        : grouping === 'list'
          ? groupByList(workspace, open).map((group) => {
              const list = getEntity(workspace, 'lists', group.listId!);
              return { ...group, title: list ? listName(list, workspace) : (group.name ?? '') };
            })
          : null;
  const groups = grouped && inOrder(grouped, groupsReversed);
  // Every pinned task of `tasks` is in `open` too, so empty means nothing of the view's own is
  // open: pinned undated tasks on top (pinnedOnly) don't stop Today from being pecked out.
  useNoteEmpty(open.length === 0);
  return (
    <TaskDragProvider>
      {open.length === 0 && (emptyWithClosed || closed.length === 0) && (
        <EmptyState title={emptyTitle} />
      )}
      <PinnedGroup tasks={pinned} showList={showList} />
      {groups
        ? groups.map((group) => (
            <GroupSection
              key={group.key}
              groupKey={group.key}
              title={group.title}
              count={group.tasks.length}
            >
              <TaskTree
                tasks={group.tasks}
                showList={showList && grouping !== 'list'}
                dragZone={groupZone(group.key)}
              />
            </GroupSection>
          ))
        : open.length > 0 && (
            <TaskTree tasks={open} showList={showList} dragZone={{ group: null }} />
          )}
      <CompletedGroup tasks={closed} showList={showList} />
    </TaskDragProvider>
  );
}

/** A filter's tasks as the view's sort and group settings say: by date, or another grouping. */
export function FilteredTasks({
  filter,
  view,
  showList = false,
  emptyTitle,
}: {
  filter: TaskFilter;
  view: ListViewSettings;
  showList?: boolean;
  emptyTitle: string;
}) {
  const workspace = useWorkspace();
  const today = useToday();
  if (view.grouping === 'date') {
    return (
      <DateGroupedTasks
        filter={filter}
        showList={showList}
        emptyTitle={emptyTitle}
        sort={view.sort}
        reversed={view.sortReversed}
        groupsReversed={view.groupReversed}
      />
    );
  }
  return (
    <GroupedTasks
      tasks={filterTasks(workspace, filter, today)}
      closed={filterClosedTasks(workspace, filter, today)}
      grouping={view.grouping}
      sort={view.sort}
      reversed={view.sortReversed}
      groupsReversed={view.groupReversed}
      showList={showList}
      emptyTitle={emptyTitle}
    />
  );
}
