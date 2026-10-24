import { pinnedFirst } from '../../core/tasks.ts';
import { Button } from '@mui/material';
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
import { useState } from 'react';
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
import { dayTitle, hasOwnDate, weekdayName } from './dayLabels.ts';
import { EmptyState } from './EmptyState.tsx';
import { GroupSection } from './GroupSection.tsx';

const COMPLETED_PREVIEW = 5;

/** Completed group: the first few tasks, then "View more". */
export function CompletedGroup({
  tasks,
  showList,
  defaultOpen = true,
}: {
  tasks: Task[];
  showList?: boolean;
  defaultOpen?: boolean;
}) {
  const [all, setAll] = useState(false);
  if (tasks.length === 0) return null;
  const shown = all ? tasks : tasks.slice(0, COMPLETED_PREVIEW);
  const expanded = all && tasks.length > COMPLETED_PREVIEW;
  return (
    <GroupSection
      groupKey="completed"
      title={t('group.completed')}
      count={tasks.length}
      defaultOpen={defaultOpen}
      // In the header, so it is easy to reach at the top of a long list.
      {...(expanded
        ? {
            actions: (
              <Button size="small" onClick={() => setAll(false)}>
                {t('group.viewLess')}
              </Button>
            ),
          }
        : {})}
    >
      <TaskRows tasks={shown} {...(showList === undefined ? {} : { showList })} />
      {!all && tasks.length > COMPLETED_PREVIEW && (
        <Button
          size="small"
          color="inherit"
          sx={{ mt: 0.5, color: 'text.secondary' }}
          onClick={() => setAll(true)}
        >
          {t('group.viewMore')}
        </Button>
      )}
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
      <TaskTree tasks={tasks} showList={showList} />
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
  return (
    <>
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
          />
        </GroupSection>
      ))}
      <CompletedGroup tasks={closed} showList={showList} />
    </>
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
}: {
  tasks: readonly Task[];
  closed: Task[];
  grouping: Exclude<ListGrouping, 'date'>;
  sort: ListSort;
  reversed?: boolean;
  groupsReversed?: boolean;
  showList?: boolean;
  emptyTitle: string;
}) {
  const workspace = useWorkspace();
  const { pinned, rest } = pinnedFirst(tasks);
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
  return (
    <>
      {open.length === 0 && pinned.length === 0 && closed.length === 0 && (
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
              <TaskTree tasks={group.tasks} showList={showList && grouping !== 'list'} />
            </GroupSection>
          ))
        : open.length > 0 && <TaskTree tasks={open} showList={showList} />}
      <CompletedGroup tasks={closed} showList={showList} />
    </>
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
