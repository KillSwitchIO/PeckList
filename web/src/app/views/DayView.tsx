import { IconButton, Tooltip } from '@mui/material';
import { Navigate, useNavigate, useParams } from 'react-router';
import { VIEW_GROUPINGS } from '../../core/listView.ts';
import { addDays, localTimeZone } from '../../core/dates.ts';
import { inboxList } from '../../core/lists.ts';
import { completedOn, dayTasks } from '../../core/queries.ts';
import { useToday } from '../hooks/useToday.ts';
import { t } from '../i18n/i18n.ts';
import { ChevronLeftIcon, ChevronRightIcon } from '../icons/icons.tsx';
import { Page } from '../layout/Page.tsx';
import { useListView } from '../lists/listGrouping.ts';
import { useWorkspace } from '../store/hooks.ts';
import { AddTaskInput } from '../tasks/AddTaskInput.tsx';
import { dayHeading, dayPath } from './dayLabels.ts';
import { EmptyState } from './EmptyState.tsx';
import { GroupedTasks } from './groups.tsx';
import { SortGroupButton } from './SortGroupButton.tsx';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * One day's tasks, like Today but for any day (spec: PL-090): what starts that day, added to that
 * day, and what got done that day. The mini calendar opens it; the arrows step a day.
 */
export function DayView() {
  const { date = '' } = useParams();
  const today = useToday();
  const workspace = useWorkspace();
  const navigate = useNavigate();
  const view = useListView('view:day');
  if (!DATE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    return (
      <Page title={t('day.title')}>
        <EmptyState title={t('day.notFound')} />
      </Page>
    );
  }
  if (date === today) return <Navigate to="/today" replace />;
  const title = dayHeading(date, today);
  const step = (days: number) => void navigate(dayPath(addDays(date, days), today));
  const actions = (
    <>
      <Tooltip title={t('day.previous')} disableFocusListener>
        <IconButton aria-label={t('day.previous')} onClick={() => step(-1)}>
          <ChevronLeftIcon />
        </IconButton>
      </Tooltip>
      <Tooltip title={t('day.next')} disableFocusListener>
        <IconButton aria-label={t('day.next')} onClick={() => step(1)}>
          <ChevronRightIcon />
        </IconButton>
      </Tooltip>
      <SortGroupButton view={view} groupings={VIEW_GROUPINGS} />
    </>
  );
  return (
    <Page title={title} actions={actions}>
      <AddTaskInput
        key={date}
        defaults={{
          listId: inboxList(workspace).id,
          schedule: { start: date, end: null, allDay: true, timeZone: localTimeZone() },
        }}
        label={t('day.addTo', { day: title })}
      />
      <GroupedTasks
        tasks={dayTasks(workspace, date, today)}
        closed={completedOn(workspace, date, localTimeZone())}
        // One day is one date group: by date is the day's tasks in a single run.
        grouping={view.grouping === 'date' ? 'none' : view.grouping}
        sort={view.sort}
        showList
        emptyTitle={t('day.empty')}
      />
    </Page>
  );
}
