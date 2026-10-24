import AddRounded from '@mui/icons-material/AddRounded';
import { Box, Button, ButtonBase, IconButton, Tooltip, Typography } from '@mui/material';
import { useState, type ReactNode } from 'react';
import { agendaDays } from '../../core/agenda.ts';
import { addDays, localTimeZone, weekday } from '../../core/dates.ts';
import { inboxList } from '../../core/lists.ts';
import { orderTasks, type ListSort } from '../../core/listView.ts';
import { todayGroups } from '../../core/queries.ts';
import { pinnedFirst } from '../../core/tasks.ts';
import type { Task } from '../../core/types.ts';
import { weekStart as preferredWeekStart } from '../format.ts';
import { useToday } from '../hooks/useToday.ts';
import { t } from '../i18n/i18n.ts';
import { ChevronLeftIcon, ChevronRightIcon } from '../icons/icons.tsx';
import { Page } from '../layout/Page.tsx';
import { monthTitle } from '../layout/miniCalendarText.ts';
import { useWorkspace } from '../store/hooks.ts';
import { AddTaskInput } from '../tasks/AddTaskInput.tsx';
import { TaskTree } from '../tasks/TaskTree.tsx';
import { dayTitle, hasOwnDate } from './dayLabels.ts';
import { GroupSection } from './GroupSection.tsx';
import { PinnedGroup, PostponeButton } from './groups.tsx';

/** Days shown at first, and how many more each "Show more days" adds. */
const DAYS = 14;
const MORE_DAYS = 14;

/** The first day of the week holding `date`, starting on `weekStart` (0 Sunday). */
function startOfWeek(date: string, weekStart: number): string {
  return addDays(date, -((weekday(date) - weekStart + 7) % 7));
}

/**
 * Upcoming, like Todoist's (spec: PL-091): a strip of the week's days on top, then every day from
 * there on with what starts on it, empty days included, each with its own add button. Overdue
 * tasks head the current week; pinned ones head everything.
 */
