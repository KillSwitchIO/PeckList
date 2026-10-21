import { Button } from '@mui/material';
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

/**
 * A filter's tasks in date groups (Overdue, Today, Tomorrow, Next 7 days, Later, No date) as
 * task trees, then Completed (the last few, then View more). Used by All, lists and tags.
 */
export function DateGroupedTasks({
  filter,
  showList = false,
  emptyTitle,
}: {
  filter: TaskFilter;
  showList?: boolean;
  emptyTitle: string;
}) {
  const workspace = useWorkspace();
  const today = useToday();
  const groups = groupByDate(workspace, filterTasks(workspace, filter, today), today);
  const closed = filterClosedTasks(workspace, filter, today);
  return (
    <>
      {groups.length === 0 && closed.length === 0 && <EmptyState title={emptyTitle} />}
      {groups.map((group) => (
        <GroupSection
          key={group.key}
          title={groupTitle(group, today)}
          count={group.tasks.length}
          {...(group.key === 'overdue'
            ? { actions: <PostponeButton tasks={group.tasks} today={today} /> }
            : {})}
        >
          <TaskTree tasks={group.tasks} showList={showList} ownPlace={hasOwnDate} />
        </GroupSection>
      ))}
      <CompletedGroup tasks={closed} showList={showList} />
    </>
  );
}
