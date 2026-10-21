import { groupClosed } from './closedGroups.ts';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import RestoreRounded from '@mui/icons-material/RestoreRounded';
import { Button, List, ListItem, ListItemText, Typography } from '@mui/material';
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
import { formatDay } from '../format.ts';
import { useNow, useToday } from '../hooks/useToday.ts';
import { t } from '../i18n/i18n.ts';
import { Page } from '../layout/Page.tsx';
import { listName } from '../lists/listName.ts';
import { useApply, useWorkspace } from '../store/hooks.ts';
import { AddTaskInput } from '../tasks/AddTaskInput.tsx';
import { TaskRows } from '../tasks/TaskRow.tsx';
import { TaskTree } from '../tasks/TaskTree.tsx';
import { EmptyState } from './EmptyState.tsx';
import { GroupSection } from './GroupSection.tsx';
import { dayTitle, hasOwnDate, weekdayName } from './dayLabels.ts';
import { CompletedGroup, DateGroupedTasks, PostponeButton } from './groups.tsx';

/** Overdue (with Postpone) and today's groups, shared by Today and Next 7 days. */
function OverdueAndToday({ today }: { today: string }) {
  const workspace = useWorkspace();
  const groups = todayGroups(workspace, today);
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
      <OverdueAndToday today={today} />
      {groups.map((group) => (
        <GroupSection
          key={group.date}
          title={dayTitle(group.date, today)}
          count={group.tasks.length}
        >
          <TaskTree tasks={group.tasks} showList ownPlace={hasOwnDate} />
        </GroupSection>
      ))}
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
  return (
    <Page title={t('nav.trash')}>
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
                    <Button
                      size="small"
                      startIcon={<RestoreRounded />}
                      onClick={() =>
                        apply((ctx, ws) => restoreTask(ctx, ws, task.id), t('undo.restored'))
                      }
                    >
                      {t('task.restore')}
                    </Button>
                  }
                >
                  <ListItemText
                    primary={task.title || t('task.untitled')}
                    secondary={[
                      list && listName(list),
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
    </Page>
  );
}
