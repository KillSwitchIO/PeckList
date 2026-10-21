import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import RestoreRounded from '@mui/icons-material/RestoreRounded';
import { Box, Button, List, ListItem, ListItemText, Typography } from '@mui/material';
import { getEntity } from '../../core/collections.ts';
import { datePart, localTimeZone } from '../../core/dates.ts';
import { inboxList } from '../../core/lists.ts';
import { completedTasks, todayTasks, trashedTasks, upcomingTasks } from '../../core/queries.ts';
import { restoreTask } from '../../core/tasks.ts';
import { formatDay } from '../format.ts';
import { useNow, useToday } from '../hooks/useToday.ts';
import { t } from '../i18n/i18n.ts';
import { AppShell } from '../layout/AppShell.tsx';
import { useApply, useWorkspace } from '../store/hooks.ts';
import { AddTaskInput } from '../tasks/AddTaskInput.tsx';
import { TaskRows } from '../tasks/TaskRow.tsx';
import { EmptyState } from './EmptyState.tsx';

export function GroupHeading({ children }: { children: React.ReactNode }) {
  return (
    <Typography
      variant="subtitle2"
      component="h2"
      color="text.secondary"
      sx={{ mt: 2, mb: 0.5, px: 1 }}
    >
      {children}
    </Typography>
  );
}

export function TodayView() {
  const workspace = useWorkspace();
  const today = useToday();
  const tasks = todayTasks(workspace, today);
  const overdue = tasks.filter((task) => {
    const dates = [task.schedule?.start, task.due?.at].filter(Boolean).map((d) => datePart(d!));
    return dates.every((date) => date < today);
  });
  const current = tasks.filter((task) => !overdue.includes(task));
  return (
    <AppShell title={t('nav.today')}>
      <AddTaskInput
        defaults={{
          listId: inboxList(workspace).id,
          schedule: { start: today, end: null, allDay: true, timeZone: localTimeZone() },
        }}
      />
      {tasks.length === 0 ? (
        <EmptyState title={t('empty.today')} hint={t('empty.today.hint')} />
      ) : (
        <>
          {overdue.length > 0 && (
            <>
              <GroupHeading>{t('date.overdue')}</GroupHeading>
              <TaskRows tasks={overdue} showList />
            </>
          )}
          {overdue.length > 0 && current.length > 0 && (
            <GroupHeading>{t('date.today')}</GroupHeading>
          )}
          <TaskRows tasks={current} showList />
        </>
      )}
    </AppShell>
  );
}

export function UpcomingView() {
  const workspace = useWorkspace();
  const today = useToday();
  const groups = upcomingTasks(workspace, today);
  return (
    <AppShell title={t('nav.upcoming')}>
      {groups.length === 0 ? (
        <EmptyState title={t('upcoming.empty')} />
      ) : (
        groups.map((group) => (
          <Box key={group.date}>
            <GroupHeading>{formatDay(group.date, today)}</GroupHeading>
            <TaskRows tasks={group.tasks} showList />
          </Box>
        ))
      )}
    </AppShell>
  );
}

export function CompletedView() {
  const workspace = useWorkspace();
  const tasks = completedTasks(workspace);
  return (
    <AppShell title={t('nav.completed')}>
      {tasks.length === 0 ? (
        <EmptyState title={t('completed.empty')} />
      ) : (
        <TaskRows tasks={tasks} showList />
      )}
    </AppShell>
  );
}

export function TrashView() {
  const workspace = useWorkspace();
  const apply = useApply();
  const today = useToday();
  const now = useNow();
  const tasks = trashedTasks(workspace, now);
  return (
    <AppShell title={t('nav.trash')}>
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
                      list?.name,
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
    </AppShell>
  );
}
