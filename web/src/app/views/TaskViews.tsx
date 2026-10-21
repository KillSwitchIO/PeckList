import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import RestoreRounded from '@mui/icons-material/RestoreRounded';
import { Button, List, ListItem, ListItemText, Typography } from '@mui/material';
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
import { rescheduleTo, restoreTask } from '../../core/tasks.ts';
import type { Task } from '../../core/types.ts';
import { formatDay } from '../format.ts';
import { useNow, useToday } from '../hooks/useToday.ts';
import { t } from '../i18n/i18n.ts';
import { Page } from '../layout/Page.tsx';
import { listName } from '../lists/listName.ts';
import { useApply, useWorkspace } from '../store/hooks.ts';
import { AddTaskInput } from '../tasks/AddTaskInput.tsx';
import { TaskRows, type RowDateFormat } from '../tasks/TaskRow.tsx';
import { EmptyState } from './EmptyState.tsx';
import { GroupSection } from './GroupSection.tsx';

/** Long weekday name of a local date, e.g. "Tuesday". */
function weekdayName(date: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Intl.DateTimeFormat(undefined, { weekday: 'long', timeZone: 'UTC' }).format(
    new Date(Date.UTC(y, m - 1, d, 12)),
  );
}

const COMPLETED_PREVIEW = 5;

/** Completed group: the first few tasks, then "View more". */
export function CompletedGroup({
  tasks,
  showList,
  dateFormat,
  defaultOpen = true,
}: {
  tasks: Task[];
  showList?: boolean;
  dateFormat?: RowDateFormat;
  defaultOpen?: boolean;
}) {
  const [all, setAll] = useState(false);
  if (tasks.length === 0) return null;
  const shown = all ? tasks : tasks.slice(0, COMPLETED_PREVIEW);
  return (
    <GroupSection title={t('group.completed')} count={tasks.length} defaultOpen={defaultOpen}>
      <TaskRows
        tasks={shown}
        {...(showList === undefined ? {} : { showList })}
        {...(dateFormat === undefined ? {} : { dateFormat })}
      />
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

export function TodayView() {
  const workspace = useWorkspace();
  const apply = useApply();
  const today = useToday();
  const zone = localTimeZone();
  const groups = todayGroups(workspace, today);
  const done = completedOn(workspace, today, zone);
  const empty = groups.overdue.length === 0 && groups.today.length === 0;
  return (
    <Page title={t('nav.today')}>
      <AddTaskInput
        defaults={{
          listId: inboxList(workspace).id,
          schedule: { start: today, end: null, allDay: true, timeZone: zone },
        }}
      />
      {empty && done.length === 0 && (
        <EmptyState title={t('empty.today')} hint={t('empty.today.hint')} />
      )}
      {groups.overdue.length > 0 && (
        <GroupSection
          title={t('group.overdue')}
          count={groups.overdue.length}
          actions={
            <Button
              size="small"
              onClick={() =>
                apply(
                  (ctx, ws) =>
                    rescheduleTo(
                      ctx,
                      ws,
                      groups.overdue.map((task) => task.id),
                      today,
                    ),
                  t('undo.postponed'),
                )
              }
            >
              {t('group.postpone')}
            </Button>
          }
        >
          <TaskRows tasks={groups.overdue} showList />
        </GroupSection>
      )}
      {groups.today.length > 0 && (
        <GroupSection
          title={t('group.todayWithDay', { weekday: weekdayName(today) })}
          count={groups.today.length}
        >
          <TaskRows tasks={groups.today} showList dateFormat="time" />
        </GroupSection>
      )}
      <CompletedGroup tasks={done} showList dateFormat="time" />
    </Page>
  );
}

export function UpcomingView() {
  const workspace = useWorkspace();
  const today = useToday();
  const groups = upcomingTasks(workspace, today);
  return (
    <Page title={t('nav.upcoming')}>
      {groups.length === 0 ? (
        <EmptyState title={t('upcoming.empty')} />
      ) : (
        groups.map((group) => (
          <GroupSection
            key={group.date}
            title={`${weekdayName(group.date)}, ${formatDay(group.date, today)}`}
            count={group.tasks.length}
          >
            <TaskRows tasks={group.tasks} showList dateFormat="time" />
          </GroupSection>
        ))
      )}
    </Page>
  );
}

export function CompletedView() {
  const workspace = useWorkspace();
  const tasks = completedTasks(workspace);
  return (
    <Page title={t('nav.completed')}>
      {tasks.length === 0 ? (
        <EmptyState title={t('completed.empty')} />
      ) : (
        <TaskRows tasks={tasks} showList />
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