export function AgendaView({
  sort,
  reversed = false,
  actions,
}: {
  sort: ListSort;
  reversed?: boolean;
  actions: ReactNode;
}) {
  const sorted = (tasks: Task[], by: ListSort) => orderTasks(tasks, by, reversed);
  const workspace = useWorkspace();
  const today = useToday();
  const thisWeek = startOfWeek(today, preferredWeekStart());
  const [week, setWeek] = useState(thisWeek);
  const [count, setCount] = useState(DAYS);
  const [adding, setAdding] = useState<string | null>(null);
  const current = week === thisWeek;
  const from = current ? today : week;
  const days = agendaDays(workspace, today, from, count);
  const overdue = current ? todayGroups(workspace, today).overdue : [];
  const { pinned } = pinnedFirst([...overdue, ...days.flatMap((day) => day.tasks)]);
  const late = sorted(pinnedFirst(overdue).rest, sort);
  const busy = new Set(days.filter((day) => day.tasks.length > 0).map((day) => day.date));
  const inbox = inboxList(workspace).id;
  const zone = localTimeZone();
  const weekdayShort = new Intl.DateTimeFormat(undefined, { weekday: 'short', timeZone: 'UTC' });

  const show = (date: string) =>
    document
      .getElementById(`agenda-${date}`)
      ?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  const toWeek = (start: string) => {
    setWeek(start);
    setCount(DAYS);
  };

  return (
    <Page title={t('nav.upcoming')} actions={actions}>
      <AddTaskInput
        defaults={{
          listId: inbox,
          schedule: { start: today, end: null, allDay: true, timeZone: zone },
        }}
      />
      <Box
        sx={{
          position: 'sticky',
          top: { xs: 56, sm: 64 },
          zIndex: 2,
          bgcolor: 'background.default',
          pb: 1,
          borderBottom: 1,
          borderColor: 'divider',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Typography variant="subtitle2" component="p" sx={{ flexGrow: 1, fontWeight: 600 }}>
            {monthTitle(week, today)}
          </Typography>
          <IconButton
            size="small"
            aria-label={t('agenda.previousWeek')}
            disabled={current}
            onClick={() => toWeek(addDays(week, -7))}
          >
            <ChevronLeftIcon fontSize="small" />
          </IconButton>
          <Button size="small" disabled={current} onClick={() => toWeek(thisWeek)}>
            {t('calendar.today')}
          </Button>
          <IconButton
            size="small"
            aria-label={t('agenda.nextWeek')}
            onClick={() => toWeek(addDays(week, 7))}
          >
            <ChevronRightIcon fontSize="small" />
          </IconButton>
        </Box>
        <Box
          role="group"
          aria-label={t('agenda.week')}
          sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 0.5 }}
        >
          {Array.from({ length: 7 }, (_, index) => {
            const date = addDays(week, index);
            const past = date < today;
            const isToday = date === today;
            return (
              <ButtonBase
                key={date}
                aria-label={dayTitle(date, today)}
                aria-current={isToday ? 'date' : undefined}
                disabled={past}
                onClick={() => show(date)}
                sx={{
                  flexDirection: 'column',
                  py: 0.5,
                  borderRadius: 1.5,
                  color: past ? 'text.disabled' : 'text.primary',
                  bgcolor: isToday ? 'action.selected' : undefined,
                  '&:hover': { bgcolor: 'action.hover' },
                }}
              >
                <Typography variant="caption" color="inherit" sx={{ fontSize: 11 }}>
                  {weekdayShort.format(new Date(`${date}T12:00:00Z`))}
                </Typography>
                <Typography
                  variant="body2"
                  color="inherit"
                  sx={{ fontWeight: isToday ? 700 : 500 }}
                >
                  {Number(date.slice(8))}
                </Typography>
                <Box
                  component="span"
                  sx={{
                    width: 4,
                    height: 4,
                    borderRadius: '50%',
                    bgcolor: busy.has(date) ? 'primary.main' : 'transparent',
                  }}
                />
              </ButtonBase>
            );
          })}
        </Box>
      </Box>

      <PinnedGroup tasks={pinned} showList />
      {late.length > 0 && (
        <GroupSection
          groupKey="overdue"
          title={t('group.overdue')}
          count={late.length}
          actions={<PostponeButton tasks={late} today={today} />}
        >
          <TaskTree tasks={late} showList ownPlace={hasOwnDate} />
        </GroupSection>
      )}
      {days.map((day) => {
        const tasks = sorted(pinnedFirst(day.tasks).rest, sort);
        const title = dayTitle(day.date, today);
        return (
          <Box key={day.date} id={`agenda-${day.date}`} sx={{ scrollMarginTop: 180 }}>
            <GroupSection
              groupKey={
                day.date === today
                  ? 'today'
                  : day.date === addDays(today, 1)
                    ? 'tomorrow'
                    : `day:${day.date}`
              }
              title={title}
              count={tasks.length}
              actions={
                <Tooltip title={t('agenda.addTo', { day: title })}>
                  <IconButton
                    size="small"
                    aria-label={t('agenda.addTo', { day: title })}
                    aria-pressed={adding === day.date}
                    onClick={() => setAdding(adding === day.date ? null : day.date)}
                  >
                    <AddRounded fontSize="small" />
                  </IconButton>
                </Tooltip>
              }
            >
              {adding === day.date && (
                <AddTaskInput
                  autoFocus
                  defaults={{
                    listId: inbox,
                    schedule: { start: day.date, end: null, allDay: true, timeZone: zone },
                  }}
                  label={t('agenda.addTo', { day: title })}
                />
              )}
              {tasks.length > 0 ? (
                <TaskTree tasks={tasks} showList ownPlace={hasOwnDate} />
              ) : (
                adding !== day.date && (
                  <Typography variant="body2" color="text.disabled" sx={{ px: 1, pb: 0.5 }}>
                    {t('agenda.nothing')}
                  </Typography>
                )
              )}
            </GroupSection>
          </Box>
        );
      })}
      <Box sx={{ textAlign: 'center', py: 2 }}>
        <Button size="small" onClick={() => setCount(count + MORE_DAYS)}>
          {t('agenda.showMore')}
        </Button>
      </Box>
    </Page>
  );
}
